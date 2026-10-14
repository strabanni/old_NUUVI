// Characters as social profiles: following other characters, followers, and the threads they're in.
import { fail, id, str, oneOf } from '../http.js';
import { mentionTokens, resolveMention, HANDLE_CHAR } from '../names.js';
import { setBuzz, buzzTarget, autoLikes, autoCommentLikes, RELATIONSHIPS } from '../buzz.js';
import { toCharacter, requireUser, isBlocked, imageLink, adminCanSee, requirePlayable } from '../model.js';

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
          // The gossip account is anonymous: nobody sees who runs it except that person.
          owner: row.bot === 'gossip' && row.user_id !== user?.id ? null
            : { id: row.user_id, username: row.username, displayName: row.display_name, avatar: row.user_avatar },
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
    const me = requirePlayable(ownCharacter(body.asCharacterId, user.id));
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
    // Story members' characters, plus everyone's NPCs (they're shared).
    const rows = db.prepare(`SELECT c.*, u.display_name AS owner_name FROM characters c JOIN users u ON u.id = c.user_id
      WHERE (c.bot IS NULL OR c.bot != 'gossip')
        AND (c.npc = 1 OR EXISTS (SELECT 1 FROM story_members m WHERE m.user_id = c.user_id AND m.story_id = ?))
      ORDER BY c.npc, c.name COLLATE NOCASE`).all(params.id);
    // Members only, plus admins (except another admin's private story they aren't in).
    const st = db.prepare('SELECT * FROM stories WHERE id = ?').get(params.id);
    const member = db.prepare('SELECT 1 FROM story_members WHERE story_id = ? AND user_id = ?').get(params.id, user.id);
    if (!st || (!member && !(user.isAdmin && (st.visibility === 'public' || adminCanSee(db, st, user))))) fail(404, 'Story not found');
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
  const charCols = `c.name AS c_name, c.avatar AS c_avatar, c.color AS c_color, c.verified AS c_verified, c.user_id AS c_user,
    c.handle AS c_handle, c.npc AS c_npc, c.bot AS c_bot, c.gradient AS c_gradient,
    COALESCE(c.followers_display, (SELECT COUNT(*) FROM character_follows f WHERE f.followed_id = c.id)) AS c_followers`;
  const charOf = (row) => ({
    id: row.character_id, name: row.c_name, avatar: row.c_avatar, color: row.c_color, verified: !!row.c_verified, userId: row.c_user,
    handle: row.c_handle, npc: !!row.c_npc, bot: row.c_bot ?? null, gradient: row.c_gradient ? row.c_gradient.split(',') : null,
  });

  // The "what's happening" note is the writer's own; nobody else gets it.
  const ownMeta = (row, viewerId) => {
    const meta = JSON.parse(row.meta);
    if (row.user_id !== viewerId) delete meta.context;
    return meta;
  };
  function toSocial(row, viewerId, { allComments = false } = {}) {
    const comments = db.prepare(`SELECT sc.*, ${charCols} FROM social_comments sc JOIN characters c ON c.id = sc.character_id
      WHERE sc.post_id = ? ORDER BY sc.id ${allComments ? '' : 'DESC LIMIT 2'}`).all(row.id);
    if (!allComments) comments.reverse();
    const buzz = db.prepare(`SELECT * FROM social_buzz WHERE post_id = ? ORDER BY created_at, id ${allComments ? '' : 'LIMIT 2'}`).all(row.id);
    const realLikes = db.prepare('SELECT COUNT(*) AS n FROM social_likes WHERE post_id = ?').get(row.id).n;
    const realComments = db.prepare('SELECT COUNT(*) AS n FROM social_comments WHERE post_id = ?').get(row.id).n
      + db.prepare('SELECT COUNT(*) AS n FROM social_buzz WHERE post_id = ?').get(row.id).n;
    return {
      type: 'social',
      pinned: !!row.pinned_at,
      buzzPending: !!ctx.aiBuzz?.pending(row.id),
      id: row.id, kind: row.kind, body: row.body, title: row.title,
      media: JSON.parse(row.media), meta: ownMeta(row, viewerId), location: row.location ?? null, category: row.category ?? 'post',
      createdAt: row.created_at, editedAt: row.edited_at, userId: row.user_id,
      character: charOf(row),
      // Likes start from the character's fame (a share of their followers, or the number the writer set)
      // and every real like adds one. Comments show the writer's number, or the real ones plus the crowd's.
      likes: (row.likes_display ?? autoLikes(row.c_followers, row.id)) + realLikes,
      commentCount: row.comments_display ?? realComments,
      likesDisplay: row.likes_display ?? null, commentsDisplay: row.comments_display ?? null,
      // Characters who liked it (shown as "Liked by @handle and 2,301 others", like Instagram).
      likers: db.prepare(`SELECT c.id, c.name, c.handle, c.color, c.avatar FROM social_likes l JOIN characters c ON c.id = l.character_id
        WHERE l.post_id = ? ORDER BY l.rowid DESC LIMIT 3`).all(row.id),
      likedBy: viewerId ? db.prepare(`SELECT l.character_id FROM social_likes l JOIN characters c ON c.id = l.character_id
        WHERE l.post_id = ? AND c.user_id = ?`).all(row.id, viewerId).map((x) => x.character_id) : [],
      comments: comments.map((cm) => ({ id: cm.id, body: cm.body, createdAt: cm.created_at, userId: cm.user_id, parentId: cm.parent_id ?? null,
        likes: autoCommentLikes(cm.c_followers, cm.id), character: charOf(cm) })),
      buzz: buzz.map((b) => ({ id: b.id, handle: b.handle, body: b.body, likes: b.likes, createdAt: b.created_at })),
    };
  }

  const SELECT = `SELECT p.*, ${charCols} FROM social_posts p JOIN characters c ON c.id = p.character_id`;
  // Posts from people who blocked you, or whom you blocked, are hidden.
  const NOT_BLOCKED = `p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = :viewer)
    AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = :viewer)`;

  ctx.socialFeed = ({ viewerId, q = '', limit = 60, characterId = null, before = null, category = null }) => {
    const where = [NOT_BLOCKED];
    const args = { viewer: viewerId, limit };
    if (category) { where.push("COALESCE(p.category, 'post') = :cat"); args.cat = category; }
    if (characterId) { where.push('p.character_id = :cid'); args.cid = characterId; }
    // Older posts: everything dated before the given post (back-dated posts sit at their date).
    if (before) {
      const b = db.prepare('SELECT created_at FROM social_posts WHERE id = ?').get(before);
      if (b) { where.push('(p.created_at < :bt OR (p.created_at = :bt AND p.id < :before))'); args.bt = b.created_at; args.before = before; }
    }
    if (q) {
      where.push("(p.body LIKE :q ESCAPE '\\' OR p.title LIKE :q ESCAPE '\\' OR c.name LIKE :q ESCAPE '\\')");
      args.q = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    }
    // On a character's profile, pinned posts come first (newest pin first), then everything by date.
    const order = characterId && !before ? 'p.pinned_at IS NULL, p.pinned_at DESC, p.created_at DESC, p.id DESC' : 'p.created_at DESC, p.id DESC';
    return db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT :limit`).all(args).map((row) => toSocial(row, viewerId));
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
      // Photos and stream thumbnails can also be https:// picture links.
      if ((kind === 'photo' || kind === 'stream') && imageLink(url)) return imageLink(url);
      const m = typeof url === 'string' && url.match(/^\/uploads\/([\w-]+\.[a-z0-9]+)$/);
      if (!m || !db.prepare('SELECT 1 FROM uploads WHERE name = ? AND user_id = ?').get(m[1], userId)) fail(400, 'Upload the file first');
      if (!MEDIA_EXT[kind]?.test(m[1])) fail(400, `That file can't be used in a ${kind} post`);
      return url;
    });
  }

  // A likes / comments number someone sets on a post (empty = work it out).
  function countInput(v, field) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(String(v).replace(/[,\s]/g, ''));
    if (!Number.isInteger(n) || n < 0 || n > 9_999_999_999) fail(400, `${field} must be a whole number`);
    return n;
  }
  // A date and time for a post (ISO text from the browser), stored as UTC.
  function whenInput(v) {
    if (v === undefined || v === null || v === '') return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900 || d.getFullYear() > 2200) fail(400, 'That date doesn\'t look right');
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  // Characters @mentioned in a post or comment: their writers hear "{a} tagged {b} in a post".
  // Your own characters don't notify you; `skip` is writers already told about this another way.
  function notifyTags(user, me, postId, text, where, skip = [], before = '') {
    const find = db.prepare('SELECT id, name, user_id FROM characters WHERE handle = ? COLLATE NOCASE');
    const tagged = (t) => new Map(mentionTokens(t).map((w) => resolveMention(w, (h) => find.get(h))).filter(Boolean).map((c) => [c.id, c]));
    const already = tagged(before);
    const told = new Set(skip);
    for (const t of tagged(text).values()) {
      if (already.has(t.id)) continue;
      if (t.user_id === user.id || told.has(t.user_id) || isBlocked(db, t.user_id, user.id)) continue;
      ctx.notify({ userId: t.user_id, type: 'socialtag', actorId: user.id, characterId: me.id, socialId: postId, text: `${me.name} tagged ${t.name} in a ${where}: ${text.slice(0, 120)}` });
    }
  }

  // Gives a post a fresh set of fan comments (the old ones are deleted). With an API key set, Claude
  // writes them after looking at the pictures; otherwise the built-in writer does it right away.
  function newBuzz(post, count, followers) {
    if (ctx.aiBuzz?.enabled) ctx.aiBuzz.queue(post, count, { followers });
    else setBuzz(db, post, count, { followers });
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
    // What the pictures look like (worked out in the browser), so crowd comments can react to them.
    if (meta.look && typeof meta.look === 'object') {
      const l = meta.look;
      out.look = {
        tone: ['dark', 'bright', 'soft'].includes(l.tone) ? l.tone : null,
        color: ['pink', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gold', 'black', 'white'].includes(l.color) ? l.color : null,
        bw: !!l.bw,
      };
    }
    return out;
  }

  // Whether the people @mentioned are actually in the picture (fan comments only say so when they are).
  // undefined = leave as is.
  function withTagged(meta, taggedIn) {
    if (taggedIn === undefined) return meta;
    const out = { ...meta };
    if (taggedIn) out.tagged = true; else delete out.tagged;
    return out;
  }

  // Each @mentioned person's relationship to the poster and whether they're in the picture, plus a
  // private note on what's happening: both only steer the fan comments. undefined = leave as is.
  function withPeople(meta, people, context) {
    const out = { ...meta };
    if (people !== undefined) {
      if (people !== null && !Array.isArray(people)) fail(400, 'Tagged people must be a list');
      const list = {};
      for (const p of (people || []).slice(0, 20)) {
        const handle = String(p?.handle || '').replace(/^@/, '').trim();
        if (!handle || [...handle].length > 40 || !new RegExp(`^${HANDLE_CHAR}+$`, 'u').test(handle)) continue;
        const rel = RELATIONSHIPS.includes(p.rel) ? p.rel : '';
        list[handle.toLowerCase()] = { handle, rel, in: !!p.inPicture };
      }
      if (Object.keys(list).length) out.people = list; else delete out.people;
      // The older "everyone tagged is in the picture" switch follows the per-person ones.
      if (Object.values(list).some((p) => p.in)) out.tagged = true; else delete out.tagged;
    }
    if (context !== undefined) {
      const note = (str(context, 'What\'s happening', { max: 600 }) ?? '').trim();
      if (note) out.context = note; else delete out.context;
    }
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
    return { data: { posts: ctx.socialFeed({ viewerId: user.id, characterId, before, limit: characterId ? 300 : 30 }) } };
  });

  r.get('/api/social/:id', ({ user, params }) => {
    requireUser(user);
    return { data: { post: toSocial(load(params.id, user), user.id, { allComments: true }) } };
  });

  r.post('/api/social', ({ user, body }) => {
    requireUser(user);
    const c = requirePlayable(ownCharacter(body.characterId, user.id));
    const kind = oneOf(body.kind, 'Post type', SOCIAL_KINDS) ?? 'text';
    const text = str(body.body, 'Caption', { max: 5000 }) ?? '';
    const title = str(body.title, 'Title', { max: 120 }) ?? '';
    const media = mediaInput(kind, body.media, user.id);
    if (kind === 'text' && !text) fail(400, 'Write something first');
    if (['photo', 'video', 'voice'].includes(kind) && !media.length) fail(400, `Add a ${kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : 'voice note'} first`);
    if (kind === 'stream' && !title) fail(400, 'Give the stream a title');
    const location = str(body.location, 'Location', { max: 100 }) || null;
    const category = oneOf(body.category, 'Category', ['post', 'musing']) ?? 'post';
    const likesShown = countInput(body.likesDisplay, 'Likes');
    const commentsShown = countInput(body.commentsDisplay, 'Comments');
    const postedAt = whenInput(body.postedAt) ?? null;
    const { lastInsertRowid } = db.prepare(`INSERT INTO social_posts (character_id, user_id, kind, body, title, media, meta, location, category, likes_display, comments_display, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`)
      .run(c.id, user.id, kind, text, title, JSON.stringify(media), JSON.stringify(withMusic(withPeople(withTagged(metaInput(kind, body.meta), body.taggedIn), body.people, body.context), musicInput(body.music))), location,
        category, likesShown ?? null, commentsShown ?? null, postedAt);
    ctx.bots?.onSocialPost(Number(lastInsertRowid));
    notifyTags(user, c, Number(lastInsertRowid), text, 'post');
    const fresh = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(lastInsertRowid);
    const fame = db.prepare(`SELECT COALESCE(followers_display, (SELECT COUNT(*) FROM character_follows WHERE followed_id = ?)) AS n FROM characters WHERE id = ?`).get(c.id, c.id).n;
    newBuzz(fresh, buzzTarget(commentsShown, fame), fame);
    return { status: 201, data: { post: toSocial(load(lastInsertRowid, user), user.id) } };
  });

  r.put('/api/social/:id', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id !== user.id) fail(404, 'Post not found');
    const text = str(body.body, 'Caption', { max: 5000 }) ?? row.body;
    const title = str(body.title, 'Title', { max: 120 }) ?? row.title;
    // The post type can change too (a text post becomes a photo post, and so on), with new media.
    const kind = oneOf(body.kind, 'Post type', SOCIAL_KINDS) ?? row.kind;
    const media = body.media === undefined && kind === row.kind ? JSON.parse(row.media) : mediaInput(kind, body.media ?? [], user.id);
    if (kind === 'text' && !text) fail(400, 'Write something first');
    if (['photo', 'video', 'voice'].includes(kind) && !media.length) fail(400, `Add a ${kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : 'voice note'} first`);
    if (kind === 'stream' && !title) fail(400, 'Give the stream a title');
    const mediaChanged = kind !== row.kind || JSON.stringify(media) !== row.media;
    // Meta that belongs to the post rather than its type (song, tags, what the pictures look like) carries over.
    const prev = JSON.parse(row.meta);
    const keep = Object.fromEntries(['music', 'tagged', 'people', 'context', ...(mediaChanged ? [] : ['seen', 'look'])].filter((k) => prev[k] !== undefined).map((k) => [k, prev[k]]));
    const base = body.meta === undefined ? (mediaChanged ? keep : prev) : { ...keep, ...metaInput(kind, body.meta) };
    const meta = JSON.stringify(withMusic(withPeople(withTagged(base, body.taggedIn), body.people, body.context), musicInput(body.music)));
    const count = (v, field, old) => (v === undefined ? old ?? null : countInput(v, field));
    const likesShown = count(body.likesDisplay, 'Likes', row.likes_display);
    const commentsShown = count(body.commentsDisplay, 'Comments', row.comments_display);
    const location = body.location === undefined ? row.location : (str(body.location, 'Location', { max: 100 }) || null);
    const category = oneOf(body.category, 'Category', ['post', 'musing']) ?? row.category ?? 'post';
    // The post's date and time can be set (to build up a character's history).
    const postedAt = body.postedAt === undefined ? row.created_at : whenInput(body.postedAt) ?? row.created_at;
    const contentChanged = (body.body !== undefined && text !== row.body) || (body.title !== undefined && title !== row.title)
      || location !== row.location || meta !== row.meta || mediaChanged;
    const onlyCounts = !contentChanged && category === (row.category ?? 'post');
    db.prepare(`UPDATE social_posts SET kind = ?, media = ?, body = ?, title = ?, meta = ?, likes_display = ?, comments_display = ?, location = ?, category = ?, created_at = ?
      ${onlyCounts ? '' : ", edited_at = datetime('now')"} WHERE id = ?`)
      .run(kind, JSON.stringify(media), text, title, meta, likesShown, commentsShown, location, category, postedAt, row.id);
    notifyTags(user, { id: row.character_id, name: row.c_name }, row.id, text, 'post', [], row.body);
    // Crowd comments follow the post: a changed caption (or place, song, pictures) gets fresh comments
    // that fit it, and a new comment number gets at least a quarter of it written out.
    const have = db.prepare('SELECT COUNT(*) AS n FROM social_buzz WHERE post_id = ?').get(row.id).n;
    const fresh = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(row.id);
    if (body.freshComments === true || contentChanged || postedAt !== row.created_at) {
      // Same number as before: if the last set is still being written, the number it was writing.
      const before = Math.max(have, ctx.aiBuzz?.pendingCount?.(row.id) ?? 0);
      newBuzz(fresh, commentsShown ? buzzTarget(commentsShown, row.c_followers) : before, row.c_followers);
    } else if (commentsShown !== row.comments_display) {
      const want = buzzTarget(commentsShown, row.c_followers);
      if (want !== Math.max(have, ctx.aiBuzz?.pendingCount?.(row.id) ?? 0)) newBuzz(fresh, want, row.c_followers);
    }
    return { data: { post: toSocial(load(row.id, user), user.id, { allComments: true }) } };
  });

  // Every character who liked a post (the full "Liked by" list).
  r.get('/api/social/:id/likers', ({ user, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    return { data: { characters: db.prepare(`SELECT c.* FROM social_likes l JOIN characters c ON c.id = l.character_id
      WHERE l.post_id = ? ORDER BY l.rowid DESC`).all(row.id).map(toCharacter) } };
  });

  // Pin a post to the top of its character's profile (up to 3), or unpin it.
  r.post('/api/social/:id/pin', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    if (row.user_id !== user.id) fail(404, 'Post not found');
    if (body.pinned === false) {
      db.prepare('UPDATE social_posts SET pinned_at = NULL WHERE id = ?').run(row.id);
    } else if (!row.pinned_at) {
      const pinned = db.prepare('SELECT COUNT(*) AS n FROM social_posts WHERE character_id = ? AND pinned_at IS NOT NULL').get(row.character_id).n;
      if (pinned >= 3) fail(400, 'Up to 3 pinned posts. Unpin one first.');
      db.prepare("UPDATE social_posts SET pinned_at = datetime('now') WHERE id = ?").run(row.id);
    }
    return { data: { post: toSocial(load(row.id, user), user.id, { allComments: true }) } };
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
    const me = requirePlayable(ownCharacter(body.asCharacterId, user.id));
    const { changes } = db.prepare('INSERT OR IGNORE INTO social_likes (post_id, character_id) VALUES (?, ?)').run(row.id, me.id);
    if (changes && row.user_id !== user.id) {
      ctx.notify({ userId: row.user_id, type: 'like', actorId: user.id, characterId: me.id, socialId: row.id, text: `${me.name} liked ${row.c_name}'s post` });
    }
    return { data: { post: toSocial(load(row.id, user), user.id, { allComments: true }) } };
  });

  r.post('/api/social/:id/unlike', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    const me = ownCharacter(body.asCharacterId, user.id);
    db.prepare('DELETE FROM social_likes WHERE post_id = ? AND character_id = ?').run(row.id, me.id);
    return { data: { post: toSocial(load(row.id, user), user.id, { allComments: true }) } };
  });

  r.post('/api/social/:id/comments', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    const me = requirePlayable(ownCharacter(body.characterId, user.id));
    const text = str(body.body, 'Comment', { min: 1, max: 2000, required: true });
    // A reply hangs under a comment on the same post (replies to replies go under the same comment).
    let parentId = null;
    if (body.parentId != null) {
      const parent = db.prepare('SELECT id, parent_id FROM social_comments WHERE id = ? AND post_id = ?').get(Number(body.parentId), row.id) ?? fail(400, 'That comment is gone');
      parentId = parent.parent_id ?? parent.id;
    }
    // A comment can be dated (to sit with a back-dated post).
    const postedAt = whenInput(body.postedAt) ?? null;
    db.prepare(`INSERT INTO social_comments (post_id, character_id, user_id, body, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`).run(row.id, me.id, user.id, text, parentId, postedAt);
    if (row.user_id !== user.id) {
      ctx.notify({ userId: row.user_id, type: 'comment', actorId: user.id, characterId: me.id, socialId: row.id, text: `${me.name} commented on ${row.c_name}'s post: ${text.slice(0, 120)}` });
    }
    notifyTags(user, me, row.id, text, 'comment', [row.user_id]);
    return { status: 201, data: { post: toSocial(load(row.id, user), user.id, { allComments: true }) } };
  });

  // Your character's comment can be changed: the words, and its date.
  r.put('/api/social/comments/:id', ({ user, body, params }) => {
    requireUser(user);
    const cm = db.prepare('SELECT sc.*, c.name AS c_name FROM social_comments sc JOIN characters c ON c.id = sc.character_id WHERE sc.id = ?').get(params.id);
    if (!cm || cm.user_id !== user.id) fail(404, 'Comment not found');
    const post = load(cm.post_id, user);
    const text = body.body === undefined ? cm.body : str(body.body, 'Comment', { min: 1, max: 2000, required: true });
    const postedAt = body.postedAt === undefined ? cm.created_at : whenInput(body.postedAt) ?? cm.created_at;
    db.prepare('UPDATE social_comments SET body = ?, created_at = ? WHERE id = ?').run(text, postedAt, cm.id);
    // Anyone newly @tagged by the edit hears about it (people tagged before don't hear twice).
    notifyTags(user, { id: cm.character_id, name: cm.c_name }, post.id, text, 'comment', [post.user_id], cm.body);
    return { data: { post: toSocial(load(post.id, user), user.id, { allComments: true }) } };
  });

  r.delete('/api/social/comments/:id', ({ user, params }) => {
    requireUser(user);
    const cm = db.prepare('SELECT sc.*, p.user_id AS post_owner FROM social_comments sc JOIN social_posts p ON p.id = sc.post_id WHERE sc.id = ?').get(params.id);
    if (!cm || (cm.user_id !== user.id && cm.post_owner !== user.id && !user.isAdmin)) fail(404, 'Comment not found');
    db.prepare('DELETE FROM social_comments WHERE id = ?').run(cm.id);
    return { data: { ok: true } };
  });
}
