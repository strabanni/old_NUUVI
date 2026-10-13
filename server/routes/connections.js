// Connections: a writer puts out an idea for their muse ("looking for an ex who still has my
// hoodie…") on THE : NU. Anyone can pick it up for one of their characters; once taken it stays
// on THE : NU, locked, showing who took it.
import { fail, str } from '../http.js';
import { toCharacter, requireUser, uploadRef, isBlocked } from '../model.js';

export function connectionRoutes(r, ctx) {
  const { db } = ctx;
  const charById = db.prepare('SELECT * FROM characters WHERE id = ?');

  const toConnection = (row) => {
    const taker = row.taken_character_id ? charById.get(row.taken_character_id) : null;
    return {
      type: 'connection',
      id: row.id, title: row.title, body: row.body, media: JSON.parse(row.media), userId: row.user_id,
      tags: row.tags ? row.tags.split(',') : [],
      character: toCharacter(charById.get(row.character_id)),
      takenBy: taker ? { character: toCharacter(taker), userId: row.taken_user_id, at: row.taken_at } : null,
      createdAt: row.created_at, sortAt: row.created_at,
    };
  };
  const load = (id, user) => {
    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(Number(id));
    if (!row || isBlocked(db, row.user_id, user.id) || isBlocked(db, user.id, row.user_id)) fail(404, 'Connection not found');
    return row;
  };
  const own = (characterId, userId) => db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(Number(characterId), userId)
    ?? fail(400, 'Pick one of your own characters');

  // For THE : NU (newest first), skipping people you've blocked or who blocked you.
  ctx.connectionItems = ({ userId, q = '', limit = 60 }) => db.prepare(`
    SELECT * FROM connections k
    WHERE k.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = :u) AND k.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = :u)
      ${q ? "AND (k.title LIKE :q OR k.body LIKE :q OR k.tags LIKE :q)" : ''}
    ORDER BY k.created_at DESC, k.id DESC LIMIT ${Number(limit)}`).all({ u: userId, ...(q ? { q: `%${q}%` } : {}) }).map(toConnection);

  r.get('/api/connections/:id', ({ user, params }) => {
    requireUser(user);
    return { data: { connection: toConnection(load(params.id, user)) } };
  });

  r.post('/api/connections', ({ user, body }) => {
    requireUser(user);
    const c = own(body.characterId, user.id);
    const title = str(body.title, 'Title', { min: 1, max: 140, required: true });
    const text = str(body.body, 'Details', { max: 8000 }) ?? '';
    const media = (Array.isArray(body.media) ? body.media.slice(0, 10) : []).map((v) => uploadRef(db, v, user.id) ?? fail(400, 'Picture missing'));
    const tags = [...new Set((Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(','))
      .map((t) => String(t).trim().toLowerCase().replace(/^#/, '').slice(0, 30)).filter(Boolean))].slice(0, 8).join(',');
    const { lastInsertRowid } = db.prepare('INSERT INTO connections (user_id, character_id, title, body, media, tags) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, c.id, title, text, JSON.stringify(media), tags);
    return { status: 201, data: { connection: toConnection(load(lastInsertRowid, user)) } };
  });

  // Pick it up for one of your characters. Locks it.
  r.post('/api/connections/:id/take', ({ user, params, body }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id === user.id) fail(400, "That's your own connection");
    const c = own(body.characterId, user.id);
    const { changes } = db.prepare(`UPDATE connections SET taken_user_id = ?, taken_character_id = ?, taken_at = datetime('now')
      WHERE id = ? AND taken_user_id IS NULL`).run(user.id, c.id, row.id);
    if (!changes) fail(409, 'Someone already picked this one up');
    ctx.notify({ userId: row.user_id, type: 'connection', actorId: user.id, characterId: c.id, text: `${c.name} picked up “${row.title}”` });
    return { data: { connection: toConnection(load(row.id, user)) } };
  });

  // Open it up again (the person who took it, or the writer who posted it).
  r.post('/api/connections/:id/release', ({ user, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.taken_user_id !== user.id && row.user_id !== user.id && !user.isAdmin) fail(403, 'Only the people in this connection can reopen it');
    db.prepare('UPDATE connections SET taken_user_id = NULL, taken_character_id = NULL, taken_at = NULL WHERE id = ?').run(row.id);
    return { data: { connection: toConnection(load(row.id, user)) } };
  });

  r.delete('/api/connections/:id', ({ user, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id !== user.id && !user.isAdmin) fail(404, 'Connection not found');
    db.prepare('DELETE FROM connections WHERE id = ?').run(row.id);
    return { data: { ok: true } };
  });
}
