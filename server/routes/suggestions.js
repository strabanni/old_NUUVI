// The suggestion box: anyone can suggest something that would make NUUVI better, and vote for the
// ideas they'd like most. The owner and admins mark where each one stands and can write a reply;
// the person who suggested it hears about it.
import { fail, str, oneOf } from '../http.js';
import { requireUser } from '../model.js';

export const SUGGESTION_STATUSES = ['open', 'planned', 'done', 'declined'];
const STATUS_WORDS = { open: 'open again', planned: 'planned', done: 'done', declined: 'not planned' };

export function suggestionRoutes(r, ctx) {
  const { db } = ctx;
  const staff = (user) => !!user.isAdmin; // isAdmin includes the owner
  const SELECT = `SELECT s.*, u.username, u.display_name, u.avatar,
      (SELECT COUNT(*) FROM suggestion_votes v WHERE v.suggestion_id = s.id) AS votes,
      EXISTS (SELECT 1 FROM suggestion_votes v WHERE v.suggestion_id = s.id AND v.user_id = :me) AS voted
    FROM suggestions s JOIN users u ON u.id = s.user_id`;
  const toSuggestion = (s, user) => ({
    id: s.id,
    title: s.title,
    body: s.body,
    status: s.status,
    reply: s.reply,
    votes: s.votes,
    voted: !!s.voted,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    writer: { id: s.user_id, username: s.username, displayName: s.display_name, avatar: s.avatar ?? null },
    canEdit: s.user_id === user.id,
    canDelete: s.user_id === user.id || staff(user),
  });
  const load = (id, user) => {
    const s = db.prepare(`${SELECT} WHERE s.id = :id`).get({ id: Number(id), me: user.id });
    if (!s) fail(404, 'Suggestion not found');
    return s;
  };

  r.get('/api/suggestions', ({ user }) => {
    requireUser(user);
    const list = db
      .prepare(`${SELECT} ORDER BY s.id DESC LIMIT 1000`)
      .all({ me: user.id })
      .map((s) => toSuggestion(s, user));
    return { data: { suggestions: list, statuses: SUGGESTION_STATUSES, staff: staff(user) } };
  });

  r.post('/api/suggestions', ({ user, body }) => {
    requireUser(user);
    const title = (str(body.title, 'Suggestion', { min: 1, max: 140, required: true }) ?? '').trim();
    if (!title) fail(400, 'Write your suggestion first');
    const details = (str(body.body, 'Details', { max: 5000 }) ?? '').trim();
    const { lastInsertRowid } = db
      .prepare('INSERT INTO suggestions (user_id, title, body) VALUES (?, ?, ?)')
      .run(user.id, title, details);
    // You back your own idea.
    db.prepare('INSERT INTO suggestion_votes (suggestion_id, user_id) VALUES (?, ?)').run(lastInsertRowid, user.id);
    return { status: 201, data: { suggestion: toSuggestion(load(lastInsertRowid, user), user) } };
  });

  r.put('/api/suggestions/:id', ({ user, params, body }) => {
    requireUser(user);
    const s = load(params.id, user);
    const mine = s.user_id === user.id;
    if (!mine && !staff(user)) fail(403, "You can't change this suggestion");
    let { title, body: details, status, reply } = s;
    if (mine) {
      if (body.title !== undefined) title = (str(body.title, 'Suggestion', { min: 1, max: 140 }) ?? title).trim() || title;
      if (body.body !== undefined) details = (str(body.body, 'Details', { max: 5000 }) ?? '').trim();
    }
    if (staff(user)) {
      if (body.status !== undefined) status = oneOf(body.status, 'Status', SUGGESTION_STATUSES) ?? status;
      if (body.reply !== undefined) reply = (str(body.reply, 'Reply', { max: 3000 }) ?? '').trim();
    }
    db.prepare(
      "UPDATE suggestions SET title = ?, body = ?, status = ?, reply = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(title, details, status, reply, s.id);
    // The person who suggested it hears when it's marked or answered (not about their own changes).
    if (!mine && (status !== s.status || reply !== s.reply)) {
      const what =
        status !== s.status
          ? `marked your suggestion “${s.title}” as ${STATUS_WORDS[status]}`
          : `replied to your suggestion “${s.title}”`;
      ctx.notify({ userId: s.user_id, type: 'suggestion', actorId: user.id, text: `${user.displayName} ${what}` });
    }
    return { data: { suggestion: toSuggestion(load(s.id, user), user) } };
  });

  r.delete('/api/suggestions/:id', ({ user, params }) => {
    requireUser(user);
    const s = load(params.id, user);
    if (s.user_id !== user.id && !staff(user)) fail(403, "You can't remove this suggestion");
    db.prepare('DELETE FROM suggestions WHERE id = ?').run(s.id);
    return { data: { ok: true } };
  });

  // Vote for a suggestion, or take your vote back.
  r.post('/api/suggestions/:id/vote', ({ user, params }) => {
    requireUser(user);
    const s = load(params.id, user);
    if (s.voted) db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').run(s.id, user.id);
    else db.prepare('INSERT INTO suggestion_votes (suggestion_id, user_id) VALUES (?, ?)').run(s.id, user.id);
    return { data: { suggestion: toSuggestion(load(s.id, user), user) } };
  });
}
