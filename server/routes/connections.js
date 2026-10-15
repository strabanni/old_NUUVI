// Connections: a writer puts out an idea for their muse ("looking for an ex who still has my
// hoodie…") on THE NU. Anyone can pick it up for one of their characters; once taken it stays
// on THE NU, locked, showing who took it.
import { fail, str } from '../http.js';
import { toCharacter, toUser, requireUser, uploadRef, isBlocked } from '../model.js';
import { transaction } from '../db.js';

export function connectionRoutes(r, ctx) {
  const { db } = ctx;
  const charById = db.prepare('SELECT * FROM characters WHERE id = ?');
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');

  // Everyone who has picked it up (group connections need more than one).
  const takersOf = db.prepare('SELECT * FROM connection_takers WHERE connection_id = ? ORDER BY taken_at, rowid');
  const toConnection = (row) => {
    const takers = takersOf.all(row.id).map((t) => ({
      character: toCharacter(charById.get(t.character_id)), userId: t.user_id, user: toUser(userById.get(t.user_id)), at: t.taken_at,
    })).filter((t) => t.character);
    const slots = row.slots || 1;
    return {
      type: 'connection',
      id: row.id, title: row.title, body: row.body, media: JSON.parse(row.media), userId: row.user_id,
      // Connections are posted by the writer, for one of their muses.
      author: toUser(userById.get(row.user_id)),
      tags: row.tags ? row.tags.split(',') : [],
      character: toCharacter(charById.get(row.character_id)),
      slots, takers, full: takers.length >= slots,
      takenBy: takers[0] ?? null,
      createdAt: row.created_at, sortAt: row.created_at,
    };
  };
  const slotsInput = (v, min = 1) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 20) fail(400, 'A connection can need from 1 to 20 people');
    if (n < min) fail(400, `${min} people have already picked it up`);
    return n;
  };
  const tagsInput = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
    .map((t) => String(t).trim().toLowerCase().replace(/^#/, '').slice(0, 30)).filter(Boolean))].slice(0, 8).join(',');
  // Keeps the old single-taker columns in step (the first person who picked it up).
  const syncLegacy = (cid) => {
    const first = db.prepare('SELECT * FROM connection_takers WHERE connection_id = ? ORDER BY taken_at, rowid LIMIT 1').get(cid);
    db.prepare('UPDATE connections SET taken_user_id = ?, taken_character_id = ?, taken_at = ? WHERE id = ?')
      .run(first?.user_id ?? null, first?.character_id ?? null, first?.taken_at ?? null, cid);
  };

  const load = (id, user) => {
    const row = db.prepare('SELECT * FROM connections WHERE id = ?').get(Number(id));
    if (!row || isBlocked(db, row.user_id, user.id) || isBlocked(db, user.id, row.user_id)) fail(404, 'Connection not found');
    return row;
  };
  const own = (characterId, userId) => db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(Number(characterId), userId)
    ?? fail(400, 'Pick one of your own characters');

  // For THE NU (newest first), skipping people you've blocked or who blocked you.
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
    const slots = slotsInput(body.slots) ?? 1;
    const { lastInsertRowid } = db.prepare('INSERT INTO connections (user_id, character_id, title, body, media, tags, slots) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, c.id, title, text, JSON.stringify(media), tagsInput(body.tags), slots);
    return { status: 201, data: { connection: toConnection(load(lastInsertRowid, user)) } };
  });

  // The writer who posted it (or an admin) edits it: words, pictures, tags, which muse, how many people.
  r.put('/api/connections/:id', ({ user, params, body }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id !== user.id && !user.isAdmin) fail(403, 'Only the writer who posted it can edit it');
    const taken = db.prepare('SELECT COUNT(*) AS n FROM connection_takers WHERE connection_id = ?').get(row.id).n;
    const keep = new Set(JSON.parse(row.media));
    const f = {
      title: str(body.title, 'Title', { min: 1, max: 140 }) ?? row.title,
      text: str(body.body, 'Details', { max: 8000 }) ?? row.body,
      tags: body.tags === undefined ? row.tags : tagsInput(body.tags),
      media: Array.isArray(body.media) ? body.media.slice(0, 10).map((v) => (keep.has(v) ? v : uploadRef(db, v, user.id) ?? fail(400, 'Picture missing'))) : JSON.parse(row.media),
      slots: slotsInput(body.slots, Math.max(1, taken)) ?? row.slots ?? 1,
      character: body.characterId === undefined || row.user_id !== user.id ? row.character_id : own(body.characterId, user.id).id,
    };
    db.prepare('UPDATE connections SET title = ?, body = ?, tags = ?, media = ?, slots = ?, character_id = ? WHERE id = ?')
      .run(f.title, f.text, f.tags, JSON.stringify(f.media), f.slots, f.character, row.id);
    return { data: { connection: toConnection(load(row.id, user)) } };
  });

  // Pick it up for one of your characters. It locks once everyone it needs has joined.
  r.post('/api/connections/:id/take', ({ user, params, body }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id === user.id) fail(400, "That's your own connection");
    const c = own(body.characterId, user.id);
    const taken = transaction(db, () => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM connection_takers WHERE connection_id = ?').get(row.id).n;
      if (n >= (row.slots || 1)) fail(409, n > 1 ? 'Everyone this connection needs has already joined' : 'Someone already picked this one up');
      if (db.prepare('SELECT 1 FROM connection_takers WHERE connection_id = ? AND character_id = ?').get(row.id, c.id)) fail(400, `${c.name} is already in this connection`);
      db.prepare('INSERT INTO connection_takers (connection_id, user_id, character_id) VALUES (?, ?, ?)').run(row.id, user.id, c.id);
      syncLegacy(row.id);
      return n + 1;
    });
    ctx.notify({ userId: row.user_id, type: 'connection', actorId: user.id, characterId: c.id,
      text: `${c.name} picked up “${row.title}”${(row.slots || 1) > 1 ? ` (${taken}/${row.slots})` : ''}` });
    return { data: { connection: toConnection(load(row.id, user)) } };
  });

  // Leave it (people who picked it up), or open it up again (the writer who posted it: one person,
  // or everyone).
  r.post('/api/connections/:id/release', ({ user, params, body }) => {
    requireUser(user);
    const row = load(params.id, user);
    const owner = row.user_id === user.id || user.isAdmin;
    const cid = body?.characterId != null ? Number(body.characterId) : null;
    if (owner) {
      if (cid) db.prepare('DELETE FROM connection_takers WHERE connection_id = ? AND character_id = ?').run(row.id, cid);
      else db.prepare('DELETE FROM connection_takers WHERE connection_id = ?').run(row.id);
    } else {
      const { changes } = db.prepare(`DELETE FROM connection_takers WHERE connection_id = ? AND user_id = ?${cid ? ' AND character_id = ?' : ''}`)
        .run(...[row.id, user.id, ...(cid ? [cid] : [])]);
      if (!changes) fail(403, 'Only the people in this connection can leave it');
    }
    syncLegacy(row.id);
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
