// The Development hub: where writers keep plot points, ideas and storyline concepts, and talk them
// over in comments. Every writer can see and comment on shared notes; a note marked "only me" is
// seen by its writer alone. The writer of a note (or an admin) can change, pin or remove it, and
// remove comments on it.
import { fail, str, oneOf } from '../http.js';
import { requireUser, isBlocked } from '../model.js';

export const DEV_KINDS = ['plot', 'idea', 'storyline'];
export const DEV_STATUSES = ['open', 'developing', 'used', 'shelved'];

export function devRoutes(r, ctx) {
  const { db } = ctx;
  const SELECT = `SELECT n.*, u.username, u.display_name, u.avatar,
    (SELECT COUNT(*) FROM dev_comments c WHERE c.note_id = n.id) AS comment_count
    FROM dev_notes n JOIN users u ON u.id = n.user_id`;
  const blockedEither = (a, b) => isBlocked(db, a, b) || isBlocked(db, b, a);
  const canEdit = (n, user) => n.user_id === user.id || !!user.isAdmin;
  const writer = (row, p = '') => ({
    id: row[`${p}user_id`],
    username: row[`${p}username`],
    displayName: row[`${p}display_name`],
    avatar: row[`${p}avatar`] ?? null,
  });
  const toNote = (n, user) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    status: n.status,
    private: !!n.private,
    pinned: !!n.pinned,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    commentCount: n.comment_count ?? 0,
    writer: writer(n),
    canEdit: canEdit(n, user),
  });
  // A note the viewer may see: shared ones (from writers they haven't blocked), or their own.
  const load = (id, user) => {
    const n = db.prepare(`${SELECT} WHERE n.id = ?`).get(id);
    if (!n || (n.user_id !== user.id && (n.private || blockedEither(user.id, n.user_id)))) fail(404, 'Note not found');
    return n;
  };
  const input = (body, old = {}) => ({
    kind: oneOf(body.kind, 'Kind', DEV_KINDS) ?? old.kind ?? 'idea',
    title: (str(body.title, 'Title', { min: 1, max: 140, required: !old.title }) ?? old.title).trim(),
    body: str(body.body, 'Details', { max: 20000 }) ?? old.body ?? '',
    status: oneOf(body.status, 'Status', DEV_STATUSES) ?? old.status ?? 'open',
    private: body.private === undefined ? !!old.private : !!body.private,
  });

  r.get('/api/dev', ({ user }) => {
    requireUser(user);
    const notes = db
      .prepare(`${SELECT} WHERE n.private = 0 OR n.user_id = ? ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC LIMIT 1000`)
      .all(user.id)
      .filter((n) => n.user_id === user.id || !blockedEither(user.id, n.user_id))
      .map((n) => toNote(n, user));
    return { data: { notes, kinds: DEV_KINDS, statuses: DEV_STATUSES } };
  });

  r.post('/api/dev', ({ user, body }) => {
    requireUser(user);
    const f = input(body);
    if (!f.title) fail(400, 'Give it a title');
    const { lastInsertRowid } = db
      .prepare('INSERT INTO dev_notes (user_id, kind, title, body, status, private) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, f.kind, f.title, f.body, f.status, f.private ? 1 : 0);
    return { status: 201, data: { note: toNote(load(lastInsertRowid, user), user) } };
  });

  r.get('/api/dev/:id', ({ user, params }) => {
    requireUser(user);
    const n = load(params.id, user);
    const comments = db
      .prepare(
        `SELECT c.*, u.username, u.display_name, u.avatar FROM dev_comments c JOIN users u ON u.id = c.user_id
        WHERE c.note_id = ? ORDER BY c.id`,
      )
      .all(n.id)
      .filter((c) => c.user_id === user.id || !blockedEither(user.id, c.user_id))
      .map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.created_at,
        writer: writer(c),
        canDelete: c.user_id === user.id || canEdit(n, user),
      }));
    return { data: { note: toNote(n, user), comments } };
  });

  r.put('/api/dev/:id', ({ user, params, body }) => {
    requireUser(user);
    const n = load(params.id, user);
    if (!canEdit(n, user)) fail(403, 'Only its writer can change this');
    const f = input(body, n);
    if (!f.title) fail(400, 'Give it a title');
    const pinned = body.pinned === undefined ? n.pinned : body.pinned ? 1 : 0;
    // Pinning alone doesn't count as an update (so it doesn't jump to the top of "recent").
    const changed = ['kind', 'title', 'body', 'status'].some((k) => f[k] !== n[k]) || f.private !== !!n.private;
    db.prepare(
      `UPDATE dev_notes SET kind = ?, title = ?, body = ?, status = ?, private = ?, pinned = ?
      ${changed ? ", updated_at = datetime('now')" : ''} WHERE id = ?`,
    ).run(f.kind, f.title, f.body, f.status, f.private ? 1 : 0, pinned, n.id);
    return { data: { note: toNote(load(n.id, user), user) } };
  });

  r.delete('/api/dev/:id', ({ user, params }) => {
    requireUser(user);
    const n = load(params.id, user);
    if (!canEdit(n, user)) fail(403, 'Only its writer can remove this');
    db.prepare('DELETE FROM dev_notes WHERE id = ?').run(n.id);
    return { data: { ok: true } };
  });

  r.post('/api/dev/:id/comments', ({ user, params, body }) => {
    requireUser(user);
    const n = load(params.id, user);
    const text = (str(body.body, 'Comment', { min: 1, max: 5000, required: true }) ?? '').trim();
    if (!text) fail(400, 'Write something first');
    db.prepare('INSERT INTO dev_comments (note_id, user_id, body) VALUES (?, ?, ?)').run(n.id, user.id, text);
    // The note's writer hears about it, and so does everyone else talking it over.
    const others = db
      .prepare('SELECT DISTINCT user_id FROM dev_comments WHERE note_id = ? AND user_id NOT IN (?, ?)')
      .all(n.id, user.id, n.user_id)
      .map((x) => x.user_id);
    for (const to of [...(n.user_id === user.id ? [] : [n.user_id]), ...others]) {
      if (blockedEither(to, user.id)) continue;
      ctx.notify({
        userId: to,
        type: 'dev',
        actorId: user.id,
        text: `${user.displayName} commented on “${n.title}”${to === n.user_id ? '' : ' in Development'}: ${text.slice(0, 120)}`,
        devId: n.id,
      });
    }
    return { status: 201, data: { ok: true } };
  });

  r.delete('/api/dev/:id/comments/:commentId', ({ user, params }) => {
    requireUser(user);
    const n = load(params.id, user);
    const c = db.prepare('SELECT * FROM dev_comments WHERE id = ? AND note_id = ?').get(params.commentId, n.id);
    if (!c) fail(404, 'Comment not found');
    if (c.user_id !== user.id && !canEdit(n, user)) fail(403, "You can't remove that comment");
    db.prepare('DELETE FROM dev_comments WHERE id = ?').run(c.id);
    return { data: { ok: true } };
  });
}
