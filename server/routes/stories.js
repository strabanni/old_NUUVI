// Stories (the "servers"), their channels (scenes), membership and turn order.
import { randomBytes } from 'node:crypto';
import { fail, str, oneOf, color, id } from '../http.js';
import { transaction } from '../db.js';
import {
  toStory, toChannel, toCharacter, toUser, turnState, STORY_SELECT,
  requireUser, storyAccess, channelAccess, requireOwner, membership, uploadRef, isBlocked, modLog, adminCanSee,
} from '../model.js';

const inviteCode = () => randomBytes(6).toString('base64url');
const STORY_COLORS = ['#EE719E', '#e0628c', '#c96f8f', '#d98aa5', '#f2a7c0', '#48484A', '#6e6c6d', '#8f8d8e'];

function warnings(value) {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : fail(400, 'Content warnings must be a list');
  const clean = [...new Set(list.map((w) => String(w).trim().replace(/,/g, '')).filter(Boolean))];
  if (clean.length > 20 || clean.some((w) => w.length > 40)) fail(400, 'Use at most 20 content warnings of 40 characters each');
  return clean.join(', ');
}

export function storyRoutes(r, ctx) {
  const { db, hub } = ctx;

  function channelsFor(storyId, userId) {
    const rows = db.prepare(`
      SELECT c.*,
        (SELECT MAX(p.id) FROM posts p WHERE p.channel_id = c.id) AS last_post_id,
        (SELECT COUNT(*) FROM posts p WHERE p.channel_id = c.id AND p.user_id != :u
           AND p.id > COALESCE((SELECT last_read_id FROM channel_reads r WHERE r.channel_id = c.id AND r.user_id = :u), 0)) AS unread,
        (SELECT COUNT(*) FROM notifications n WHERE n.channel_id = c.id AND n.user_id = :u
           AND n.read_at IS NULL AND n.type IN ('mention', 'turn')) AS mentions
      FROM channels c WHERE c.story_id = :s ORDER BY c.position, c.id`).all({ u: userId ?? 0, s: storyId });
    // Unread counts only make sense for members.
    return rows.map((row) => toChannel(userId ? row : { ...row, unread: 0, mentions: 0 }));
  }

  // Marks everything currently in the story as read (used when joining).
  function catchUp(storyId, userId) {
    db.prepare(`INSERT INTO channel_reads (user_id, channel_id, last_read_id)
      SELECT ?, c.id, COALESCE((SELECT MAX(id) FROM posts p WHERE p.channel_id = c.id), 0) FROM channels c WHERE c.story_id = ?
      ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id`).run(userId, storyId);
  }

  const storyChanged = (storyId) => hub.sendStory(storyId, 'story', { storyId });

  // Your own order for the stories in your sidebar (drag and drop). Stories left out keep no spot
  // and show first, newest activity on top, until you place them.
  r.put('/api/home/order', ({ user, body }) => {
    requireUser(user);
    if (!Array.isArray(body.storyIds) || body.storyIds.length > 500) fail(400, 'Expected a list of stories');
    const set = db.prepare('UPDATE story_members SET rail_pos = ? WHERE story_id = ? AND user_id = ?');
    transaction(db, () => {
      db.prepare('UPDATE story_members SET rail_pos = NULL WHERE user_id = ?').run(user.id);
      body.storyIds.forEach((sid, i) => set.run(i, Number(sid) || 0, user.id));
    });
    return { data: { ok: true } };
  });

  r.get('/api/home', ({ user }) => {
    requireUser(user);
    const rows = db.prepare(`
      SELECT s.*, u.display_name AS owner_name, me.role AS my_role,
        (SELECT COUNT(*) FROM story_members m WHERE m.story_id = s.id) AS member_count,
        (SELECT COUNT(*) FROM posts p WHERE p.story_id = s.id) AS post_count,
        (SELECT COUNT(*) FROM posts p WHERE p.story_id = s.id AND p.user_id != :u
           AND p.id > COALESCE((SELECT last_read_id FROM channel_reads r WHERE r.channel_id = p.channel_id AND r.user_id = :u), 0)) AS unread,
        (SELECT COUNT(*) FROM notifications n WHERE n.story_id = s.id AND n.user_id = :u
           AND n.read_at IS NULL AND n.type IN ('mention', 'turn')) AS mentions
      FROM stories s JOIN users u ON u.id = s.owner_id
      JOIN story_members me ON me.story_id = s.id AND me.user_id = :u
      ORDER BY me.rail_pos IS NOT NULL, me.rail_pos, s.updated_at DESC, s.id DESC`).all({ u: user.id });
    const notificationsUnread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
    const reportsOpen = user.isAdmin ? db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n : 0;
    return {
      data: {
        stories: rows.map((row) => ({ ...toStory(row), role: row.my_role, unread: row.unread, mentions: row.mentions })),
        notificationsUnread,
        reportsOpen,
        messagesUnread: ctx.messageUnread?.(user.id) ?? 0,
        // The site's owner (the first admin): the only one who gets the "What's new" update notices.
        isOwner: user.id === db.prepare('SELECT MIN(id) AS id FROM users WHERE is_admin = 1').get().id,
        stats: ctx.userStats(user.id),
      },
    };
  });

  r.get('/api/stories', ({ user, query }) => {
    const scope = query.get('scope') || 'public';
    const q = (query.get('q') || '').trim().slice(0, 100);
    const where = [];
    const args = [];
    if (scope === 'mine') {
      requireUser(user);
      where.push('s.id IN (SELECT story_id FROM story_members WHERE user_id = ?)');
      args.push(user.id);
    } else {
      where.push("s.visibility = 'public'");
    }
    if (q) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.summary LIKE ? ESCAPE '\\' OR s.genre LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      args.push(like, like, like);
    }
    const rows = db.prepare(`${STORY_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.updated_at DESC, s.id DESC LIMIT 100`).all(...args);
    return { data: { stories: rows.map(toStory) } };
  });

  r.post('/api/stories', ({ user, body }) => {
    requireUser(user);
    const title = str(body.title, 'Title', { min: 1, max: 120, required: true });
    const fields = {
      summary: str(body.summary, 'Summary', { max: 5000 }) ?? '',
      genre: str(body.genre, 'Genre', { max: 60 }) ?? '',
      rating: oneOf(body.rating, 'Rating', ['G', 'T', 'M']) ?? 'T',
      cw: warnings(body.contentWarnings) ?? '',
      visibility: oneOf(body.visibility, 'Visibility', ['public', 'private']) ?? 'private',
      color: color(body.color) ?? STORY_COLORS[Math.floor(Math.random() * STORY_COLORS.length)],
      icon: uploadRef(db, body.icon, user.id) ?? null,
      banner: uploadRef(db, body.banner, user.id) ?? null,
    };
    const storyId = transaction(db, () => {
      const sid = Number(db.prepare(`INSERT INTO stories (owner_id, title, summary, genre, rating, content_warnings, visibility, color, icon, banner, invite_code)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(user.id, title, fields.summary, fields.genre, fields.rating, fields.cw, fields.visibility, fields.color, fields.icon, fields.banner, inviteCode()).lastInsertRowid);
      db.prepare("INSERT INTO story_members (story_id, user_id, role) VALUES (?, ?, 'owner')").run(sid, user.id);
      const ins = db.prepare(`INSERT INTO channels (story_id, name, topic, position, kind, created_by, last_post_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`);
      ins.run(sid, 'main-story', 'The story itself. Write in character here.', 0, 'thread', user.id);
      // Out-of-character talk happens in Messages (private, between writers) — no OOC channel.
      return sid;
    });
    const story = toStory(db.prepare(`${STORY_SELECT} WHERE s.id = ?`).get(storyId));
    return { status: 201, data: { story, channels: channelsFor(storyId, user.id) } };
  });

  r.get('/api/stories/:id', ({ user, params }) => {
    const { row, role } = storyAccess(db, params.id, user);
    const members = db.prepare(`
      SELECT u.*, m.role FROM story_members m JOIN users u ON u.id = m.user_id
      WHERE m.story_id = ? ORDER BY m.role = 'owner' DESC, u.display_name COLLATE NOCASE`).all(row.id)
      .map((m) => ({ ...toUser(m), role: m.role }));
    const cast = db.prepare(`
      SELECT c.* FROM characters c WHERE c.id IN (SELECT DISTINCT character_id FROM posts WHERE story_id = ?)
      ORDER BY c.name COLLATE NOCASE`).all(row.id).map(toCharacter);
    const story = toStory(row);
    if (role === 'owner' || user?.isAdmin) story.inviteCode = row.invite_code;
    const notify = role ? db.prepare('SELECT notify FROM story_members WHERE story_id = ? AND user_id = ?').get(row.id, user.id).notify : null;
    return { data: { story, role, notify, members, cast, channels: channelsFor(row.id, role ? user.id : null) } };
  });

  r.put('/api/stories/:id', ({ user, body, params }) => {
    requireUser(user);
    const { row, role } = storyAccess(db, params.id, user);
    requireOwner(role, user);
    const f = {
      title: str(body.title, 'Title', { min: 1, max: 120 }) ?? row.title,
      summary: str(body.summary, 'Summary', { max: 5000 }) ?? row.summary,
      genre: str(body.genre, 'Genre', { max: 60 }) ?? row.genre,
      rating: oneOf(body.rating, 'Rating', ['G', 'T', 'M']) ?? row.rating,
      cw: warnings(body.contentWarnings) ?? row.content_warnings,
      visibility: oneOf(body.visibility, 'Visibility', ['public', 'private']) ?? row.visibility,
      status: oneOf(body.status, 'Status', ['open', 'closed']) ?? row.status,
      color: color(body.color) ?? row.color,
      icon: uploadRef(db, body.icon, user.id),
      banner: uploadRef(db, body.banner, user.id),
      code: body.regenerateInvite ? inviteCode() : row.invite_code,
      // Mark the whole story complete (it moves to the Archive) or reopen it.
      completed: body.complete === undefined ? row.completed_at : body.complete ? (row.completed_at ?? new Date().toISOString().slice(0, 19).replace('T', ' ')) : null,
    };
    db.prepare(`UPDATE stories SET title = ?, summary = ?, genre = ?, rating = ?, content_warnings = ?, visibility = ?, status = ?,
      color = ?, icon = ?, banner = ?, invite_code = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(f.title, f.summary, f.genre, f.rating, f.cw, f.visibility, f.status, f.color,
        f.icon === undefined ? row.icon : f.icon, f.banner === undefined ? row.banner : f.banner, f.code, f.completed, row.id);
    const story = toStory(db.prepare(`${STORY_SELECT} WHERE s.id = ?`).get(row.id));
    story.inviteCode = f.code;
    storyChanged(row.id);
    return { data: { story } };
  });

  r.delete('/api/stories/:id', ({ user, params }) => {
    requireUser(user);
    const { row, role } = storyAccess(db, params.id, user);
    requireOwner(role, user);
    storyChanged(row.id);
    db.prepare('DELETE FROM stories WHERE id = ?').run(row.id);
    if (role !== 'owner') modLog(db, user.id, 'delete-story', `#${row.id} "${row.title}"`);
    return { data: { ok: true } };
  });

  r.post('/api/stories/:id/join', ({ user, body, params }) => {
    requireUser(user);
    const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(params.id);
    if (!row) fail(404, 'Story not found');
    if (membership(db, row.id, user.id)) return { data: { ok: true } };
    const codeMatches = typeof body.inviteCode === 'string' && body.inviteCode === row.invite_code;
    const asAdmin = adminCanSee(db, row, user);
    if (row.visibility === 'private' && !codeMatches && !asAdmin) fail(404, 'Story not found');
    if (db.prepare('SELECT 1 FROM story_bans WHERE story_id = ? AND user_id = ?').get(row.id, user.id) || isBlocked(db, row.owner_id, user.id)) {
      fail(403, "You can't join this story");
    }
    if (row.status === 'closed' && !codeMatches && !asAdmin) fail(403, 'This story is closed to new writers');
    db.prepare('INSERT INTO story_members (story_id, user_id) VALUES (?, ?)').run(row.id, user.id);
    catchUp(row.id, user.id);
    storyChanged(row.id);
    return { data: { ok: true } };
  });

  r.post('/api/stories/:id/leave', ({ user, params }) => {
    requireUser(user);
    const role = membership(db, params.id, user.id);
    if (!role) fail(400, 'You are not in this story');
    if (role === 'owner') fail(400, 'The owner cannot leave their own story');
    ctx.removeMember(params.id, user.id);
    return { data: { ok: true } };
  });

  // The owner adds a writer by username (the only way into a private story besides the invite link).
  r.post('/api/stories/:id/members', ({ user, body, params }) => {
    requireUser(user);
    const { row, role } = storyAccess(db, params.id, user);
    requireOwner(role, user);
    const name = String(body.username ?? '').trim().replace(/^@/, '');
    const target = name && db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(name);
    if (!target) fail(404, `Nobody is called @${name || '…'}`);
    if (membership(db, row.id, target.id)) fail(400, `@${target.username} is already in this story`);
    if (isBlocked(db, target.id, user.id) || isBlocked(db, user.id, target.id)) fail(403, "You can't add this person");
    db.prepare('DELETE FROM story_bans WHERE story_id = ? AND user_id = ?').run(row.id, target.id);
    db.prepare('INSERT INTO story_members (story_id, user_id) VALUES (?, ?)').run(row.id, target.id);
    catchUp(row.id, target.id);
    ctx.notify({ userId: target.id, type: 'added', actorId: user.id, storyId: row.id, text: `added you to ${row.title}` });
    storyChanged(row.id);
    return { status: 201, data: { member: { ...toUser(target), role: 'writer' } } };
  });

  r.post('/api/stories/:id/kick', ({ user, body, params }) => {
    requireUser(user);
    const { row, role } = storyAccess(db, params.id, user);
    requireOwner(role, user);
    const target = id(body.userId, 'User');
    if (target === row.owner_id) fail(400, "The owner can't be removed");
    if (!membership(db, row.id, target)) fail(400, 'That person is not in this story');
    ctx.removeMember(row.id, target);
    if (body.ban !== false) db.prepare('INSERT OR IGNORE INTO story_bans (story_id, user_id) VALUES (?, ?)').run(row.id, target);
    hub.sendUser(target, 'kicked', { storyId: row.id });
    return { data: { ok: true } };
  });

  r.put('/api/stories/:id/notify', ({ user, body, params }) => {
    requireUser(user);
    const level = oneOf(body.level, 'Level', ['all', 'mentions', 'none']) ?? fail(400, 'Level is required');
    const { changes } = db.prepare('UPDATE story_members SET notify = ? WHERE story_id = ? AND user_id = ?').run(level, params.id, user.id);
    if (!changes) fail(400, 'You are not in this story');
    return { data: { notify: level } };
  });

  // ---------- Channels ----------
  r.post('/api/channels/:id/read', ({ user, body, params }) => {
    requireUser(user);
    const { channel, role } = channelAccess(db, params.id, user);
    if (!role) return { data: { ok: true } };
    const max = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM posts WHERE channel_id = ?').get(channel.id).m;
    const last = Math.min(Number(body.lastId) || max, max);
    db.prepare(`INSERT INTO channel_reads (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(user.id, channel.id, last);
    db.prepare(`UPDATE notifications SET read_at = datetime('now')
      WHERE user_id = ? AND channel_id = ? AND read_at IS NULL AND (post_id IS NULL OR post_id <= ?)`).run(user.id, channel.id, last);
    return { data: { ok: true } };
  });

  // ---------- Turn order ----------
  r.put('/api/channels/:id/turns', ({ user, body, params }) => {
    requireUser(user);
    const { channel, role } = channelAccess(db, params.id, user);
    requireOwner(role, user);
    const enabled = body.enabled === undefined ? !!channel.turns_enabled : !!body.enabled;
    let order = JSON.parse(channel.turn_order);
    if (body.order !== undefined) {
      if (!Array.isArray(body.order) || body.order.length > 50) fail(400, 'Turn order must be a list of writers');
      order = [...new Set(body.order.map((u) => id(u, 'Writer')))];
      for (const u of order) if (!membership(db, channel.story_id, u)) fail(400, 'Everyone in the turn order must be in the story');
    }
    const index = body.current !== undefined ? Math.max(0, order.indexOf(Number(body.current))) : Math.min(channel.turn_index, Math.max(order.length - 1, 0));
    db.prepare('UPDATE channels SET turns_enabled = ?, turn_order = ?, turn_index = ? WHERE id = ?')
      .run(enabled ? 1 : 0, JSON.stringify(order), index, channel.id);
    const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.id);
    if (enabled && (!channel.turns_enabled || body.current !== undefined || body.order !== undefined)) ctx.notifyTurn(updated, user.id);
    hub.sendStory(channel.story_id, 'channel', toChannel(updated));
    return { data: { channel: toChannel(updated) } };
  });

  // The writer whose turn it is can pass; the owner can skip anyone.
  r.post('/api/channels/:id/turns/advance', ({ user, params }) => {
    requireUser(user);
    const { channel, role } = channelAccess(db, params.id, user);
    const { enabled, current } = turnState(channel);
    if (!enabled) fail(400, 'Turn order is off in this channel');
    if (current !== user.id && role !== 'owner') fail(403, "It's not your turn");
    return { data: { channel: toChannel(ctx.advanceTurn(channel, user.id)) } };
  });
}
