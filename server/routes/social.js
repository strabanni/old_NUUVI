// Characters as social profiles: following other characters, followers, and the threads they're in.
import { fail, id, str, oneOf } from '../http.js';
import { mentionTokens, resolveMention, HANDLE_CHAR } from '../names.js';
import { setBuzz, buzzTarget, autoLikes, autoCommentLikes, RELATIONSHIPS } from '../buzz.js';
import { toCharacter, requireUser, isBlocked, imageLink, adminCanSee, requirePlayable, CAN_SEE_ACCOUNT, canSeeAccount } from '../model.js';

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
    // Private accounts: which of the viewer's characters have asked to follow, whether the viewer
    // can see the posts, and (for its writer) how many requests are waiting.
    const requested = user ? db.prepare(`SELECT r.follower_id FROM character_follow_requests r JOIN characters c ON c.id = r.follower_id
      WHERE r.followed_id = ? AND c.user_id = ?`).all(row.id, user.id).map((x) => x.follower_id) : [];
    const locked = !canSeeAccount(db, row, user?.id ?? 0);
    const requestCount = user && row.user_id === user.id ? db.prepare('SELECT COUNT(*) AS n FROM character_follow_requests WHERE followed_id = ?').get(row.id).n : 0;
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
        requested, locked, requestCount,
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
    // A private account: ask first (their writer approves). Your own characters just follow.
    if (target.private && target.user_id !== user.id && !db.prepare('SELECT 1 FROM character_follows WHERE follower_id = ? AND followed_id = ?').get(me.id, target.id)) {
      const asked = db.prepare('INSERT OR IGNORE INTO character_follow_requests (follower_id, followed_id) VALUES (?, ?)').run(me.id, target.id).changes;
      if (asked) ctx.notify({ userId: target.user_id, type: 'followreq', actorId: user.id, characterId: target.id, fromCharacterId: me.id, text: `${me.name} asked to follow ${target.name}` });
      return { data: { stats: shownStats(target, user.id), requested: true } };
    }
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
    db.prepare('DELETE FROM character_follow_requests WHERE follower_id = ? AND followed_id = ?').run(me.id, params.id);
    const target = db.prepare('SELECT * FROM characters WHERE id = ?').get(params.id) ?? fail(404, 'Character not found');
    return { data: { stats: shownStats(target, user.id) } };
  });

  // Follow requests to one of your private characters: see them, approve or decline.
  const ownedTarget = (cid, user) => {
    const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(cid);
    if (!c || c.user_id !== user.id) fail(404, 'Character not found');
    return c;
  };
  r.get('/api/characters/:id/requests', ({ user, params }) => {
    requireUser(user);
    const target = ownedTarget(params.id, user);
    const rows = db.prepare(`SELECT c.*, r.created_at AS asked_at FROM character_follow_requests r JOIN characters c ON c.id = r.follower_id
      WHERE r.followed_id = ? ORDER BY r.created_at DESC`).all(target.id);
    return { data: { requests: rows.map((c) => ({ ...toCharacter(c), askedAt: c.asked_at })) } };
  });
  r.post('/api/characters/:id/requests/:fid', ({ user, params, body }) => {
    requireUser(user);
    const target = ownedTarget(params.id, user);
    const req = db.prepare('SELECT * FROM character_follow_requests WHERE follower_id = ? AND followed_id = ?').get(params.fid, target.id);
    if (!req) fail(404, 'That request is gone');
    db.prepare('DELETE FROM character_follow_requests WHERE follower_id = ? AND followed_id = ?').run(params.fid, target.id);
    if (body.approve) {
      db.prepare('INSERT OR IGNORE INTO character_follows (follower_id, followed_id) VALUES (?, ?)').run(params.fid, target.id);
      const fan = db.prepare('SELECT * FROM characters WHERE id = ?').get(params.fid);
      if (fan && fan.user_id !== user.id) ctx.notify({ userId: fan.user_id, type: 'follow', actorId: user.id, characterId: target.id, text: `${target.name} accepted ${fan.name}'s follow request` });
    }
    // Clear the "asked to follow" notification once it's been answered.
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND type = 'followreq' AND character_id = ? AND from_character_id = ? AND read_at IS NULL").run(user.id, target.id, params.fid);
    return { data: { ok: true, stats: shownStats(target, user.id) } };
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
    c.handle AS c_handle, c.npc AS c_npc, c.bot AS c_bot, c.gradient AS c_gradient, c.brand AS c_brand,
    COALESCE(c.followers_display, (SELECT COUNT(*) FROM character_follows f WHERE f.followed_id = c.id)) AS c_followers`;
  const charOf = (row) => ({
    id: row.character_id, name: row.c_name, avatar: row.c_avatar, color: row.c_color, verified: !!row.c_verified, userId: row.c_user,
    handle: row.c_handle, npc: !!row.c_npc, bot: row.c_bot ?? null, gradient: row.c_gradient ? row.c_gradient.split(',') : null,
    brand: !!row.c_brand,
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
      // People tagged on the photos themselves (Instagram-style), with where on the photo.
      photoTags: photoTagRows(row.id).map((t) => ({ characterId: t.character_id, name: t.name, handle: t.handle, mediaIndex: t.media_index, x: t.x, y: t.y })),
      poll: pollResults(row, viewerId),
    };
  }
  // Polls: the question and choices live in the post's meta; votes in social_poll_votes. With
  // "fans vote too", a crowd of fans (about 4 in 10 of the likes) is added, split the same way each time.
  function pollResults(row, viewerId) {
    const poll = JSON.parse(row.meta || '{}').poll;
    if (!poll || !Array.isArray(poll.options)) return null;
    const real = poll.options.map(() => 0);
    for (const v of db.prepare('SELECT choice, COUNT(*) AS n FROM social_poll_votes WHERE post_id = ? GROUP BY choice').all(row.id)) if (real[v.choice] !== undefined) real[v.choice] = v.n;
    let crowd = poll.options.map(() => 0);
    if (poll.crowd) {
      const likes = (row.likes_display ?? autoLikes(row.c_followers, row.id)) || 0;
      const total = Math.round(likes * 0.4);
      const weights = poll.options.map((_, i) => 0.6 + (((row.id * 9301 + (i + 1) * 49297) % 233280) / 233280) * 2.4);
      const sum = weights.reduce((a, b) => a + b, 0);
      crowd = weights.map((w) => Math.floor((total * w) / sum));
      crowd[0] += total - crowd.reduce((a, b) => a + b, 0);
    }
    const votes = poll.options.map((_, i) => real[i] + crowd[i]);
    const mine = viewerId ? db.prepare(`SELECT v.character_id, v.choice FROM social_poll_votes v JOIN characters c ON c.id = v.character_id
      WHERE v.post_id = ? AND c.user_id = ?`).all(row.id, viewerId) : [];
    return { question: poll.question, options: poll.options.map((text, i) => ({ text, votes: votes[i] })), total: votes.reduce((a, b) => a + b, 0),
      crowd: !!poll.crowd, mine: Object.fromEntries(mine.map((m) => [m.character_id, m.choice])) };
  }
  // A poll from the composer: a question, 2–4 choices, and whether fans vote too. undefined = keep, null = remove.
  function pollInput(v) {
    if (v === undefined) return undefined;
    if (v === null || v === false) return null;
    if (typeof v !== 'object') fail(400, 'Poll must be an object');
    const question = (str(v.question, 'Poll question', { max: 140 }) ?? '').trim();
    const options = (Array.isArray(v.options) ? v.options : []).map((o) => String(o ?? '').trim().slice(0, 60)).filter(Boolean);
    if (!options.length && !question) return null;
    if (options.length < 2 || options.length > 4) fail(400, 'A poll needs 2 to 4 choices');
    return { question, options, crowd: v.crowd !== false };
  }
  const withPoll = (meta, poll) => {
    if (poll === undefined) return meta;
    const { poll: _old, ...rest } = meta;
    return poll ? { ...rest, poll } : rest;
  };

  const photoTagUsers = (postId) => photoTagRows(postId).map((t) => t.user_id);
  function photoTagRows(postId) {
    return db.prepare(`SELECT t.*, c.name, c.handle, c.user_id FROM social_photo_tags t JOIN characters c ON c.id = t.character_id
      WHERE t.post_id = ? ORDER BY t.media_index, t.rowid`).all(postId);
  }

  const SELECT = `SELECT p.*, ${charCols} FROM social_posts p JOIN characters c ON c.id = p.character_id`;
  // Posts from people who blocked you, or whom you blocked, are hidden.
  const NOT_BLOCKED = `p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = :viewer)
    AND p.user_id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = :viewer)`;

  ctx.socialFeed = ({ viewerId, q = '', limit = 60, characterId = null, before = null, category = null, taggedId = null }) => {
    // Private accounts' posts only for their followers (and their own writer).
    const where = [NOT_BLOCKED, CAN_SEE_ACCOUNT];
    const args = { viewer: viewerId, limit };
    // A profile's "Tagged" tab: other characters' posts that tag them on a photo or @mention them.
    if (taggedId) {
      const t = db.prepare('SELECT handle FROM characters WHERE id = ?').get(taggedId);
      where.push(`p.character_id != :tid AND (p.id IN (SELECT post_id FROM social_photo_tags WHERE character_id = :tid)
        OR (:th != '' AND (' ' || p.body || ' ') LIKE :thl ESCAPE '\\'))`);
      args.tid = taggedId;
      args.th = t?.handle || '';
      args.thl = `%@${(t?.handle || '').replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    }
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
    let rows = db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT :limit`).all(args);
    if (taggedId) {
      // "@mina" also matches "@minako" in the search above, so check each @mention properly.
      const find = db.prepare('SELECT id FROM characters WHERE handle = ? COLLATE NOCASE');
      const onPhoto = new Set(db.prepare('SELECT post_id FROM social_photo_tags WHERE character_id = ?').all(taggedId).map((x) => x.post_id));
      rows = rows.filter((row) => onPhoto.has(row.id) || mentionTokens(row.body).some((w) => resolveMention(w, (h) => find.get(h))?.id === taggedId));
    }
    return rows.map((row) => toSocial(row, viewerId));
  };

  const load = (postId, user) => {
    const row = db.prepare(`${SELECT} WHERE p.id = ?`).get(postId);
    if (!row || isBlocked(db, row.user_id, user.id) || isBlocked(db, user.id, row.user_id)) fail(404, 'Post not found');
    if (!user.isAdmin && !canSeeAccount(db, db.prepare('SELECT id, user_id, private FROM characters WHERE id = ?').get(row.character_id), user.id)) fail(403, 'This account is private');
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
    const taggedId = Number(query.get('tagged')) || null;
    const before = Number(query.get('before')) || null;
    if (taggedId) return { data: { posts: ctx.socialFeed({ viewerId: user.id, taggedId, before, limit: 300 }) } };
    return { data: { posts: ctx.socialFeed({ viewerId: user.id, characterId, before, limit: characterId ? 300 : 30 }) } };
  });

  // Tags on the photos of a photo post: [{ characterId, mediaIndex, x, y }] with x and y from 0 to 1
  // (across and down the photo). undefined = leave as they are.
  function photoTagsInput(list, kind, media, user) {
    if (list === undefined) return undefined;
    if (kind !== 'photo' || list === null) return [];
    if (!Array.isArray(list)) fail(400, 'Photo tags must be a list');
    if (list.length > 60) fail(400, 'At most 60 photo tags');
    const out = new Map();
    for (const t of list) {
      const cid = Number(t?.characterId);
      const mi = Number(t?.mediaIndex ?? 0);
      const x = Number(t?.x);
      const y = Number(t?.y);
      if (!Number.isInteger(mi) || mi < 0 || mi >= media.length) continue;
      if (![x, y].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) fail(400, 'A photo tag is off the photo');
      const c = db.prepare('SELECT id, user_id FROM characters WHERE id = ?').get(cid);
      if (!c) fail(400, 'Someone tagged on a photo is gone');
      if (isBlocked(db, c.user_id, user.id) || isBlocked(db, user.id, c.user_id)) fail(403, "You can't tag one of those characters");
      out.set(`${cid}:${mi}`, { characterId: cid, mediaIndex: mi, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
    }
    return [...out.values()];
  }
  // Saves a post's photo tags and lets newly tagged characters' writers know.
  function savePhotoTags(postId, tags, user, me) {
    if (tags === undefined) return;
    const before = new Set(photoTagRows(postId).map((t) => t.character_id));
    db.prepare('DELETE FROM social_photo_tags WHERE post_id = ?').run(postId);
    const ins = db.prepare('INSERT INTO social_photo_tags (post_id, character_id, media_index, x, y) VALUES (?, ?, ?, ?, ?)');
    for (const t of tags) ins.run(postId, t.characterId, t.mediaIndex, t.x, t.y);
    const told = new Set();
    for (const t of photoTagRows(postId)) {
      if (before.has(t.character_id) || told.has(t.character_id) || t.character_id === me.id) continue;
      told.add(t.character_id);
      if (t.user_id === user.id || isBlocked(db, t.user_id, user.id)) continue;
      ctx.notify({ userId: t.user_id, type: 'socialtag', actorId: user.id, characterId: me.id, socialId: postId, text: `${me.name} tagged ${t.name} in a photo` });
    }
  }
  // Everyone tagged on a photo is in the picture, so fan comments can say so. They're kept in the
  // post's people list (marked as from the photo) next to the @mentioned ones.
  function withPhotoPeople(metaJson, postId) {
    const meta = JSON.parse(metaJson);
    const people = Object.fromEntries(Object.entries(meta.people || {}).filter(([, p]) => !p.photo));
    for (const t of photoTagRows(postId)) {
      if (!t.handle) continue;
      const key = t.handle.toLowerCase();
      people[key] = { handle: t.handle, rel: people[key]?.rel || '', in: true, photo: !people[key] };
    }
    if (Object.keys(people).length) meta.people = people; else delete meta.people;
    if (Object.values(people).some((p) => p.in)) meta.tagged = true; else if (meta.people) delete meta.tagged;
    return JSON.stringify(meta);
  }
  const syncPhotoPeople = (postId) => {
    const row = db.prepare('SELECT meta FROM social_posts WHERE id = ?').get(postId);
    const meta = withPhotoPeople(row.meta, postId);
    if (meta !== row.meta) db.prepare('UPDATE social_posts SET meta = ? WHERE id = ?').run(meta, postId);
  };

  // Answering a notification about a post (opening the post, or commenting on it) marks it read.
  const answered = (userId, postId) => db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND social_id = ? AND read_at IS NULL").run(userId, postId);
  r.get('/api/social/:id', ({ user, params }) => {
    requireUser(user);
    const post = toSocial(load(params.id, user), user.id, { allComments: true });
    answered(user.id, post.id);
    return { data: { post } };
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
    // No date given: now in Ardell City (an admin may have set the city's date).
    const postedAt = whenInput(body.postedAt) ?? ctx.storyNow();
    const photoTags = photoTagsInput(body.photoTags, kind, media, user);
    const { lastInsertRowid } = db.prepare(`INSERT INTO social_posts (character_id, user_id, kind, body, title, media, meta, location, category, likes_display, comments_display, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`)
      .run(c.id, user.id, kind, text, title, JSON.stringify(media), JSON.stringify(withPoll(withMusic(withPeople(withTagged(metaInput(kind, body.meta), body.taggedIn), body.people, body.context), musicInput(body.music)), pollInput(body.poll))), location,
        category, likesShown ?? null, commentsShown ?? null, postedAt);
    savePhotoTags(Number(lastInsertRowid), photoTags, user, c);
    syncPhotoPeople(Number(lastInsertRowid));
    ctx.bots?.onSocialPost(Number(lastInsertRowid));
    notifyTags(user, c, Number(lastInsertRowid), text, 'post', photoTagUsers(Number(lastInsertRowid)));
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
    // New pictures without new tags: tags only stay on photos that are still there.
    let photoTags = photoTagsInput(body.photoTags, kind, media, user);
    if (photoTags === undefined && mediaChanged) {
      photoTags = kind !== 'photo' ? [] : photoTagRows(row.id).filter((t) => JSON.parse(row.media)[t.media_index] === media[t.media_index])
        .map((t) => ({ characterId: t.character_id, mediaIndex: t.media_index, x: t.x, y: t.y }));
    }
    const tagsBefore = JSON.stringify(photoTagRows(row.id).map((t) => [t.character_id, t.media_index, t.x, t.y]));
    // Meta that belongs to the post rather than its type (song, tags, what the pictures look like) carries over.
    const prev = JSON.parse(row.meta);
    const keep = Object.fromEntries(['music', 'tagged', 'people', 'context', 'poll', ...(mediaChanged ? [] : ['seen', 'look'])].filter((k) => prev[k] !== undefined).map((k) => [k, prev[k]]));
    const base = body.meta === undefined ? (mediaChanged ? keep : prev) : { ...keep, ...metaInput(kind, body.meta) };
    const metaIn = JSON.stringify(withPoll(withMusic(withPeople(withTagged(base, body.taggedIn), body.people, body.context), musicInput(body.music)), pollInput(body.poll)));
    const count = (v, field, old) => (v === undefined ? old ?? null : countInput(v, field));
    const likesShown = count(body.likesDisplay, 'Likes', row.likes_display);
    const commentsShown = count(body.commentsDisplay, 'Comments', row.comments_display);
    const location = body.location === undefined ? row.location : (str(body.location, 'Location', { max: 100 }) || null);
    const category = oneOf(body.category, 'Category', ['post', 'musing']) ?? row.category ?? 'post';
    // The post's date and time can be set (to build up a character's history).
    const postedAt = body.postedAt === undefined ? row.created_at : whenInput(body.postedAt) ?? row.created_at;
    // Everything checks out: save the photo tags, then the post.
    savePhotoTags(row.id, photoTags, user, { id: row.character_id, name: row.c_name });
    const tagsChanged = JSON.stringify(photoTagRows(row.id).map((t) => [t.character_id, t.media_index, t.x, t.y])) !== tagsBefore;
    const meta = withPhotoPeople(metaIn, row.id);
    const contentChanged = (body.body !== undefined && text !== row.body) || (body.title !== undefined && title !== row.title)
      || location !== row.location || meta !== row.meta || mediaChanged || tagsChanged;
    const onlyCounts = !contentChanged && category === (row.category ?? 'post');
    db.prepare(`UPDATE social_posts SET kind = ?, media = ?, body = ?, title = ?, meta = ?, likes_display = ?, comments_display = ?, location = ?, category = ?, created_at = ?
      ${onlyCounts ? '' : ", edited_at = datetime('now')"} WHERE id = ?`)
      .run(kind, JSON.stringify(media), text, title, meta, likesShown, commentsShown, location, category, postedAt, row.id);
    notifyTags(user, { id: row.character_id, name: row.c_name }, row.id, text, 'post', photoTagUsers(row.id), row.body);
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

  // Vote in a post's poll as one of your characters (vote again to change; the same choice again takes it back).
  r.post('/api/social/:id/vote', ({ user, body, params }) => {
    requireUser(user);
    const row = load(params.id, user);
    const poll = JSON.parse(row.meta || '{}').poll;
    if (!poll) fail(400, 'This post has no poll');
    const me = requirePlayable(ownCharacter(body.characterId, user.id));
    const choice = Number(body.choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= poll.options.length) fail(400, 'Pick one of the choices');
    const had = db.prepare('SELECT choice FROM social_poll_votes WHERE post_id = ? AND character_id = ?').get(row.id, me.id);
    if (had?.choice === choice) db.prepare('DELETE FROM social_poll_votes WHERE post_id = ? AND character_id = ?').run(row.id, me.id);
    else db.prepare(`INSERT INTO social_poll_votes (post_id, character_id, choice) VALUES (?, ?, ?)
      ON CONFLICT(post_id, character_id) DO UPDATE SET choice = excluded.choice, created_at = datetime('now')`).run(row.id, me.id, choice);
    return { data: { poll: pollResults(load(row.id, user), user.id) } };
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
    answered(user.id, row.id);
    const me = requirePlayable(ownCharacter(body.characterId, user.id));
    const text = str(body.body, 'Comment', { min: 1, max: 2000, required: true });
    // A reply hangs under a comment on the same post (replies to replies go under the same comment).
    let parentId = null;
    if (body.parentId != null) {
      const parent = db.prepare('SELECT id, parent_id FROM social_comments WHERE id = ? AND post_id = ?').get(Number(body.parentId), row.id) ?? fail(400, 'That comment is gone');
      parentId = parent.parent_id ?? parent.id;
    }
    // A comment can be dated (to sit with a back-dated post).
    const postedAt = whenInput(body.postedAt) ?? ctx.storyNow();
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
