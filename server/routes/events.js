// Calendar events. Each event belongs to a story; threads and comms can be part of an event,
// and an event's page lists every thread in it.
import { fail, str } from '../http.js';
import { toCharacter, requireUser, storyAccess, uploadRef } from '../model.js';

function dateInput(value, field, { required = false } = {}) {
  if (value === undefined) return required ? fail(400, `${field} is required`) : undefined;
  if (value === null || value === '') return required ? fail(400, `${field} is required`) : null;
  const d = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) fail(400, `${field} is invalid`);
  return d.toISOString();
}

export function eventRoutes(r, ctx) {
  const { db, hub } = ctx;
  const VISIBLE = `(s.visibility = 'public' OR s.id IN (SELECT story_id FROM story_members WHERE user_id = :u))`;
  const SELECT = `SELECT e.*, s.title AS story_title, s.color AS story_color, s.icon AS story_icon, s.banner AS story_banner,
      (SELECT COUNT(*) FROM channels c WHERE c.event_id = e.id) AS thread_count
    FROM events e JOIN stories s ON s.id = e.story_id`;

  const castOf = (eventId, limit = 8) => db.prepare(`SELECT DISTINCT ch.* FROM channels c
    JOIN channel_characters cc ON cc.channel_id = c.id JOIN characters ch ON ch.id = cc.character_id
    WHERE c.event_id = ? ORDER BY ch.name COLLATE NOCASE LIMIT ?`).all(eventId, limit).map(toCharacter);

  const toEvent = (row) => ({
    type: 'event',
    id: row.id, storyId: row.story_id, title: row.title, startsAt: row.starts_at, endsAt: row.ends_at,
    location: row.location, summary: row.summary, banner: row.banner, createdBy: row.created_by, createdAt: row.created_at,
    story: { id: row.story_id, title: row.story_title, color: row.story_color, icon: row.story_icon, banner: row.story_banner },
    threadCount: row.thread_count, participants: castOf(row.id, 6),
    sortAt: row.created_at,
  });

  ctx.eventItems = ({ userId, q = '', storyId = null }) => {
    const where = [VISIBLE];
    const args = { u: userId };
    if (storyId) { where.push('e.story_id = :sid'); args.sid = storyId; }
    if (q) {
      where.push("(e.title LIKE :q ESCAPE '\\' OR e.summary LIKE :q ESCAPE '\\' OR e.location LIKE :q ESCAPE '\\' OR s.title LIKE :q ESCAPE '\\')");
      args.q = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    }
    return db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.starts_at LIMIT 300`).all(args).map(toEvent);
  };

  const load = (id, user) => {
    const row = db.prepare(`${SELECT} WHERE e.id = ?`).get(id);
    if (!row) fail(404, 'Event not found');
    const { role } = storyAccess(db, row.story_id, user);
    return { row, role };
  };
  const canEdit = (row, role, user) => row.created_by === user.id || role === 'owner' || user.isAdmin;

  function fields(body, existing = {}) {
    const startsAt = dateInput(body.startsAt, 'Start date', { required: !existing.id }) ?? existing.starts_at;
    const endsAt = body.endsAt === undefined ? existing.ends_at ?? null : dateInput(body.endsAt, 'End date');
    if (endsAt && endsAt < startsAt) fail(400, 'The event ends before it starts');
    return {
      title: str(body.title, 'Title', { min: 1, max: 120, required: !existing.id }) ?? existing.title,
      startsAt, endsAt,
      location: str(body.location, 'Location', { max: 200 }) ?? existing.location ?? '',
      summary: str(body.summary, 'Description', { max: 5000 }) ?? existing.summary ?? '',
    };
  }

  // Every event you can see (for the calendar, cards, and the "part of an event" picker).
  r.get('/api/calendar', ({ user, query }) => {
    requireUser(user);
    return { data: { events: ctx.eventItems({ userId: user.id, storyId: Number(query.get('story')) || null }) } };
  });

  r.get('/api/calendar/:id', ({ user, params }) => {
    requireUser(user);
    const { row, role } = load(params.id, user);
    return {
      data: {
        event: toEvent(row),
        canEdit: canEdit(row, role, user),
        canAddThreads: !!role,
        threads: ctx.threadItems({ userId: user.id, where: ['c.event_id = :eid'], args: { eid: row.id }, limit: 200 }),
      },
    };
  });

  r.post('/api/stories/:id/calendar', ({ user, body, params }) => {
    requireUser(user);
    const { row: story, role } = storyAccess(db, params.id, user);
    if (!role && !user.isAdmin) fail(403, 'Join the story to add events');
    const f = fields(body);
    const banner = uploadRef(db, body.banner, user.id) ?? null;
    const { lastInsertRowid } = db.prepare(`INSERT INTO events (story_id, title, starts_at, ends_at, location, summary, banner, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(story.id, f.title, f.startsAt, f.endsAt, f.location, f.summary, banner, user.id);
    hub.sendStory(story.id, 'story', { storyId: story.id });
    return { status: 201, data: { event: toEvent(db.prepare(`${SELECT} WHERE e.id = ?`).get(lastInsertRowid)) } };
  });

  r.put('/api/calendar/:id', ({ user, body, params }) => {
    requireUser(user);
    const { row, role } = load(params.id, user);
    if (!canEdit(row, role, user)) fail(403, 'Only whoever made the event or the story owner can change it');
    const f = fields(body, { ...row, id: row.id });
    const banner = uploadRef(db, body.banner, user.id);
    db.prepare('UPDATE events SET title = ?, starts_at = ?, ends_at = ?, location = ?, summary = ?, banner = ? WHERE id = ?')
      .run(f.title, f.startsAt, f.endsAt, f.location, f.summary, banner === undefined ? row.banner : banner, row.id);
    hub.sendStory(row.story_id, 'story', { storyId: row.story_id });
    return { data: { event: toEvent(db.prepare(`${SELECT} WHERE e.id = ?`).get(row.id)) } };
  });

  r.delete('/api/calendar/:id', ({ user, params }) => {
    requireUser(user);
    const { row, role } = load(params.id, user);
    if (!canEdit(row, role, user)) fail(403, 'Only whoever made the event or the story owner can delete it');
    db.prepare('DELETE FROM events WHERE id = ?').run(row.id); // its threads stay, unlinked
    hub.sendStory(row.story_id, 'story', { storyId: row.story_id });
    return { data: { ok: true } };
  });
}
