// Characters as social profiles: following other characters, followers, and the threads they're in.
import { fail, id, str, oneOf } from '../http.js';
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
  // What profiles show: the owner's chosen counts if set (for celebrities etc.), otherwise the real ones.
  function shownStats(character, viewerId) {
    const real = stats(character.id, viewerId);
    return {
      ...real,
      realFollowers: real.followers,
      realFollowing: real.following,
      followers: character.followers_display ?? real.followers,
      following: character.following_display ?? real.following,
      socialPosts: db.prepare('SELECT COUNT(*) AS n FROM social_posts WHERE character_id = ?').get(character.id).n,
    };
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
        stats: shownStats(row, user?.id),
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
    return { data: { stats: shownStats(target, user.id) } };
  });

  r.post('/api/characters/:id/unfollow', ({ user, body, params }) => {
    requireUser(user);
    const me = ownCharacter(body.asCharacterId, user.id);
    db.prepare('DELETE FROM character_follows WHERE follower_id = ? AND followed_id = ?').run(me.id, params.id);
    const target = db.prepare('SELECT * FROM characters WHERE id = ?').get(params.id) ?? fail(404, 'Character not found');
    return { data: { stats: shownStats(target, user.id) } };
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

// ---------- Character social media posts ----------
const SOCIAL_KINDS = ['text', 'photo', 'video', 'voice', 'stream'];
const MEDIA_EXT = {
  photo: /\.(png|jpg|webp|gif)$/,
  video: /\.(mp4|webm|mov)$/,
  voice: /\.(m4a|mp3|weba|ogg|wav|mp4|webm)$/,
  stream: /\.(png|jpg|webp|gif)$/,
};

export function socialPostRoutes(r, ctx) {
  const { db } = ctx;
  const charCols = 'c.name AS c_name, c.avatar AS c_avatar, c.color AS c_color, c.verified AS c_verified, c.user_id AS c_user';
  const charOf = (row) => ({ id: row.character_id, name: row.c_name, avatar: row.c_avatar, color: row.c_color, verified: !!row.c_verified, userId: row.c_user });

  function toSocial(row, viewerId, { allComments = false } = {}) {
    const comments = db.prepare(`SELECT sc.*, ${charCols} FROM social_comments sc JOIN characters c ON c.id = sc.character_id
      WHERE sc.post_id = ? ORDER BY sc.id ${allComments ? '' : 'DESC LIMIT 2'}`).all(row.id);
    if (!allComments) comments.reverse();
    return {
      type: 'social',
      id: row.id, kind: row.kind, body: row.body, title: row.title,
      media: JSON.parse(row.media), meta: JSON.parse(row.meta),
      createdAt: row.created_at, editedAt: row.edited_at, userId: row.user_id,
      character: charOf(row),
      likes: db.prepare('SELECT COUNT(*) AS n FROM social_likes WHERE post_id = ?').get(row.id).n,
      commentCount: db.prepare('SELECT COUNT(*) AS n FROM social_comments WHERE post_id = ?').get(row.id).n,
      likedBy: viewerId ? db.prepare(`SELECT l.character_id FROM social_likes l JOIN characters c ON c.id = l.character_id
        WHERE l.post_id = ? AND c.user_id = ?`).all(row.id, viewerId).map((x) => x.character_id) : [],
      comments: comments.map((cm) => ({ id: cm.id, body: cm.body, createdAt: cm.created_at, userId: cm.user_id, character: charOf(cm) })),
    };
  }

  const SELECT = `SELECT p.*, ${charCols} FROM social_posts p JOIN characters c ON c.id = p.character_id`;
  // Posts from people who blocked you, or whom you blocked, are hidden.
  const NOT_BLOCKED = `p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = :viewer)
    AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = :viewer)`;

  ctx.socialFeed = ({ viewerId, q = '', limit = 60, characterId = null, before = null }) => {
    const where = [NOT_BLOCKED];
    const args = { viewer: viewerId, limit };
    if (characterId) { where.push('p.character_id = :cid'); args.cid = characterId; }
    if (before) { where.push('p.id < :before'); args.before = before; }
    if (q) {
      where.push("(p.body LIKE :q ESCAPE '\\' OR p.title LIKE :q ESCAPE '\\' OR c.name LIKE :q ESCAPE '\\')");
      args.q = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    }
    return db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT :limit`).all(args).map((row) => toSocial(row, viewerId));
  };

  const load = (postId, user) => {
    const row = db.prepare(`${SELECT} WHERE p.id = ?`).get(postId);
    if (!row || isBlocked(db, row.user_id, user.id) || isBlocked(db, user.id, row.user_id)) fail(404, 'Post not found');
    return row;
  };
  const ownCharacter = (characterId, userId) => {
    const c = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(id(characterId, 'Character'), userId);
    if (!c) fail(400, 'Choose one of your own characters');
    return c;
  };

  function mediaInput(kind, list, userId) {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.length > 10) fail(400, 'At most 10 attachments');
    return list.map((url) => {
      const m = typeof url === 'string' && url.match(/^\/uploads\/([\w-]+\.[a-z0-9]+)$/);
      if (!m || !db.prepare('SELECT 1 FROM uploads WHERE name = ? AND user_id = ?').get(m[1], userId)) fail(400, 'Upload the file first');
      if (!MEDIA_EXT[kind]?.test(m[1])) fail(400, `That file can't be used in a ${kind} post`);
      return url;
    });
  }

  function metaInput(kind, meta) {
    if (!meta || typeof meta !== 'object') return {};
    const out = {};
    if (kind === 'stream') {
      const v = Number(meta.viewers);
      if (Number.isSafeInteger(v) && v >= 0 && v < 1e10) out.viewers = v;
      out.live = meta.live !== false;
    }
    if (kind === 'voice' && Number.isFinite(Number(meta.duration))) out.duration = Math.min(3600, Math.max(0, Math.round(Number(meta.duration))));
    return out;
  }

  // A song attached to any post, Instagram-style: title and artist, plus an optional link.
  // undefined = leave as is, null = remove.
  function musicInput(music) {
    if (music === undefined) return undefined;
    if (music === null || music === '') return null;
    if (typeof music !== 'object') fail(400, 'Song must be an object');
    const title = str(music.title, 'Song title', { max: 120 }) ?? '';
    const artist = str(music.artist, 'Artist', { max: 120 }) ?? '';
    let url = str(music.url, 'Song link', { max: 500 }) ?? '';
    if (!title && !artist && !url) return null;
    if (!title) fail(400, 'Add the song title');
    if (url) {
      let u;
      try { u = new URL(url); } catch { fail(400, 'Song link must be a web address'); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(400, 'Song link must start with https://');
      url = u.href;
    }
    return { title, artist, url };
  }
  const withMusic = (meta, music) => {
    if (music === undefined) return meta;
    const { music: _old, ...rest } = meta;
    return music ? { ...rest, music } : rest;
  };

  r.get('/api/social', ({ user, query }) => {
    requireUser(user);
    const characterId = Number(query.get('character')) || null;
    const before = Number(query.get('before')) || null;
    return { data: { posts: ctx.socialFeed({ viewerId: user.id, characterId, before, limit: 30 }) } };
  });

  r.get('/api/social/:id', ({ user, params }) => {
    requireUser(user);
    return { data: { post: toSocial(load(params.id, user), user.id, { allComments: true }) } };
  });

  r.post('/api/social', ({ user, body }) => {
    requireUser(user);
    const c = ownCharacter(body.characterId, user.id);
    const kind = oneOf(body.kind, 'Post type', SOCIAL_KINDS) ?? 'text';
    const text = str(body.body, 'Caption', { max: 5000 }) ?? '';
    const title = str(body.title, 'Title', { max: 120 }) ?? '';
    const media = mediaInput(kind, body.media, user.id);
    if (kind === 'text' && !text) fail(400, 'Write something first');
    if (['photo', 'video', 'voice'].includes(kind) && !media.length) fail(400, `Add a ${kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : 'voice note'} first`);
    if (kind === 'stream' && !title) fail(400, 'Give the stream a title');
    const { lastInsertRowid } = db.prepare('INSERT INTO social_posts (character_id, user_id, kind, body, title, media, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, user.id, kind, text, title, JSON.stringify(media), JSON.stringify(withMusic(metaInput(kind, body.meta), musicInput(body.music))));
    return { status: 201, data: { post: toSocial(load(lastInsertRowid, user), user.id) } };
  });

  r.put('/api/social/:id', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id !== user.id) fail(404, 'Post not found');
    const text = str(body.body, 'Caption', { max: 5000 }) ?? row.body;
    const title = str(body.title, 'Title', { max: 120 }) ?? row.title;
    const base = body.meta === undefined ? JSON.parse(row.meta) : { ...metaInput(row.kind, body.meta), ...(JSON.parse(row.meta).music ? { music: JSON.parse(row.meta).music } : {}) };
    const meta = JSON.stringify(withMusic(base, musicInput(body.music)));
    db.prepare("UPDATE social_posts SET body = ?, title = ?, meta = ?, edited_at = datetime('now') WHERE id = ?").run(text, title, meta, row.id);
    return { data: { post: toSocial(load(row.id, user), user.id) } };
  });

  r.delete('/api/social/:id', ({ user, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id !== user.id && !user.isAdmin) fail(404, 'Post not found');
    db.prepare('DELETE FROM social_posts WHERE id = ?').run(row.id);
    if (row.user_id !== user.id) ctx.modLog(user.id, 'delete-social-post', `#${row.id}`);
    return { data: { ok: true } };
  });

  r.post('/api/social/:id/like', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    const me = ownCharacter(body.asCharacterId, user.id);
    const { changes } = db.prepare('INSERT OR IGNORE INTO social_likes (post_id, character_id) VALUES (?, ?)').run(row.id, me.id);
    if (changes && row.user_id !== user.id) {
      ctx.notify({ userId: row.user_id, type: 'like', actorId: user.id, characterId: me.id, socialId: row.id, text: `${me.name} liked ${row.c_name}'s post` });
    }
    return { data: { post: toSocial(load(row.id, user), user.id) } };
  });

  r.post('/api/social/:id/unlike', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    const me = ownCharacter(body.asCharacterId, user.id);
    db.prepare('DELETE FROM social_likes WHERE post_id = ? AND character_id = ?').run(row.id, me.id);
    return { data: { post: toSocial(load(row.id, user), user.id) } };
  });

  r.post('/api/social/:id/comments', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    const me = ownCharacter(body.characterId, user.id);
    const text = str(body.body, 'Comment', { min: 1, max: 2000, required: true });
    db.prepare('INSERT INTO social_comments (post_id, character_id, user_id, body) VALUES (?, ?, ?, ?)').run(row.id, me.id, user.id, text);
    if (row.user_id !== user.id) {
      ctx.notify({ userId: row.user_id, type: 'comment', actorId: user.id, characterId: me.id, socialId: row.id, text: `${me.name}: ${text.slice(0, 120)}` });
    }
    return { status: 201, data: { post: toSocial(load(row.id, user), user.id, { allComments: true }) } };
  });

  r.delete('/api/social/comments/:id', ({ user, params }) => {
    requireUser(user);
    const cm = db.prepare('SELECT sc.*, p.user_id AS post_owner FROM social_comments sc JOIN social_posts p ON p.id = sc.post_id WHERE sc.id = ?').get(params.id);
    if (!cm || (cm.user_id !== user.id && cm.post_owner !== user.id && !user.isAdmin)) fail(404, 'Comment not found');
    db.prepare('DELETE FROM social_comments WHERE id = ?').run(cm.id);
    return { data: { ok: true } };
  });
}
