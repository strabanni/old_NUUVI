// Messages: private conversations between writers (out of character). Only the two people in a
// conversation can ever read it; blocking either way stops new messages.
import { fail, str } from '../http.js';
import { toUser, requireUser, uploadRef, isBlocked } from '../model.js';

const MAX_TEXT = 4000;

export function messageRoutes(r, ctx) {
  const { db, hub } = ctx;
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?');
  const pair = (a, b) => (a < b ? [a, b] : [b, a]);

  const threadWith = (me, otherId, create = false) => {
    const other = userRow.get(Number(otherId));
    if (!other || other.id === me) fail(404, 'Person not found');
    const [a, b] = pair(me, other.id);
    let t = db.prepare('SELECT * FROM dm_threads WHERE user_a = ? AND user_b = ?').get(a, b);
    if (!t && create) {
      db.prepare('INSERT INTO dm_threads (user_a, user_b) VALUES (?, ?)').run(a, b);
      t = db.prepare('SELECT * FROM dm_threads WHERE user_a = ? AND user_b = ?').get(a, b);
    }
    return { t, other };
  };
  const toMessage = (m) => ({ id: m.id, userId: m.user_id, body: m.body, media: JSON.parse(m.media), createdAt: m.created_at });

  // Unread conversations, for the badge.
  ctx.messageUnread = (userId) => db.prepare(`
    SELECT COUNT(*) AS n FROM dm_threads t
    WHERE (t.user_a = :u OR t.user_b = :u) AND EXISTS (SELECT 1 FROM dm_messages m WHERE m.thread_id = t.id AND m.user_id != :u
      AND m.id > COALESCE((SELECT last_read_id FROM dm_reads r WHERE r.thread_id = t.id AND r.user_id = :u), 0))`).get({ u: userId }).n;

  r.get('/api/messages', ({ user }) => {
    requireUser(user);
    const rows = db.prepare(`
      SELECT t.*, (SELECT MAX(id) FROM dm_messages WHERE thread_id = t.id) AS last_id,
        (SELECT COUNT(*) FROM dm_messages m WHERE m.thread_id = t.id AND m.user_id != :u
          AND m.id > COALESCE((SELECT last_read_id FROM dm_reads r WHERE r.thread_id = t.id AND r.user_id = :u), 0)) AS unread
      FROM dm_threads t WHERE (t.user_a = :u OR t.user_b = :u) AND t.last_at IS NOT NULL
      ORDER BY t.last_at DESC`).all({ u: user.id });
    const last = db.prepare('SELECT * FROM dm_messages WHERE id = ?');
    return {
      data: {
        conversations: rows.map((t) => {
          const other = userRow.get(t.user_a === user.id ? t.user_b : t.user_a);
          const m = t.last_id ? last.get(t.last_id) : null;
          return {
            id: t.id, with: toUser(other), unread: t.unread, lastAt: t.last_at,
            last: m ? { mine: m.user_id === user.id, text: m.body || (JSON.parse(m.media).length ? 'Photo' : '') } : null,
          };
        }),
      },
    };
  });

  r.get('/api/messages/:userId', ({ user, params, query }) => {
    requireUser(user);
    const { t, other } = threadWith(user.id, params.userId);
    const before = Number(query.get('before')) || null;
    const msgs = t ? db.prepare(`SELECT * FROM dm_messages WHERE thread_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 61`)
      .all(...[t.id, ...(before ? [before] : [])]) : [];
    const hasMore = msgs.length > 60;
    return {
      data: {
        with: toUser(other), blocked: isBlocked(db, user.id, other.id) || isBlocked(db, other.id, user.id),
        messages: msgs.slice(0, 60).reverse().map(toMessage), hasMore,
      },
    };
  });

  r.post('/api/messages/:userId', ({ user, params, body }) => {
    requireUser(user);
    const { t, other } = threadWith(user.id, params.userId, true);
    if (isBlocked(db, user.id, other.id) || isBlocked(db, other.id, user.id)) fail(403, "You can't message this person");
    const text = str(body.body, 'Message', { max: MAX_TEXT }) ?? '';
    const media = (Array.isArray(body.media) ? body.media.slice(0, 10) : []).map((v) => uploadRef(db, v, user.id) ?? fail(400, 'Picture missing'));
    if (!text && !media.length) fail(400, 'Write something or add a picture');
    const { lastInsertRowid } = db.prepare('INSERT INTO dm_messages (thread_id, user_id, body, media) VALUES (?, ?, ?, ?)').run(t.id, user.id, text, JSON.stringify(media));
    db.prepare("UPDATE dm_threads SET last_at = datetime('now') WHERE id = ?").run(t.id);
    db.prepare(`INSERT INTO dm_reads (thread_id, user_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(thread_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id`).run(t.id, user.id, lastInsertRowid);
    const message = toMessage(db.prepare('SELECT * FROM dm_messages WHERE id = ?').get(lastInsertRowid));
    for (const u of [user.id, other.id]) hub.sendUser(u, 'message', { ...message, threadId: t.id, between: [user.id, other.id] });
    ctx.notify({ userId: other.id, type: 'message', actorId: user.id, text: text.slice(0, 140) || 'sent a photo' });
    return { status: 201, data: { message } };
  });

  r.post('/api/messages/:userId/read', ({ user, params }) => {
    requireUser(user);
    const { t } = threadWith(user.id, params.userId);
    if (!t) return { data: { ok: true } };
    const last = db.prepare('SELECT MAX(id) AS id FROM dm_messages WHERE thread_id = ?').get(t.id).id || 0;
    db.prepare(`INSERT INTO dm_reads (thread_id, user_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(thread_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`).run(t.id, user.id, last);
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND type = 'message' AND actor_id = ? AND read_at IS NULL").run(user.id, Number(params.userId));
    return { data: { ok: true } };
  });

  r.delete('/api/messages/item/:id', ({ user, params }) => {
    requireUser(user);
    const m = db.prepare('SELECT m.*, t.user_a, t.user_b FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id WHERE m.id = ?').get(Number(params.id));
    if (!m || m.user_id !== user.id) fail(404, 'Message not found');
    db.prepare('DELETE FROM dm_messages WHERE id = ?').run(m.id);
    for (const u of [m.user_a, m.user_b]) hub.sendUser(u, 'message-delete', { id: m.id, threadId: m.thread_id });
    return { data: { ok: true } };
  });
}
