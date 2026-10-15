// Character plans on the calendar: appointments, fittings, surgeries, work shifts, dates, classes…
// Just for fun and for building out characters' lives; they're separate from story events. Plans can
// repeat (work schedules). Everyone sees them unless the writer keeps one to themselves.
import { fail, str, oneOf } from '../http.js';
import { requireUser, isBlocked } from '../model.js';

export const PLAN_KINDS = ['appointment', 'doctor', 'fitting', 'surgery', 'work', 'date', 'class', 'trip', 'party', 'other'];
export const PLAN_REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'biweekly', 'monthly'];

const when = (v, label, required = false) => {
  if (v === undefined || v === null || v === '') { if (required) fail(400, `Add the ${label}`); return null; }
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900 || d.getFullYear() > 2200) fail(400, `That ${label} doesn't look right`);
  return d.toISOString();
};

export function planRoutes(r, ctx) {
  const { db } = ctx;
  const SELECT = `SELECT p.*, c.name AS c_name, c.handle AS c_handle, c.avatar AS c_avatar, c.color AS c_color, c.gradient AS c_gradient,
    u.username AS u_name, u.display_name AS u_display FROM plans p JOIN users u ON u.id = p.user_id LEFT JOIN characters c ON c.id = p.character_id`;
  const toPlan = (p) => ({
    id: p.id, kind: p.kind, title: p.title, startsAt: p.starts_at, endsAt: p.ends_at, allDay: !!p.all_day,
    repeat: p.repeat, repeatUntil: p.repeat_until, location: p.location, notes: p.notes, private: !!p.private, userId: p.user_id,
    owner: { id: p.user_id, username: p.u_name, displayName: p.u_display },
    character: p.character_id ? { id: p.character_id, name: p.c_name, handle: p.c_handle, avatar: p.c_avatar, color: p.c_color,
      gradient: p.c_gradient ? p.c_gradient.split(',') : null } : null,
  });
  const fields = (body, old = {}) => {
    const title = (str(body.title, 'Title', { max: 120, required: !old.title }) ?? old.title).trim();
    if (!title) fail(400, 'Give the plan a name');
    const startsAt = body.startsAt === undefined ? old.starts_at : when(body.startsAt, 'start time', true);
    const endsAt = body.endsAt === undefined ? old.ends_at ?? null : when(body.endsAt, 'end time');
    if (endsAt && endsAt < startsAt) fail(400, 'The plan ends before it starts');
    const repeat = oneOf(body.repeat, 'Repeat', PLAN_REPEATS) ?? old.repeat ?? 'none';
    return {
      title, startsAt, endsAt, repeat,
      kind: oneOf(body.kind, 'Kind', PLAN_KINDS) ?? old.kind ?? 'other',
      allDay: body.allDay === undefined ? old.all_day ?? 0 : body.allDay ? 1 : 0,
      repeatUntil: repeat === 'none' ? null : body.repeatUntil === undefined ? old.repeat_until ?? null : when(body.repeatUntil, 'last day'),
      location: (str(body.location, 'Where', { max: 200 }) ?? old.location ?? '').trim(),
      notes: str(body.notes, 'Notes', { max: 3000 }) ?? old.notes ?? '',
      private: body.private === undefined ? old.private ?? 0 : body.private ? 1 : 0,
    };
  };
  // Whose plan it is: one of your characters, or just you (no character).
  const characterFor = (value, user) => {
    if (value === null || value === '' || value === undefined) return null;
    const c = db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(Number(value), user.id);
    if (!c) fail(400, 'Choose one of your own characters');
    return c.id;
  };
  const load = (id, user) => {
    const row = db.prepare(`${SELECT} WHERE p.id = ?`).get(id);
    if (!row || (row.private && row.user_id !== user.id)) fail(404, 'Plan not found');
    return row;
  };

  // Everyone's plans you can see (yours, and others' that aren't private). ?character= narrows it.
  r.get('/api/plans', ({ user, query }) => {
    requireUser(user);
    const cid = Number(query.get('character')) || null;
    const rows = db.prepare(`${SELECT} WHERE (p.private = 0 OR p.user_id = :u) ${cid ? 'AND p.character_id = :c' : ''}
      ORDER BY p.starts_at LIMIT 3000`).all({ u: user.id, ...(cid ? { c: cid } : {}) })
      .filter((p) => p.user_id === user.id || (!isBlocked(db, p.user_id, user.id) && !isBlocked(db, user.id, p.user_id)));
    return { data: { plans: rows.map(toPlan) } };
  });

  r.post('/api/plans', ({ user, body }) => {
    requireUser(user);
    const f = fields(body);
    const characterId = characterFor(body.characterId, user);
    const { lastInsertRowid } = db.prepare(`INSERT INTO plans (user_id, character_id, kind, title, starts_at, ends_at, all_day, repeat, repeat_until, location, notes, private)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, characterId, f.kind, f.title, f.startsAt, f.endsAt, f.allDay, f.repeat, f.repeatUntil, f.location, f.notes, f.private);
    return { status: 201, data: { plan: toPlan(load(lastInsertRowid, user)) } };
  });

  r.put('/api/plans/:id', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id !== user.id) fail(403, 'Only whoever made this plan can change it');
    const f = fields(body, row);
    const characterId = body.characterId === undefined ? row.character_id : characterFor(body.characterId, user);
    db.prepare(`UPDATE plans SET character_id = ?, kind = ?, title = ?, starts_at = ?, ends_at = ?, all_day = ?, repeat = ?, repeat_until = ?, location = ?, notes = ?, private = ?
      WHERE id = ?`).run(characterId, f.kind, f.title, f.startsAt, f.endsAt, f.allDay, f.repeat, f.repeatUntil, f.location, f.notes, f.private, row.id);
    return { data: { plan: toPlan(load(row.id, user)) } };
  });

  r.delete('/api/plans/:id', ({ user, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id !== user.id && !user.isAdmin) fail(403, 'Only whoever made this plan can delete it');
    db.prepare('DELETE FROM plans WHERE id = ?').run(row.id);
    return { data: { ok: true } };
  });
}
