// Drafts: THE NU posts a writer saves for any of their characters (pictures included) and posts
// whenever they like. A draft keeps exactly what the post window would send; posting it sends that
// to /api/social and the draft goes away. Only its writer ever sees a draft.
import { fail } from '../http.js';
import { requireUser } from '../model.js';

const MAX_DRAFTS = 200;
const MAX_SIZE = 100_000; // characters of saved post (pictures are links, so this is plenty)

export function draftRoutes(r, ctx) {
  const { db } = ctx;
  const ownCharacter = (id, user) => {
    const c = db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(Number(id), user.id);
    if (!c) fail(400, 'Pick one of your characters');
    return c.id;
  };
  const input = (body, user) => {
    const payload = body?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail(400, 'Nothing to save');
    const characterId = ownCharacter(payload.characterId, user);
    const text = JSON.stringify({ ...payload, characterId });
    if (text.length > MAX_SIZE) fail(400, 'This draft is too long to save');
    return { characterId, text };
  };
  const toDraft = (d) => {
    let payload = {};
    try {
      payload = JSON.parse(d.payload);
    } catch {
      /* keep it empty */
    }
    return {
      id: d.id,
      payload,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      character: { id: d.character_id, name: d.c_name, handle: d.c_handle, avatar: d.c_avatar, color: d.c_color },
    };
  };
  const SELECT = `SELECT d.*, c.name AS c_name, c.handle AS c_handle, c.avatar AS c_avatar, c.color AS c_color
    FROM post_drafts d JOIN characters c ON c.id = d.character_id`;
  const load = (id, user) => {
    const d = db.prepare(`${SELECT} WHERE d.id = ? AND d.user_id = ?`).get(id, user.id);
    if (!d) fail(404, 'Draft not found');
    return d;
  };

  r.get('/api/drafts', ({ user }) => {
    requireUser(user);
    const drafts = db.prepare(`${SELECT} WHERE d.user_id = ? ORDER BY d.updated_at DESC, d.id DESC`).all(user.id).map(toDraft);
    return { data: { drafts } };
  });

  r.post('/api/drafts', ({ user, body }) => {
    requireUser(user);
    const { characterId, text } = input(body, user);
    const count = db.prepare('SELECT COUNT(*) AS n FROM post_drafts WHERE user_id = ?').get(user.id).n;
    if (count >= MAX_DRAFTS) fail(400, `You can keep up to ${MAX_DRAFTS} drafts. Post or delete some first`);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO post_drafts (user_id, character_id, payload) VALUES (?, ?, ?)')
      .run(user.id, characterId, text);
    return { status: 201, data: { draft: toDraft(load(lastInsertRowid, user)) } };
  });

  r.put('/api/drafts/:id', ({ user, params, body }) => {
    requireUser(user);
    const d = load(params.id, user);
    const { characterId, text } = input(body, user);
    db.prepare("UPDATE post_drafts SET character_id = ?, payload = ?, updated_at = datetime('now') WHERE id = ?").run(
      characterId,
      text,
      d.id,
    );
    return { data: { draft: toDraft(load(d.id, user)) } };
  });

  r.delete('/api/drafts/:id', ({ user, params }) => {
    requireUser(user);
    const d = load(params.id, user);
    db.prepare('DELETE FROM post_drafts WHERE id = ?').run(d.id);
    return { data: { ok: true } };
  });
}
