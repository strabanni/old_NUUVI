// The Locations directory: places in Ardell City (restaurants, clubs, apartments, parks…) that
// anyone can add, with a picture, the borough it's in, the kind of venue and a pin on the city map.
// Whoever added a place (or an admin) can change or remove it. The map shows who's where right now:
// characters in open episodes set at a place (the latest scene move in the episode counts).
import { fail, str } from '../http.js';
import { requireUser, uploadRef } from '../model.js';

const toPlace = (r) => ({
  id: r.id, name: r.name, picture: r.picture ?? null, borough: r.borough, venue: r.venue, description: r.description,
  createdAt: r.created_at, owner: { id: r.user_id, username: r.username, displayName: r.display_name },
  x: r.map_x ?? null, y: r.map_y ?? null,
});
const coord = (v) => (v === null || v === '' ? null : Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : fail(400, 'Map position must be a number'));

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

  // Who's where: for each open episode the viewer can see, its current place (the latest post that
  // moved the scene, else the episode's own location) and the characters in it. A character in
  // several episodes shows at the one with the most recent post.
  function whoIsWhere(userId) {
    const rows = db.prepare(`SELECT c.id, c.story_id, c.name, c.kind,
        COALESCE((SELECT p.location FROM posts p WHERE p.channel_id = c.id AND p.location IS NOT NULL ORDER BY p.id DESC LIMIT 1), c.location) AS place,
        COALESCE(c.last_post_at, c.created_at) AS active_at
      FROM channels c JOIN stories s ON s.id = c.story_id
      WHERE c.kind IN ('thread', 'para', 'event') AND c.status = 'open' AND s.completed_at IS NULL
        AND (s.visibility = 'public' OR s.id IN (SELECT story_id FROM story_members WHERE user_id = :u))
      ORDER BY active_at DESC`).all({ u: userId });
    const cast = db.prepare(`SELECT ch.id, ch.name, ch.handle, ch.avatar, ch.color, ch.gradient FROM channel_characters cc
      JOIN characters ch ON ch.id = cc.character_id WHERE cc.channel_id = ?`);
    const seen = new Set();
    const byPlace = new Map();
    for (const ep of rows) {
      if (!ep.place) continue;
      const key = ep.place.trim().toLowerCase();
      for (const ch of cast.all(ep.id)) {
        if (seen.has(ch.id)) continue;
        seen.add(ch.id);
        if (!byPlace.has(key)) byPlace.set(key, []);
        byPlace.get(key).push({ id: ch.id, name: ch.name, handle: ch.handle, avatar: ch.avatar, color: ch.color,
          gradient: ch.gradient ? ch.gradient.split(',') : null, episode: { id: ep.id, storyId: ep.story_id, name: ep.name } });
      }
    }
    return byPlace;
  }

  r.get('/api/places', ({ user }) => {
    requireUser(user);
    const here = whoIsWhere(user.id);
    const places = db.prepare(`${SELECT} ORDER BY l.name COLLATE NOCASE`).all().map((row) => ({ ...toPlace(row), here: here.get(row.name.trim().toLowerCase()) || [] }));
    const distinct = (k) => [...new Set(places.map((p) => p[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const map = db.prepare("SELECT value FROM settings WHERE key = 'city_map'").get()?.value || null;
    return { data: { places, boroughs: distinct('borough'), venues: distinct('venue'), map } };
  });

  // Admins can swap the drawn map for their own picture of Ardell City (empty: back to the drawn one).
  r.put('/api/places/map', ({ user, body }) => {
    requireUser(user);
    if (!user.isAdmin) fail(403, 'Only admins can change the city map');
    const picture = uploadRef(db, body.picture, user.id);
    if (picture) db.prepare("INSERT INTO settings (key, value) VALUES ('city_map', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(picture);
    else db.prepare("DELETE FROM settings WHERE key = 'city_map'").run();
    return { data: { map: picture || null } };
  });

  r.post('/api/places', ({ user, body }) => {
    requireUser(user);
    const f = fields(body);
    if (taken(f.name)) fail(409, `${f.name} is already in the directory`);
    const picture = uploadRef(db, body.picture, user.id) ?? null;
    const { lastInsertRowid } = db.prepare('INSERT INTO locations (user_id, name, picture, borough, venue, description, map_x, map_y) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, f.name, picture, f.borough, f.venue, f.description, coord(body.x ?? null), coord(body.y ?? null));
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
    db.prepare('UPDATE locations SET name = ?, picture = ?, borough = ?, venue = ?, description = ?, map_x = ?, map_y = ? WHERE id = ?')
      .run(f.name, picture === undefined ? row.picture : picture, f.borough, f.venue, f.description,
        body.x === undefined ? row.map_x : coord(body.x), body.y === undefined ? row.map_y : coord(body.y), row.id);
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
