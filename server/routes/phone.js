// Phones: every character has one. Contacts (with the name you saved them as), one-to-one texts
// between two characters and group texts. Only the writers of the characters in a conversation can
// read it, and live updates go to just them.
import { fail, str, id } from '../http.js';
import { toCharacter, requireUser, isBlocked, uploadRef, requirePlayable } from '../model.js';
import { plainText } from '../text.js';

const MAX_TEXT = 20000;
// A text's or call's time, set by the writer (ISO text from the browser), stored as UTC.
function whenInput(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900 || d.getFullYear() > 2200) fail(400, "That date doesn't look right");
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
// A call: answered or missed, voice or FaceTime, and how long it lasted (seconds).
function callInput(body) {
  const answered = body.answered === true;
  const video = body.video === true;
  const secs = Math.round(Number(body.duration) || 0);
  if (answered && (!Number.isFinite(secs) || secs < 0 || secs > 24 * 3600)) fail(400, 'The call can last up to 24 hours');
  return { answered, video, duration: answered ? secs : 0 };
}
const readCall = (body) => {
  try {
    const c = JSON.parse(body || '{}');
    return { answered: !!c.answered, video: !!c.video, duration: Number(c.duration) || 0 };
  } catch {
    return { answered: false, video: false, duration: 0 };
  }
};
const callLength = (s) =>
  s >= 3600
    ? `${Math.floor(s / 3600)} hr ${Math.round((s % 3600) / 60)} min`
    : s >= 60
      ? `${Math.round(s / 60)} min`
      : `${s} sec`;
const MAX_GROUP = 32;
// Tapbacks: the six classic ones, or any single emoji from the picker.
const isEmoji = (s) =>
  typeof s === 'string' && s.length > 0 && s.length <= 16 && /\p{Extended_Pictographic}/u.test(s) && !/[\p{L}\p{N}\s<>]/u.test(s);

export function phoneRoutes(r, ctx) {
  const { db, hub } = ctx;

  const character = (cid) => db.prepare('SELECT * FROM characters WHERE id = ?').get(cid);
  const ownCharacter = (cid, user) => {
    const c = character(Number(cid));
    if (!c || c.user_id !== user.id) fail(404, 'Character not found');
    return c;
  };
  const blockedEitherWay = (a, b) => isBlocked(db, a, b) || isBlocked(db, b, a);
  const members = (threadId) =>
    db
      .prepare(
        `SELECT c.* FROM phone_members pm JOIN characters c ON c.id = pm.character_id
    WHERE pm.thread_id = ? ORDER BY pm.joined_at, c.id`,
      )
      .all(threadId);
  const memberUsers = (threadId) => new Set(members(threadId).map((c) => c.user_id));

  // Which of a conversation's characters is "me" for this user (they may own several).
  function threadFor(threadId, user, as) {
    const t = db.prepare('SELECT * FROM phone_threads WHERE id = ?').get(Number(threadId));
    if (!t) fail(404, 'Conversation not found');
    const all = members(t.id);
    const mine = all.filter((c) => c.user_id === user.id);
    if (!mine.length) fail(404, 'Conversation not found');
    const me = (as && mine.find((c) => c.id === Number(as))) || mine[0];
    const others = all.filter((c) => c.id !== me.id);
    return { t, me, others, other: t.is_group ? null : (others[0] ?? null) };
  }

  const contactName = (meId, otherId) =>
    db.prepare('SELECT name FROM phone_contacts WHERE character_id = ? AND contact_id = ?').get(meId, otherId)?.name || '';
  // The picture this phone saved for a contact (only this phone sees it; the character keeps their own).
  const contactAvatar = (meId, otherId) =>
    db.prepare('SELECT avatar FROM phone_contacts WHERE character_id = ? AND contact_id = ?').get(meId, otherId)?.avatar || null;
  const asContact = (meId, c) => {
    const ch = toCharacter(c);
    const pic = contactAvatar(meId, c.id);
    return { ...ch, avatar: pic || ch.avatar, contactName: contactName(meId, c.id) || ch.name };
  };
  const groupName = (t, meId, others) =>
    t.title || others.map((c) => (contactName(meId, c.id) || c.name).split(' ')[0]).join(', ') || 'Group';

  const reactionsFor = (messageId) =>
    db
      .prepare('SELECT character_id, emoji FROM phone_reactions WHERE message_id = ? ORDER BY created_at')
      .all(messageId)
      .map((x) => ({ characterId: x.character_id, emoji: x.emoji }));

  function toMessage(m) {
    const reply = m.reply_to
      ? db.prepare('SELECT id, body, media, character_id FROM phone_messages WHERE id = ?').get(m.reply_to)
      : null;
    return {
      id: m.id,
      threadId: m.thread_id,
      characterId: m.character_id,
      userId: m.user_id,
      body: m.body,
      kind: m.kind || 'text',
      media: JSON.parse(m.media),
      createdAt: m.created_at,
      editedAt: m.edited_at,
      reactions: reactionsFor(m.id),
      call: m.kind === 'call' ? readCall(m.body) : null,
      replyTo: reply
        ? { id: reply.id, characterId: reply.character_id, text: plainText(reply.body), hasMedia: reply.media !== '[]' }
        : null,
    };
  }
  const lastText = (m) => {
    if (m.kind !== 'call') return plainText(m.body, 90) || (m.media !== '[]' ? 'Photo' : '');
    const c = readCall(m.body);
    const what = c.video ? 'FaceTime' : 'Call';
    return c.answered ? `${what} · ${callLength(c.duration)}` : `Missed ${c.video ? 'FaceTime' : 'call'}`;
  };

  function summary(t, meId, others = null) {
    const rest = others ?? members(t.id).filter((c) => c.id !== meId);
    const last = db.prepare('SELECT * FROM phone_messages WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(t.id);
    const read = db.prepare('SELECT last_read_id FROM phone_reads WHERE character_id = ? AND thread_id = ?').get(meId, t.id)?.last_read_id ?? 0;
    const sender = last && last.character_id !== meId && t.is_group ? rest.find((c) => c.id === last.character_id) : null;
    const base = {
      id: t.id,
      group: !!t.is_group,
      lastAt: t.last_at,
      last: last
        ? {
            text: `${sender ? `${(contactName(meId, sender.id) || sender.name).split(' ')[0]}: ` : ''}${lastText(last)}`,
            at: last.created_at,
            mine: last.character_id === meId,
          }
        : null,
      unread: db
        .prepare('SELECT COUNT(*) AS n FROM phone_messages WHERE thread_id = ? AND id > ? AND character_id != ?')
        .get(t.id, read, meId).n,
    };
    if (t.is_group) {
      return {
        ...base,
        name: groupName(t, meId, rest),
        title: t.title,
        photo: t.photo,
        members: rest.map((c) => asContact(meId, c)),
        other: null,
      };
    }
    const other = rest[0];
    return { ...base, other: asContact(meId, other), name: contactName(meId, other.id) || other.name };
  }
  // A group is hidden from a writer only if everyone else in it has blocked them (or the other way).
  const visible = (user, t) =>
    t.group
      ? t.members.some((m) => !blockedEitherWay(user.id, m.userId)) || !t.members.length
      : !blockedEitherWay(user.id, t.other.userId);

  // Unread texts on each of this writer's phones (for the dot in the phone switcher).
  r.get('/api/phone/unread', ({ user }) => {
    requireUser(user);
    const rows = db
      .prepare(
        `SELECT pm.character_id AS cid, COUNT(m.id) AS n FROM phone_members pm
      JOIN characters c ON c.id = pm.character_id AND c.user_id = ?
      JOIN phone_messages m ON m.thread_id = pm.thread_id AND m.character_id != pm.character_id
        AND m.id > COALESCE((SELECT last_read_id FROM phone_reads pr WHERE pr.character_id = pm.character_id AND pr.thread_id = pm.thread_id), 0)
      GROUP BY pm.character_id`,
      )
      .all(user.id);
    return { data: { unread: Object.fromEntries(rows.map((x) => [x.cid, x.n])) } };
  });

  // A character's phone: their contacts and conversations.
  r.get('/api/phone/:id', ({ user, params }) => {
    requireUser(user);
    const me = ownCharacter(params.id, user);
    const contacts = db
      .prepare(
        `SELECT pc.name AS contact_name, pc.avatar AS contact_avatar, c.* FROM phone_contacts pc JOIN characters c ON c.id = pc.contact_id
      WHERE pc.character_id = ? ORDER BY COALESCE(NULLIF(pc.name, ''), c.name) COLLATE NOCASE`,
      )
      .all(me.id)
      .filter((c) => !blockedEitherWay(user.id, c.user_id))
      .map((c) => ({
        id: c.id,
        name: c.contact_name || c.name,
        character: { ...toCharacter(c), avatar: c.contact_avatar || c.avatar },
        customAvatar: !!c.contact_avatar,
      }));
    const threads = db
      .prepare(
        `SELECT t.* FROM phone_threads t JOIN phone_members pm ON pm.thread_id = t.id AND pm.character_id = ?
      ORDER BY t.last_at DESC`,
      )
      .all(me.id)
      .map((t) => summary(t, me.id))
      .filter(
        (t) => (t.group || t.other) && visible(user, t) && (t.group || t.last || contacts.some((c) => c.id === t.other.id)),
      );
    return { data: { character: toCharacter(me), contacts, threads } };
  });

  // Save someone to this character's contacts (or rename them).
  r.post('/api/phone/:id/contacts', ({ user, params, body }) => {
    requireUser(user);
    const me = ownCharacter(params.id, user);
    const other = character(id(body.contactId, 'Contact'));
    if (!other || other.id === me.id) fail(400, 'Pick someone else to add');
    if (blockedEitherWay(user.id, other.user_id)) fail(403, "You can't add this character");
    const existing = db.prepare('SELECT * FROM phone_contacts WHERE character_id = ? AND contact_id = ?').get(me.id, other.id);
    const name = body.name === undefined ? (existing?.name ?? '') : (str(body.name, 'Contact name', { max: 60 }) ?? '');
    const pic = uploadRef(db, body.avatar, user.id);
    const avatar = pic === undefined ? (existing?.avatar ?? null) : pic;
    db.prepare(
      `INSERT INTO phone_contacts (character_id, contact_id, name, avatar) VALUES (?, ?, ?, ?)
      ON CONFLICT(character_id, contact_id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar`,
    ).run(me.id, other.id, name, avatar);
    return {
      status: 201,
      data: {
        contact: {
          id: other.id,
          name: name || other.name,
          character: { ...toCharacter(other), avatar: avatar || other.avatar },
          customAvatar: !!avatar,
        },
      },
    };
  });

  r.delete('/api/phone/:id/contacts/:contactId', ({ user, params }) => {
    requireUser(user);
    const me = ownCharacter(params.id, user);
    db.prepare('DELETE FROM phone_contacts WHERE character_id = ? AND contact_id = ?').run(me.id, params.contactId);
    return { data: { ok: true } };
  });

  // Open (or start) the conversation between this character and another.
  r.post('/api/phone/:id/threads', ({ user, params, body }) => {
    requireUser(user);
    const me = ownCharacter(params.id, user);
    const other = character(id(body.withId, 'Character'));
    if (!other || other.id === me.id) fail(400, 'Pick someone else to text');
    if (blockedEitherWay(user.id, other.user_id)) fail(403, "You can't text this character");
    const [a, b] = me.id < other.id ? [me.id, other.id] : [other.id, me.id];
    let t = db.prepare('SELECT * FROM phone_threads WHERE a_id = ? AND b_id = ? AND is_group = 0').get(a, b);
    if (!t) {
      const tid = db.prepare('INSERT INTO phone_threads (a_id, b_id) VALUES (?, ?)').run(a, b).lastInsertRowid;
      const add = db.prepare('INSERT OR IGNORE INTO phone_members (thread_id, character_id) VALUES (?, ?)');
      add.run(tid, a);
      add.run(tid, b);
      t = db.prepare('SELECT * FROM phone_threads WHERE id = ?').get(tid);
    }
    return { data: { thread: summary(t, me.id) } };
  });

  const pickMembers = (user, me, ids) => {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(Number))]
      .filter((x) => x && x !== me.id)
      .map((x) => character(x));
    if (list.some((c) => !c)) fail(400, 'Someone in that list is gone');
    if (list.some((c) => blockedEitherWay(user.id, c.user_id))) fail(403, "You can't add one of those characters");
    return list;
  };
  const broadcast = (threadId, type, payload, extra = []) => {
    for (const uid of new Set([...memberUsers(threadId), ...extra])) hub.sendUser(uid, type, payload);
  };

  // Start a group text with two or more others.
  r.post('/api/phone/:id/groups', ({ user, params, body }) => {
    requireUser(user);
    const me = ownCharacter(params.id, user);
    requirePlayable(me);
    const others = pickMembers(user, me, body.memberIds);
    if (others.length < 2) fail(400, 'Pick at least two people for a group');
    if (others.length + 1 > MAX_GROUP) fail(400, `A group can have up to ${MAX_GROUP} people`);
    const title = str(body.title, 'Group name', { max: 60 }) ?? '';
    const tid = db
      .prepare('INSERT INTO phone_threads (is_group, title, created_by) VALUES (1, ?, ?)')
      .run(title, me.id).lastInsertRowid;
    const add = db.prepare('INSERT INTO phone_members (thread_id, character_id) VALUES (?, ?)');
    for (const c of [me, ...others]) add.run(tid, c.id);
    const t = db.prepare('SELECT * FROM phone_threads WHERE id = ?').get(tid);
    broadcast(t.id, 'dm-thread', { threadId: t.id });
    return { status: 201, data: { thread: summary(t, me.id) } };
  });

  // Rename a group or change its picture (anyone in it can, like on a real phone).
  r.put('/api/phone/threads/:id', ({ user, params, body }) => {
    requireUser(user);
    const { t } = threadFor(params.id, user, body.as);
    if (!t.is_group) fail(400, 'Only group chats have a name');
    const title = body.title === undefined ? t.title : (str(body.title, 'Group name', { max: 60 }) ?? '');
    const pic = uploadRef(db, body.photo, user.id);
    const photo = pic === undefined ? t.photo : pic;
    db.prepare('UPDATE phone_threads SET title = ?, photo = ? WHERE id = ?').run(title, photo, t.id);
    broadcast(t.id, 'dm-thread', { threadId: t.id });
    return { data: { ok: true } };
  });

  // Add people to a group.
  r.post('/api/phone/threads/:id/members', ({ user, params, body }) => {
    requireUser(user);
    const { t, me, others } = threadFor(params.id, user, body.as);
    if (!t.is_group) fail(400, 'Start a group to add more people');
    const add = pickMembers(user, me, body.memberIds).filter((c) => !others.some((o) => o.id === c.id));
    if (others.length + add.length + 1 > MAX_GROUP) fail(400, `A group can have up to ${MAX_GROUP} people`);
    const ins = db.prepare('INSERT OR IGNORE INTO phone_members (thread_id, character_id) VALUES (?, ?)');
    for (const c of add) ins.run(t.id, c.id);
    broadcast(t.id, 'dm-thread', { threadId: t.id });
    return { data: { ok: true, added: add.length } };
  });

  // Leave a group (or, for the one who started it, remove someone).
  r.delete('/api/phone/threads/:id/members/:cid', ({ user, params, query }) => {
    requireUser(user);
    const { t, me } = threadFor(params.id, user, query.get('as'));
    if (!t.is_group) fail(400, 'Only group chats can be left');
    const target = Number(params.cid);
    const leaving = character(target);
    if (!leaving) fail(404, 'Character not found');
    if (leaving.user_id !== user.id && t.created_by !== me.id)
      fail(403, 'Only the person who started the group can remove people');
    const before = memberUsers(t.id);
    db.prepare('DELETE FROM phone_members WHERE thread_id = ? AND character_id = ?').run(t.id, target);
    db.prepare('DELETE FROM phone_reads WHERE thread_id = ? AND character_id = ?').run(t.id, target);
    if (!db.prepare('SELECT 1 FROM phone_members WHERE thread_id = ?').get(t.id))
      db.prepare('DELETE FROM phone_threads WHERE id = ?').run(t.id);
    broadcast(t.id, 'dm-thread', { threadId: t.id }, [...before]);
    return { data: { ok: true } };
  });

  r.get('/api/phone/threads/:id', ({ user, params, query }) => {
    requireUser(user);
    const { t, me, others, other } = threadFor(params.id, user, query.get('as'));
    if (other && blockedEitherWay(user.id, other.user_id)) fail(404, 'Conversation not found');
    const before = Number(query.get('before')) || Number.MAX_SAFE_INTEGER;
    const rows = db
      .prepare('SELECT * FROM phone_messages WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT 101')
      .all(t.id, before)
      .reverse();
    const hasMore = rows.length > 100;
    if (hasMore) rows.shift();
    // How far the other person has read (one-to-one only, for "Read" under your last text).
    const readUpTo = other
      ? (db.prepare('SELECT last_read_id FROM phone_reads WHERE character_id = ? AND thread_id = ?').get(other.id, t.id)
          ?.last_read_id ?? 0)
      : 0;
    const s = summary(t, me.id, others);
    return {
      data: {
        thread: {
          id: t.id,
          group: !!t.is_group,
          me: toCharacter(me),
          name: s.name,
          title: t.title,
          photo: t.photo,
          other: other ? asContact(me.id, other) : null,
          members: others.map((c) => asContact(me.id, c)),
          createdBy: t.created_by,
          readUpTo,
        },
        messages: rows.map(toMessage),
        hasMore,
      },
    };
  });

  // Tell everyone else in the conversation: "{a} texted {b}" / "{b} missed a call from {a}".
  function notifyOthers(t, me, others, user, type, text) {
    for (const c of others) {
      if (c.user_id === user.id) continue;
      ctx.notify({
        userId: c.user_id,
        type,
        actorId: user.id,
        characterId: c.id,
        fromCharacterId: me.id,
        phoneThreadId: t.id,
        text,
      });
    }
  }

  // `at` is the time the writer set (or null: now in Ardell City).
  function addMessage(t, me, user, { text = '', media = [], replyTo = null, kind = 'text', at = null }) {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO phone_messages (thread_id, character_id, user_id, body, media, reply_to, kind, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      )
      .run(t.id, me.id, user.id, text, JSON.stringify(media), replyTo, kind, at ?? ctx.storyNow());
    db.prepare("UPDATE phone_threads SET last_at = datetime('now') WHERE id = ?").run(t.id);
    db.prepare(
      `INSERT INTO phone_reads (character_id, thread_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(character_id, thread_id) DO UPDATE SET last_read_id = excluded.last_read_id`,
    ).run(me.id, t.id, lastInsertRowid);
    const message = toMessage(db.prepare('SELECT * FROM phone_messages WHERE id = ?').get(lastInsertRowid));
    broadcast(t.id, 'dm', message);
    return message;
  }

  r.post('/api/phone/threads/:id/messages', ({ user, params, body }) => {
    requireUser(user);
    const { t, me, others, other } = threadFor(params.id, user, body.as);
    requirePlayable(me);
    if (other && blockedEitherWay(user.id, other.user_id)) fail(403, "You can't text this character");
    const text = str(body.body, 'Message', { max: MAX_TEXT }) ?? '';
    const media = Array.isArray(body.media)
      ? body.media.slice(0, 10).map((v) => uploadRef(db, v, user.id) ?? fail(400, 'Picture missing'))
      : [];
    if (!text && !media.length) fail(400, 'Write something or add a picture');
    let replyTo = null;
    if (body.replyTo != null) {
      replyTo =
        db.prepare('SELECT id FROM phone_messages WHERE id = ? AND thread_id = ?').get(Number(body.replyTo), t.id)?.id ??
        fail(400, 'That message is gone');
    }
    const message = addMessage(t, me, user, { text, media, replyTo, at: whenInput(body.at) });
    notifyOthers(
      t,
      me,
      others.filter((c) => !blockedEitherWay(user.id, c.user_id)),
      user,
      'dm',
      plainText(text, 140) || 'sent a photo',
    );
    return { status: 201, data: { message } };
  });

  // A call is just for the story: it shows in the conversation and as a missed call.
  r.post('/api/phone/threads/:id/call', ({ user, params, body }) => {
    requireUser(user);
    const { t, me, others, other } = threadFor(params.id, user, body.as);
    requirePlayable(me);
    if (other && blockedEitherWay(user.id, other.user_id)) fail(403, "You can't call this character");
    const call = callInput(body);
    const message = addMessage(t, me, user, { kind: 'call', text: JSON.stringify(call), at: whenInput(body.at) });
    // Only a call nobody picked up shows as a missed call for the others.
    if (!call.answered)
      notifyOthers(
        t,
        me,
        others.filter((c) => !blockedEitherWay(user.id, c.user_id)),
        user,
        'call',
        call.video ? 'facetime' : '',
      );
    return { status: 201, data: { message } };
  });

  // Tapback: tap the same one again to take it off.
  r.post('/api/phone/messages/:id/react', ({ user, params, body }) => {
    requireUser(user);
    const m = db.prepare('SELECT * FROM phone_messages WHERE id = ?').get(params.id);
    if (!m) fail(404, 'Message not found');
    const { me } = threadFor(m.thread_id, user, body.as);
    const emoji = body.emoji === null || body.emoji === '' ? null : String(body.emoji ?? '');
    if (emoji !== null && !isEmoji(emoji)) fail(400, 'Pick an emoji');
    const had = db.prepare('SELECT emoji FROM phone_reactions WHERE message_id = ? AND character_id = ?').get(m.id, me.id);
    if (emoji === null || had?.emoji === emoji)
      db.prepare('DELETE FROM phone_reactions WHERE message_id = ? AND character_id = ?').run(m.id, me.id);
    else {
      db.prepare(
        `INSERT INTO phone_reactions (message_id, character_id, emoji) VALUES (?, ?, ?)
        ON CONFLICT(message_id, character_id) DO UPDATE SET emoji = excluded.emoji, created_at = datetime('now')`,
      ).run(m.id, me.id, emoji);
    }
    const reactions = reactionsFor(m.id);
    broadcast(m.thread_id, 'dm-react', { id: m.id, threadId: m.thread_id, reactions });
    return { data: { reactions } };
  });

  r.post('/api/phone/threads/:id/read', ({ user, params, body }) => {
    requireUser(user);
    const { t, me } = threadFor(params.id, user, body.as);
    const lastId = Number(body.lastId) || 0;
    db.prepare(
      `INSERT INTO phone_reads (character_id, thread_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(character_id, thread_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
    ).run(me.id, t.id, lastId);
    db.prepare(
      `UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND type IN ('dm', 'call') AND character_id = ?
      AND (phone_thread_id = ? OR phone_thread_id IS NULL) AND read_at IS NULL`,
    ).run(user.id, me.id, t.id);
    // The other writers see "Read" under their texts.
    broadcast(t.id, 'dm-read', { threadId: t.id, characterId: me.id, lastId });
    return { data: { ok: true } };
  });

  r.delete('/api/phone/messages/:id', ({ user, params }) => {
    requireUser(user);
    const m = db.prepare('SELECT * FROM phone_messages WHERE id = ?').get(params.id);
    if (!m || (m.user_id !== user.id && !user.isAdmin)) fail(404, 'Message not found');
    db.prepare('DELETE FROM phone_messages WHERE id = ?').run(m.id);
    broadcast(m.thread_id, 'dm-delete', { id: m.id, threadId: m.thread_id });
    return { data: { ok: true } };
  });
}
