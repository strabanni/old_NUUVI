// The Locations directory: places in Ardell City (restaurants, clubs, apartments, parks…) that
// anyone can add, with a picture, the borough it's in and the kind of venue. Whoever added a place
// (or an admin) can change or remove it.
import { fail, str } from '../http.js';
import { requireUser, uploadRef } from '../model.js';

const toPlace = (r) => ({
  id: r.id, name: r.name, picture: r.picture ?? null, borough: r.borough, venue: r.venue, description: r.description,
  createdAt: r.created_at, owner: { id: r.user_id, username: r.username, displayName: r.display_name },
});

export function placeRoutes(r, ctx) {
  const { db } = ctx;
  const SELECT = 'SELECT l.*, u.username, u.display_name FROM locations l JOIN users u ON u.id = l.user_id';
  const load = (id) => db.prepare(`${SELECT} WHERE l.id = ?`).get(id) ?? fail(404, 'Place not found');
  const fields = (body, existing = {}) => {
    const name = str(body.name, 'Name', { min: 1, max: 80, required: !existing.name }) ?? existing.name;
    return {
      name: name.trim(),
      borough: (str(body.borough, 'Borough', { max: 40 }) ?? existing.borough ?? '').trim(),
      venue: (str(body.venue, 'Type of venue', { max: 40 }) ?? existing.venue ?? '').trim(),
      description: str(body.description, 'Description', { max: 2000 }) ?? existing.description ?? '',
    };
  };
  const taken = (name, id = 0) => db.prepare('SELECT 1 FROM locations WHERE name = ? COLLATE NOCASE AND id != ?').get(name, id);

  r.get('/api/places', ({ user }) => {
    requireUser(user);
    const places = db.prepare(`${SELECT} ORDER BY l.name COLLATE NOCASE`).all().map(toPlace);
    const distinct = (k) => [...new Set(places.map((p) => p[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { data: { places, boroughs: distinct('borough'), venues: distinct('venue') } };
  });

  r.post('/api/places', ({ user, body }) => {
    requireUser(user);
    const f = fields(body);
    if (taken(f.name)) fail(409, `${f.name} is already in the directory`);
    const picture = uploadRef(db, body.picture, user.id) ?? null;
    const { lastInsertRowid } = db.prepare('INSERT INTO locations (user_id, name, picture, borough, venue, description) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, f.name, picture, f.borough, f.venue, f.description);
    return { status: 201, data: { place: toPlace(load(lastInsertRowid)) } };
  });

  r.put('/api/places/:id', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id);
    if (row.user_id !== user.id && !user.isAdmin) fail(403, 'Only whoever added this place (or an admin) can change it');
    const f = fields(body, row);
    if (taken(f.name, row.id)) fail(409, `${f.name} is already in the directory`);
    // Someone else's picture stays as it was unless a new one is chosen.
    const picture = body.picture === row.picture ? row.picture : uploadRef(db, body.picture, user.id);
    db.prepare('UPDATE locations SET name = ?, picture = ?, borough = ?, venue = ?, description = ? WHERE id = ?')
      .run(f.name, picture === undefined ? row.picture : picture, f.borough, f.venue, f.description, row.id);
    return { data: { place: toPlace(load(row.id)) } };
  });

  r.delete('/api/places/:id', ({ user, params }) => {
    requireUser(user);
    const row = load(params.id);
    if (row.user_id !== user.id && !user.isAdmin) fail(403, 'Only whoever added this place (or an admin) can remove it');
    db.prepare('DELETE FROM locations WHERE id = ?').run(row.id);
    if (row.user_id !== user.id) ctx.modLog(user.id, 'delete-place', row.name);
    return { data: { ok: true } };
  });
}
