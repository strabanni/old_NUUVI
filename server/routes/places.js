// The Locations directory: places in Ardell City (restaurants, clubs, apartments, parks…) that
// anyone can add, with a picture, the borough it's in, the kind of venue and a pin on the city map
// (a live street map of New York, which Ardell City is based on; pins are latitude/longitude).
// Whoever added a place (or an admin) can change or remove it. The map shows who's where right now:
// characters in open episodes set at a place (the latest scene move in the episode counts).
import { fail, str } from '../http.js';
import { requireUser, uploadRef } from '../model.js';
import { ARDELL_INTRO, seedArdell, seedPlacePhotos } from '../ardell.js';

const picturesOf = (r) => {
  try {
    const g = JSON.parse(r.gallery || '[]');
    return g.length ? g : r.picture ? [r.picture] : [];
  } catch {
    return r.picture ? [r.picture] : [];
  }
};
const toPlace = (r) => ({
  id: r.id,
  name: r.name,
  picture: picturesOf(r)[0] ?? null,
  pictures: picturesOf(r),
  borough: r.borough,
  venue: r.venue,
  description: r.description,
  createdAt: r.created_at,
  owner: { id: r.user_id, username: r.username, displayName: r.display_name },
  lat: r.lat ?? null,
  lng: r.lng ?? null,
  hours: r.hours ?? '',
  price: r.price ?? '',
  since: r.since ?? '',
});
// A pin on the map: somewhere around the city (the map doesn't go further than this).
const BOUNDS = { lat: [40.3, 41.2], lng: [-74.6, -73.4] };
function pinInput(lat, lng) {
  if (lat === undefined && lng === undefined) return undefined;
  if (lat === null || lng === null || lat === '' || lng === '') return null;
  const a = Number(lat);
  const o = Number(lng);
  if (
    !Number.isFinite(a) ||
    !Number.isFinite(o) ||
    a < BOUNDS.lat[0] ||
    a > BOUNDS.lat[1] ||
    o < BOUNDS.lng[0] ||
    o > BOUNDS.lng[1]
  )
    fail(400, 'Pin the place somewhere in the city');
  return [Math.round(a * 1e6) / 1e6, Math.round(o * 1e6) / 1e6];
}

export function placeRoutes(r, ctx) {
  const { db } = ctx;
  const SELECT = 'SELECT l.*, u.username, u.display_name FROM locations l JOIN users u ON u.id = l.user_id';
  const load = (id) => db.prepare(`${SELECT} WHERE l.id = ?`).get(id) ?? fail(404, 'Place not found');
  const fields = (body, existing = {}) => {
    const name = str(body.name, 'Name', { min: 1, max: 80, required: !existing.name }) ?? existing.name;
    return {
      name: name.trim(),
      borough: (str(body.borough, 'Borough', { max: 40 }) ?? existing.borough ?? '').trim(),
      venue: (str(body.venue, 'Type of venue', { max: 60 }) ?? existing.venue ?? '').trim(),
      description: str(body.description, 'Description', { max: 2000 }) ?? existing.description ?? '',
      hours: (str(body.hours, 'Hours', { max: 80 }) ?? existing.hours ?? '').trim(),
      price: (str(body.price, 'Price range', { max: 80 }) ?? existing.price ?? '').trim(),
      since: (str(body.since, 'Year', { max: 60 }) ?? existing.since ?? '').trim(),
    };
  };
  // A place's pictures (up to 12; the first is the cover). Pictures it already has stay as they are
  // (including ones that came with NUUVI); new ones must be uploads or picture links.
  const picturesInput = (body, user, row = null) => {
    let list = body.pictures;
    if (list === undefined && body.picture !== undefined) list = body.picture ? [body.picture] : [];
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) fail(400, 'Pictures must be a list');
    if (list.length > 12) fail(400, 'Up to 12 pictures');
    const had = row ? picturesOf(row) : [];
    return list.filter(Boolean).map((v) => (had.includes(v) ? v : uploadRef(db, v, user.id)));
  };
  const taken = (name, id = 0) => db.prepare('SELECT 1 FROM locations WHERE name = ? COLLATE NOCASE AND id != ?').get(name, id);

  // Who's where: for each open episode the viewer can see, its current place (the latest post that
  // moved the scene, else the episode's own location) and the characters in it. A character in
  // several episodes shows at the one with the most recent post.
  function whoIsWhere(userId) {
    const rows = db
      .prepare(
        `SELECT c.id, c.story_id, c.name, c.kind,
        COALESCE((SELECT p.location FROM posts p WHERE p.channel_id = c.id AND p.location IS NOT NULL ORDER BY p.id DESC LIMIT 1), c.location) AS place,
        COALESCE(c.last_post_at, c.created_at) AS active_at
      FROM channels c JOIN stories s ON s.id = c.story_id
      WHERE c.kind IN ('thread', 'para', 'event') AND c.status = 'open' AND s.completed_at IS NULL
        AND (s.visibility = 'public' OR s.id IN (SELECT story_id FROM story_members WHERE user_id = :u))
      ORDER BY active_at DESC`,
      )
      .all({ u: userId });
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
        byPlace.get(key).push({
          id: ch.id,
          name: ch.name,
          handle: ch.handle,
          avatar: ch.avatar,
          color: ch.color,
          gradient: ch.gradient ? ch.gradient.split(',') : null,
          episode: { id: ep.id, storyId: ep.story_id, name: ep.name },
        });
      }
    }
    return byPlace;
  }

  // Ardell City's guide (boroughs and spots) is added once there's an admin.
  seedArdell(db);
  seedPlacePhotos(db);

  r.get('/api/places', ({ user }) => {
    requireUser(user);
    seedArdell(db);
    seedPlacePhotos(db);
    const here = whoIsWhere(user.id);
    const places = db
      .prepare(`${SELECT} ORDER BY l.name COLLATE NOCASE`)
      .all()
      .map((row) => ({ ...toPlace(row), here: here.get(row.name.trim().toLowerCase()) || [] }));
    const distinct = (k) => [...new Set(places.map((p) => p[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    // The boroughs: Ardell City's own first (in order, with what each is like), then any others places use.
    const known = db.prepare('SELECT name, blurb, lat, lng FROM boroughs ORDER BY position, name').all();
    const others = distinct('borough').filter((b) => !known.some((k) => k.name.toLowerCase() === b.toLowerCase()));
    const boroughs = [...known.map((b) => b.name), ...others];
    return { data: { places, boroughs, venues: distinct('venue'), districts: known, intro: ARDELL_INTRO } };
  });

  r.post('/api/places', ({ user, body }) => {
    requireUser(user);
    const f = fields(body);
    if (taken(f.name)) fail(409, `${f.name} is already in the directory`);
    const pictures = picturesInput(body, user) ?? [];
    const pin = pinInput(body.lat, body.lng) ?? [null, null];
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO locations (user_id, name, picture, gallery, borough, venue, description, hours, price, since, lat, lng)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.id,
        f.name,
        pictures[0] ?? null,
        JSON.stringify(pictures),
        f.borough,
        f.venue,
        f.description,
        f.hours,
        f.price,
        f.since,
        pin[0],
        pin[1],
      );
    return { status: 201, data: { place: toPlace(load(lastInsertRowid)) } };
  });

  r.put('/api/places/:id', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id);
    if (row.user_id !== user.id && !user.isAdmin) fail(403, 'Only whoever added this place (or an admin) can change it');
    const f = fields(body, row);
    if (taken(f.name, row.id)) fail(409, `${f.name} is already in the directory`);
    const pictures = picturesInput(body, user, row) ?? picturesOf(row);
    const pin = pinInput(body.lat, body.lng);
    const [lat, lng] = pin === undefined ? [row.lat, row.lng] : (pin ?? [null, null]);
    db.prepare(
      'UPDATE locations SET name = ?, picture = ?, gallery = ?, borough = ?, venue = ?, description = ?, hours = ?, price = ?, since = ?, lat = ?, lng = ? WHERE id = ?',
    ).run(
      f.name,
      pictures[0] ?? null,
      JSON.stringify(pictures),
      f.borough,
      f.venue,
      f.description,
      f.hours,
      f.price,
      f.since,
      lat,
      lng,
      row.id,
    );
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
