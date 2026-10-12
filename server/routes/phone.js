// Phones: every character has one. Contacts (with the name you saved them as) and private
// one-to-one texts between two characters. Only the writers of those two characters can read a
// conversation, and live updates go to just them.
import { fail, str, id } from '../http.js';
import { toCharacter, requireUser, isBlocked, uploadRef } from '../model.js';
import { plainText } from '../text.js';

const MAX_TEXT = 20000;

export function phoneRoutes(r, ctx) {
  const { db, hub } = ctx;

  const character = (cid) => db.prepare('SELECT * FROM characters WHERE id = ?').get(cid);
  const ownCharacter = (cid, user) => {
    const c = character(Number(cid));
    if (!c || c.user_id !== user.id) fail(404, 'Character not found');
    return c;
  };
  const blockedEitherWay = (a, b) => isBlocked(db, a, b) || isBlocked(db, b, a);

  // Which of a thread's two characters is "me" for this user (they may own both).
  function threadFor(threadId, user, as) {
    const t = db.prepare('SELECT * FROM phone_threads WHERE id = ?').get(threadId);
    if (!t) fail(404, 'Conversation not found');
    const a = character(t.a_id);
    const b = character(t.b_id);
    const mine = [a, b].filter((c) => c.user_id === user.id);
    if (!mine.length) fail(404, 'Conversation not found');
    const me = (as && mine.find((c) => c.id === Number(as))) || mine[0];
    const other = me.id === a.id ? b : a;
    return { t, me, other };
  }

  const contactName = (meId, otherId) => db.prepare('SELECT name FROM phone_contacts WHERE character_id = ? AND contact_id = ?').get(meId, otherId)?.name || '';

  function toMessage(m) {
    const reply = m.reply_to ? db.prepare('SELECT id, body, media, character_id FROM phone_messages WHERE id = ?').get(m.reply_to) : null;
    return {
      id: m.id, threadId: m.thread_id, characterId: m.character_id, userId: m.user_id, body: m.body,
      media: JSON.parse(m.media), createdAt: m.created_at, editedAt: m.edited_at,
      replyTo: reply ? { id: reply.id, characterId: reply.character_id, text: plainText(reply.body), hasMedia: reply.media !== '[]' } : null,
    };
  }

  function summary(t, meId) {
    const otherId = t.a_id === meId ? t.b_id : t.a_id;
    const other = character(otherId);
    const last = db.prepare('SELECT * FROM phone_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(t.id);
    const read = db.prepare('SELECT last_read_id FROM phone_reads WHERE character_id = ? AND thread_id = ?').get(meId, t.id)?.last_read_id ?? 0;
    return {
      id: t.id, other: toCharacter(other), name: contactName(meId, otherId) || other.name,
      last: last ? { text: plainText(last.body, 90) || (last.media !== '[]' ? 'Photo' : ''), at: last.created_at, mine: last.character_id === meId } : null,
      unread: db.prepare('SELECT COUNT(*) AS n FROM phone_messages WHERE thread_id = ? AND id > ? AND character_id != ?').get(t.id, read, meId).n,
      lastAt: t.last_at,
    };
  }

  // A character's phone: their contacts and conversations.
  r.get('/api/phone/:id', ({ user, params }) => {
    requireUser(user);
    const me = ownCharacter(params.id, user);
    const contacts = db.prepare(`SELECT pc.name AS contact_name, c.* FROM phone_contacts pc JOIN characters c ON c.id = pc.contact_id
      WHERE pc.character_id = ? ORDER BY COALESCE(NULLIF(pc.name, ''), c.name) COLLATE NOCASE`).all(me.id)
      .filter((c) => !blockedEitherWay(user.id, c.user_id))
      .map((c) => ({ id: c.id, name: c.contact_name || c.name, character: toCharacter(c) }));
    const threads = db.prepare('SELECT * FROM phone_threads WHERE a_id = ? OR b_id = ? ORDER BY last_at DESC').all(me.id, me.id)
      .map((t) => summary(t, me.id))
      .filter((t) => !blockedEitherWay(user.id, t.other.userId) && (t.last || contacts.some((c) => c.id === t.other.id)));
    return { data: { character: toCharacter(me), contacts, threads } };
  });

  // Save someone to this character's contacts (or rename them).
  r.post('/api/phone/:id/contacts', ({ user, params, body }) => {
    requireUser(user);
    const me = ownCharacter(params.id, user);
    const other = character(id(body.contactId, 'Contact'));
    if (!other || other.id === me.id) fail(400, 'Pick someone else to add');
    if (blockedEitherWay(user.id, other.user_id)) fail(403, "You can't add this character");
    const name = str(body.name, 'Contact name', { max: 60 }) ?? '';
    db.prepare(`INSERT INTO phone_contacts (character_id, contact_id, name) VALUES (?, ?, ?)
      ON CONFLICT(character_id, contact_id) DO UPDATE SET name = excluded.name`).run(me.id, other.id, name);
    return { status: 201, data: { contact: { id: other.id, name: name || other.name, character: toCharacter(other) } } };
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
    db.prepare('INSERT OR IGNORE INTO phone_threads (a_id, b_id) VALUES (?, ?)').run(a, b);
    const t = db.prepare('SELECT * FROM phone_threads WHERE a_id = ? AND b_id = ?').get(a, b);
    return { data: { thread: summary(t, me.id) } };
  });

  r.get('/api/phone/threads/:id', ({ user, params, query }) => {
    requireUser(user);
    const { t, me, other } = threadFor(params.id, user, query.get('as'));
    if (blockedEitherWay(user.id, other.user_id)) fail(404, 'Conversation not found');
    const before = Number(query.get('before')) || Number.MAX_SAFE_INTEGER;
    const rows = db.prepare('SELECT * FROM phone_messages WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT 101').all(t.id, before).reverse();
    const hasMore = rows.length > 100;
    if (hasMore) rows.shift();
    return {
      data: {
        thread: { id: t.id, me: toCharacter(me), other: toCharacter(other), name: contactName(me.id, other.id) || other.name },
        messages: rows.map(toMessage), hasMore,
      },
    };
  });

  r.post('/api/phone/threads/:id/messages', ({ user, params, body }) => {
    requireUser(user);
    const { t, me, other } = threadFor(params.id, user, body.as);
    if (blockedEitherWay(user.id, other.user_id)) fail(403, "You can't text this character");
    const text = str(body.body, 'Message', { max: MAX_TEXT }) ?? '';
    const media = Array.isArray(body.media) ? body.media.slice(0, 10).map((v) => uploadRef(db, v, user.id) ?? fail(400, 'Picture missing')) : [];
    if (!text && !media.length) fail(400, 'Write something or add a picture');
    let replyTo = null;
    if (body.replyTo != null) {
      replyTo = db.prepare('SELECT id FROM phone_messages WHERE id = ? AND thread_id = ?').get(Number(body.replyTo), t.id)?.id ?? fail(400, 'That message is gone');
    }
    const { lastInsertRowid } = db.prepare(`INSERT INTO phone_messages (thread_id, character_id, user_id, body, media, reply_to)
      VALUES (?, ?, ?, ?, ?, ?)`).run(t.id, me.id, user.id, text, JSON.stringify(media), replyTo);
    db.prepare("UPDATE phone_threads SET last_at = datetime('now') WHERE id = ?").run(t.id);
    db.prepare(`INSERT INTO phone_reads (character_id, thread_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(character_id, thread_id) DO UPDATE SET last_read_id = excluded.last_read_id`).run(me.id, t.id, lastInsertRowid);
    const message = toMessage(db.prepare('SELECT * FROM phone_messages WHERE id = ?').get(lastInsertRowid));
    for (const uid of new Set([me.user_id, other.user_id])) hub.sendUser(uid, 'dm', message);
    if (other.user_id !== user.id) {
      const shownAs = contactName(other.id, me.id) || me.name;
      ctx.notify({ userId: other.user_id, type: 'dm', actorId: user.id, characterId: other.id, text: `${shownAs}: ${plainText(text) || 'sent a photo'}` });
    }
    return { status: 201, data: { message } };
  });

  r.post('/api/phone/threads/:id/read', ({ user, params, body }) => {
    requireUser(user);
    const { t, me } = threadFor(params.id, user, body.as);
    const lastId = Number(body.lastId) || 0;
    db.prepare(`INSERT INTO phone_reads (character_id, thread_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(character_id, thread_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(me.id, t.id, lastId);
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND type = 'dm' AND character_id = ? AND read_at IS NULL").run(user.id, me.id);
    return { data: { ok: true } };
  });

  r.delete('/api/phone/messages/:id', ({ user, params }) => {
    requireUser(user);
    const m = db.prepare('SELECT * FROM phone_messages WHERE id = ?').get(params.id);
    if (!m || (m.user_id !== user.id && !user.isAdmin)) fail(404, 'Message not found');
    db.prepare('DELETE FROM phone_messages WHERE id = ?').run(m.id);
    const t = db.prepare('SELECT * FROM phone_threads WHERE id = ?').get(m.thread_id);
    for (const cid of [t.a_id, t.b_id]) hub.sendUser(character(cid).user_id, 'dm-delete', { id: m.id, threadId: t.id });
    return { data: { ok: true } };
  });
}
