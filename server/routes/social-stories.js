// Stories on THE NU (like Instagram's): a character posts a photo, a video or a text card on a
// colour, and it shows at the top of the feed for 24 hours. Each writer's "seen" is remembered so
// the ring goes grey once they've watched everything.
import { fail, str, id, oneOf } from '../http.js';
import { toCharacter, requireUser, isBlocked, uploadRef, requirePlayable, CAN_SEE_ACCOUNT } from '../model.js';

const LIVE = "datetime('now', '-24 hours')";
const COLOR = /^#[0-9a-f]{6}$/i;

export function socialStoryRoutes(r, ctx) {
  const { db } = ctx;

  const toStory = (s, viewerId) => ({
    id: s.id,
    characterId: s.character_id,
    kind: s.kind,
    media: s.media,
    body: s.body,
    bg: s.bg,
    createdAt: s.created_at,
    seen: !!db.prepare('SELECT 1 FROM social_story_views WHERE story_id = ? AND user_id = ?').get(s.id, viewerId),
    mine: s.user_id === viewerId,
    // Only the writer who posted it sees how many people watched.
    views:
      s.user_id === viewerId
        ? db.prepare('SELECT COUNT(*) AS n FROM social_story_views WHERE story_id = ? AND user_id != ?').get(s.id, viewerId).n
        : undefined,
  });

  // Everyone with a story up right now, grouped by character: your own first, then the ones you
  // haven't watched yet (newest first), then the ones you've seen.
  r.get('/api/social-stories', ({ user }) => {
    requireUser(user);
    const rows = db
      .prepare(
        `SELECT s.* FROM social_stories s JOIN characters c ON c.id = s.character_id
      WHERE s.created_at > ${LIVE} AND ${CAN_SEE_ACCOUNT}
        AND s.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = :u)
        AND s.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = :u)
      ORDER BY s.id`,
      )
      .all({ u: user.id, viewer: user.id });
    const groups = new Map();
    for (const s of rows) {
      if (!groups.has(s.character_id)) groups.set(s.character_id, []);
      groups.get(s.character_id).push(toStory(s, user.id));
    }
    const out = [...groups].map(([cid, stories]) => {
      const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(cid);
      return {
        character: toCharacter(c),
        stories,
        allSeen: stories.every((x) => x.seen),
        mine: c.user_id === user.id,
        latest: stories.at(-1).id,
      };
    });
    out.sort((a, b) => b.mine - a.mine || a.allSeen - b.allSeen || b.latest - a.latest);
    return { data: { groups: out } };
  });

  r.post('/api/social-stories', ({ user, body }) => {
    requireUser(user);
    const c = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(id(body.characterId, 'Character'), user.id);
    if (!c) fail(400, 'Choose one of your own characters');
    requirePlayable(c);
    const kind = oneOf(body.kind, 'Story type', ['photo', 'video', 'text']) ?? 'photo';
    const text = str(body.body, 'Text', { max: 500 }) ?? '';
    let media = null;
    if (kind === 'photo') media = uploadRef(db, body.media, user.id) ?? fail(400, 'Add a photo first');
    if (kind === 'video') {
      const m = typeof body.media === 'string' && body.media.match(/^\/uploads\/([\w-]+\.(?:mp4|webm|mov))$/);
      if (!m || !db.prepare('SELECT 1 FROM uploads WHERE name = ? AND user_id = ?').get(m[1], user.id))
        fail(400, 'Upload the video first');
      media = body.media;
    }
    if (kind === 'text' && !text.trim()) fail(400, 'Write something first');
    const bg = typeof body.bg === 'string' && COLOR.test(body.bg) ? body.bg : null;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO social_stories (character_id, user_id, kind, media, body, bg) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.id, user.id, kind, media, text, bg);
    // Your own story counts as seen by you.
    db.prepare('INSERT OR IGNORE INTO social_story_views (story_id, user_id) VALUES (?, ?)').run(lastInsertRowid, user.id);
    return {
      status: 201,
      data: { story: toStory(db.prepare('SELECT * FROM social_stories WHERE id = ?').get(lastInsertRowid), user.id) },
    };
  });

  r.post('/api/social-stories/:id/seen', ({ user, params }) => {
    requireUser(user);
    const s = db.prepare('SELECT * FROM social_stories WHERE id = ?').get(params.id);
    if (!s || isBlocked(db, s.user_id, user.id) || isBlocked(db, user.id, s.user_id)) fail(404, 'Story not found');
    db.prepare('INSERT OR IGNORE INTO social_story_views (story_id, user_id) VALUES (?, ?)').run(s.id, user.id);
    return { data: { ok: true } };
  });

  r.delete('/api/social-stories/:id', ({ user, params }) => {
    requireUser(user);
    const s = db.prepare('SELECT * FROM social_stories WHERE id = ?').get(params.id);
    if (!s || (s.user_id !== user.id && !user.isAdmin)) fail(404, 'Story not found');
    db.prepare('DELETE FROM social_stories WHERE id = ?').run(s.id);
    return { data: { ok: true } };
  });
}
