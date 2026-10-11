// Characters as social profiles: following other characters, followers, and the threads they're in.
import { fail, id } from '../http.js';
import { toCharacter, requireUser, isBlocked } from '../model.js';

export function socialRoutes(r, ctx) {
  const { db } = ctx;

  // Channels in stories the viewer can see.
  const VISIBLE = `(s.visibility = 'public' OR s.id IN (SELECT story_id FROM story_members WHERE user_id = :viewer))`;

  function stats(characterId, viewerId) {
    return db.prepare(`SELECT
        (SELECT COUNT(*) FROM character_follows WHERE followed_id = :c) AS followers,
        (SELECT COUNT(*) FROM character_follows WHERE follower_id = :c) AS following,
        (SELECT COUNT(*) FROM channel_characters cc JOIN channels ch ON ch.id = cc.channel_id JOIN stories s ON s.id = ch.story_id
           WHERE cc.character_id = :c AND ch.kind != 'ooc' AND ch.status != 'complete' AND ${VISIBLE}) AS threads,
        (SELECT COUNT(*) FROM posts WHERE character_id = :c) AS posts,
        (SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE character_id = :c) AS words`).get({ c: characterId, viewer: viewerId ?? 0 });
  }
  ctx.characterStats = stats;

  function ownCharacter(characterId, userId) {
    const c = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(id(characterId, 'Character'), userId);
    if (!c) fail(400, 'Choose one of your own characters');
    return c;
  }

  r.get('/api/characters/:id', ({ user, params }) => {
    const row = db.prepare('SELECT c.*, u.username, u.display_name, u.avatar AS user_avatar FROM characters c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(params.id);
    if (!row) fail(404, 'Character not found');
    const threads = db.prepare(`
      SELECT ch.id, ch.name, ch.kind, ch.status, ch.story_id, ch.last_post_at, s.title AS story_title,
        (SELECT COUNT(*) FROM posts p WHERE p.channel_id = ch.id) AS post_count
      FROM channel_characters cc JOIN channels ch ON ch.id = cc.channel_id JOIN stories s ON s.id = ch.story_id
      WHERE cc.character_id = :c AND ch.kind != 'ooc' AND ${VISIBLE}
      ORDER BY ch.status = 'complete', COALESCE(ch.last_post_at, ch.created_at) DESC LIMIT 30`).all({ c: row.id, viewer: user?.id ?? 0 })
      .map((t) => ({ id: t.id, name: t.name, kind: t.kind, status: t.status, storyId: t.story_id, storyTitle: t.story_title, lastPostAt: t.last_post_at, postCount: t.post_count }));
    const followedBy = user
      ? db.prepare(`SELECT f.follower_id FROM character_follows f JOIN characters c ON c.id = f.follower_id
          WHERE f.followed_id = ? AND c.user_id = ?`).all(row.id, user.id).map((f) => f.follower_id)
      : [];
    return {
      data: {
        character: {
          ...toCharacter(row),
          owner: { id: row.user_id, username: row.username, displayName: row.display_name, avatar: row.user_avatar },
        },
        stats: stats(row.id, user?.id),
        threads,
        followedBy, // which of the viewer's characters follow this one
      },
    };
  });

  const list = (sql, characterId) => db.prepare(sql).all(characterId).map(toCharacter);
  r.get('/api/characters/:id/followers', ({ params }) => ({
    data: { characters: list(`SELECT c.* FROM character_follows f JOIN characters c ON c.id = f.follower_id WHERE f.followed_id = ? ORDER BY f.created_at DESC`, params.id) },
  }));
  r.get('/api/characters/:id/following', ({ params }) => ({
    data: { characters: list(`SELECT c.* FROM character_follows f JOIN characters c ON c.id = f.followed_id WHERE f.follower_id = ? ORDER BY f.created_at DESC`, params.id) },
  }));

  r.post('/api/characters/:id/follow', ({ user, body, params }) => {
    requireUser(user);
    const target = db.prepare('SELECT * FROM characters WHERE id = ?').get(params.id);
    if (!target) fail(404, 'Character not found');
    const me = ownCharacter(body.asCharacterId, user.id);
    if (me.id === target.id) fail(400, "A character can't follow themselves");
    if (isBlocked(db, target.user_id, user.id)) fail(403, "You can't follow this character");
    const { changes } = db.prepare('INSERT OR IGNORE INTO character_follows (follower_id, followed_id) VALUES (?, ?)').run(me.id, target.id);
    if (changes && target.user_id !== user.id) {
      ctx.notify({ userId: target.user_id, type: 'follow', actorId: user.id, characterId: me.id, text: `${me.name} followed ${target.name}` });
    }
    return { data: { stats: stats(target.id, user.id) } };
  });

  r.post('/api/characters/:id/unfollow', ({ user, body, params }) => {
    requireUser(user);
    const me = ownCharacter(body.asCharacterId, user.id);
    db.prepare('DELETE FROM character_follows WHERE follower_id = ? AND followed_id = ?').run(me.id, params.id);
    return { data: { stats: stats(params.id, user.id) } };
  });

  // Characters you might tag in a thread: everyone's characters in a story.
  r.get('/api/stories/:id/characters', ({ user, params }) => {
    requireUser(user);
    const rows = db.prepare(`SELECT c.*, u.display_name AS owner_name FROM characters c JOIN story_members m ON m.user_id = c.user_id
      JOIN users u ON u.id = c.user_id WHERE m.story_id = ? ORDER BY c.name COLLATE NOCASE`).all(params.id);
    if (!db.prepare('SELECT 1 FROM story_members WHERE story_id = ? AND user_id = ?').get(params.id, user.id) && !user.isAdmin) fail(404, 'Story not found');
    return { data: { characters: rows.map((c) => ({ ...toCharacter(c), ownerName: c.owner_name })) } };
  });
}
