// Builds the NUUVI web server: static files, the API router, live updates, notifications and push.
// Every feature's routes live in server/routes/ and are registered here.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, mkdtempSync, createReadStream } from 'node:fs';
import { join, normalize, extname, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { userForToken, parseCookies, sessionCookie, createRateLimiter, SESSION_COOKIE } from './auth.js';
import { HttpError, fail, createRouter } from './http.js';
import { toUser, toChannel, turnState, storyAccess, modLog, requireAdmin } from './model.js';
import { createPusher, loadVapidKeys } from './push.js';
import { accountRoutes } from './routes/account.js';
import { storyRoutes } from './routes/stories.js';
import { postRoutes } from './routes/posts.js';
import { adminRoutes } from './routes/admin.js';
import { threadRoutes } from './routes/threads.js';
import { eventRoutes } from './routes/events.js';
import { phoneRoutes } from './routes/phone.js';
import { overviewRoutes } from './routes/overview.js';
import { socialRoutes, socialPostRoutes } from './routes/social.js';
import { connectionRoutes } from './routes/connections.js';
import { profileRoutes } from './routes/profiles.js';
import { messageRoutes } from './routes/messages.js';
import { aiRoutes } from './routes/ai.js';
import { placeRoutes } from './routes/places.js';
import { devRoutes } from './routes/dev.js';
import { draftRoutes } from './routes/drafts.js';
import { suggestionRoutes } from './routes/suggestions.js';
import { planRoutes } from './routes/plans.js';
import { socialStoryRoutes } from './routes/social-stories.js';
import { readClock, writeClock, storyNowSql, publicClock } from './clock.js';
import { worldRoutes } from './routes/world.js';
import { nameKey } from './names.js';
import { plainText } from './text.js';
import { createBots } from './bots.js';
import { createSongs } from './songs.js';
import { batchRoutes } from './routes/batches.js';
import { createAiBuzz } from './ai-buzz.js';
import { createAi } from './ai.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
// Big enough for a novel-length thread post.
const MAX_JSON_BYTES = 4 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.weba': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()',
  // Other sites can't open NUUVI in a way that lets them reach into it, or embed its files.
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Content-Security-Policy':
    "upgrade-insecure-requests; default-src 'self'; object-src 'none'; img-src 'self' data: blob: https:; media-src 'self' blob: https://*.itunes.apple.com https://*.mzstatic.com https://*.apple.com; style-src 'self'; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self'; frame-src https://open.spotify.com https://embed.music.apple.com https://www.youtube-nocookie.com https://w.soundcloud.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// Live connections (Server-Sent Events). Each stream belongs to a user (or an anonymous
// reader) and may be "watching" one story, which lets non-members read public stories live.
function createHub(db) {
  const streams = new Set();
  const write = (s, event, data) => s.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // Who's online = signed-in users with at least one open live connection.
  const online = () => [...new Set([...streams].map((s) => s.userId).filter(Boolean))];
  let presenceTimer = null;
  let lastPresence = '';
  const announcePresence = () => {
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(() => {
      const ids = online().sort((a, b) => a - b);
      if (ids.join() === lastPresence) return;
      lastPresence = ids.join();
      for (const s of streams) if (s.userId) write(s, 'presence', { online: ids });
    }, 800);
    presenceTimer.unref?.();
  };
  return {
    online,
    add(stream) {
      streams.add(stream);
      announcePresence();
      return () => {
        streams.delete(stream);
        announcePresence();
      };
    },
    sendUser(userId, event, data) {
      for (const s of streams) if (s.userId === userId) write(s, event, data);
    },
    sendStory(storyId, event, data) {
      const story = db.prepare('SELECT * FROM stories WHERE id = ?').get(storyId);
      const members = new Set(
        db
          .prepare('SELECT user_id FROM story_members WHERE story_id = ?')
          .all(storyId)
          .map((m) => m.user_id),
      );
      // The site owner reading a private story they're not in gets live updates too.
      const admins =
        story?.visibility === 'private'
          ? new Set(
              db
                .prepare('SELECT id FROM users WHERE is_owner = 1')
                .all()
                .map((u) => u.id),
            )
          : new Set();
      for (const s of streams) {
        if (
          (s.userId && members.has(s.userId)) ||
          (s.storyId === storyId && (story?.visibility === 'public' || admins.has(s.userId)))
        )
          write(s, event, data);
      }
    },
    // A tab tells us when it's in front of the user; while one is, we don't push to their devices.
    setVisible(userId, tab, visible) {
      for (const s of streams) if (s.userId === userId && s.tab === tab) s.visible = visible;
    },
    isActive(userId) {
      return [...streams].some((s) => s.userId === userId && s.visible);
    },
    disconnectUser(userId) {
      for (const s of streams) if (s.userId === userId) s.res.end();
    },
  };
}

export function createApp({
  dbPath = ':memory:',
  uploadDir,
  secureCookies = false,
  openRegistration = false,
  trustProxy = false,
  authRateLimit = 20,
  vapidSubject = 'mailto:admin@localhost',
  pushFetch,
  bots: botOptions = {},
  ai: aiOptions = {},
  songFetch,
} = {}) {
  const db = openDb(dbPath);
  // In production (always HTTPS): browsers remember to only ever use HTTPS for this site.
  if (secureCookies) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  uploadDir ??= dbPath === ':memory:' ? mkdtempSync(join(tmpdir(), 'nuuvi-uploads-')) : join(dirname(dbPath), 'uploads');
  mkdirSync(uploadDir, { recursive: true });

  const hub = createHub(db);
  const ctx = {
    db,
    hub,
    config: { uploadDir, openRegistration },
    authLimiter: createRateLimiter({ limit: authRateLimit, windowMs: 15 * 60 * 1000 }),
    // Wrong passwords for one account, from anywhere: slows down guessing spread over many addresses.
    accountLimiter: createRateLimiter({ limit: Math.max(10, Math.round(authRateLimit / 2)), windowMs: 15 * 60 * 1000 }),
    pusher: createPusher({ db, vapid: loadVapidKeys(db), subject: vapidSubject, fetchImpl: pushFetch }),
    modLog: (actorId, action, detail) => modLog(db, actorId, action, detail),
    clock: () => readClock(db),
    // Now in Ardell City as SQLite text, or null when the city is on the real date.
    storyNow: () => storyNowSql(readClock(db)),
  };

  ctx.userStats = (userId) =>
    db
      .prepare(
        `SELECT
      (SELECT COUNT(*) FROM posts WHERE user_id = :u) AS posts,
      (SELECT COALESCE(SUM(word_count), 0) FROM posts WHERE user_id = :u) AS words,
      (SELECT COUNT(*) FROM characters WHERE user_id = :u) AS characters,
      (SELECT COUNT(*) FROM story_members WHERE user_id = :u) AS stories`,
      )
      .get({ u: userId });

  // ---------- Notifications ----------
  // Every notification is read with its writer, story, channel and the characters involved: the one
  // who acted (texted, liked, posted…) for the picture, and for texts the phone it went to.
  ctx.notificationSql = `
    SELECT n.*, a.username AS a_username, a.display_name AS a_display_name, a.avatar AS a_avatar, a.id AS a_id,
      s.title AS story_title, ch.name AS channel_name,
      ac.id AS ac_id, ac.name AS ac_name, ac.avatar AS ac_avatar, ac.color AS ac_color,
      rc.name AS rc_name, pt.is_group AS pt_group, pt.title AS pt_title
    FROM notifications n
    LEFT JOIN users a ON a.id = n.actor_id
    LEFT JOIN stories s ON s.id = n.story_id
    LEFT JOIN channels ch ON ch.id = n.channel_id
    LEFT JOIN posts p ON p.id = n.post_id
    LEFT JOIN characters ac ON ac.id = COALESCE(n.from_character_id,
      CASE WHEN n.type IN ('like', 'comment', 'socialtag', 'follow', 'connection') THEN n.character_id END, p.character_id)
    LEFT JOIN characters rc ON rc.id = n.character_id AND n.type IN ('dm', 'call')
    LEFT JOIN phone_threads pt ON pt.id = n.phone_thread_id`;
  const phoneUrl = (row) => `#/phone/${row.character_id}${row.phone_thread_id ? `/t/${row.phone_thread_id}` : ''}`;
  ctx.toNotification = (row) => ({
    id: row.id,
    type: row.type,
    count: row.count,
    text: row.text,
    createdAt: row.created_at,
    read: !!row.read_at,
    actor: row.a_id ? toUser(row, 'a_') : null,
    story: row.story_id ? { id: row.story_id, title: row.story_title } : null,
    channel: row.channel_id ? { id: row.channel_id, name: row.channel_name } : null,
    postId: row.post_id,
    characterId: row.character_id ?? null,
    socialId: row.social_id ?? null,
    from: row.ac_id ? { id: row.ac_id, name: row.ac_name, avatar: row.ac_avatar, color: row.ac_color } : null,
    to: row.rc_name ? { id: row.character_id, name: row.rc_name } : null,
    group: row.pt_group ? { title: row.pt_title || '' } : null,
    url:
      row.type === 'report'
        ? '#/admin'
        : row.type === 'dev'
          ? `#/dev/${row.dev_id}`
          : row.type === 'suggestion'
            ? '#/suggestions'
            : row.type === 'dm' || row.type === 'call'
              ? phoneUrl(row)
              : row.social_id
                ? `#/p/${row.social_id}`
                : row.type === 'message'
                  ? `#/messages/${row.actor_id}`
                  : row.type === 'connection'
                    ? '#/nu'
                    : ['follow', 'followreq', 'tie', 'batch'].includes(row.type) && row.character_id
                      ? `#/c/${row.character_id}`
                      : row.type === 'added' && row.story_id
                        ? `#/s/${row.story_id}`
                        : row.story_id && row.channel_id
                          ? `#/s/${row.story_id}/${row.channel_id}`
                          : '#/notifications',
  });

  const snippet = (post) => {
    if (post.cw) return `CW: ${post.cw}`;
    return plainText(post.body) || (post.media?.length ? 'sent a picture' : '');
  };

  function createNotification({
    userId,
    type,
    actorId = null,
    storyId = null,
    channelId = null,
    postId = null,
    characterId = null,
    socialId = null,
    fromCharacterId = null,
    phoneThreadId = null,
    devId = null,
    text = '',
  }) {
    let notificationId;
    // Unread posts in one channel (or texts to one phone) pile up into a single notification.
    const existing =
      (type === 'post' &&
        db
          .prepare(
            `SELECT id FROM notifications
      WHERE user_id = ? AND type = 'post' AND channel_id = ? AND read_at IS NULL`,
          )
          .get(userId, channelId)) ||
      (type === 'dm' &&
        db
          .prepare(
            `SELECT id FROM notifications
      WHERE user_id = ? AND type = 'dm' AND character_id = ? AND phone_thread_id IS ? AND read_at IS NULL`,
          )
          .get(userId, characterId, phoneThreadId)) ||
      (type === 'message' &&
        db
          .prepare(
            `SELECT id FROM notifications
      WHERE user_id = ? AND type = 'message' AND actor_id = ? AND read_at IS NULL`,
          )
          .get(userId, actorId));
    if (existing) {
      db.prepare(
        `UPDATE notifications SET count = count + 1, actor_id = ?, post_id = ?, from_character_id = ?, text = ?, created_at = datetime('now') WHERE id = ?`,
      ).run(actorId, postId, fromCharacterId, text, existing.id);
      notificationId = existing.id;
    } else {
      notificationId = Number(
        db
          .prepare(
            `INSERT INTO notifications (user_id, type, actor_id, story_id, channel_id, post_id, character_id, social_id, from_character_id, phone_thread_id, dev_id, text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            userId,
            type,
            actorId,
            storyId,
            channelId,
            postId,
            characterId,
            socialId,
            fromCharacterId,
            phoneThreadId,
            devId,
            text,
          ).lastInsertRowid,
      );
    }
    const n = ctx.toNotification(db.prepare(`${ctx.notificationSql} WHERE n.id = ?`).get(notificationId));
    hub.sendUser(userId, 'notification', n);

    const where = n.channel ? `#${n.channel.name}` : '';
    const push = {
      post: () => ({
        title: n.story?.title ?? 'NUUVI',
        body: n.count > 1 ? `${n.count} new posts in ${where}` : `${n.actor?.displayName} in ${where}: ${text}`,
      }),
      mention: () => ({ title: `${n.actor?.displayName} mentioned you`, body: `${where} · ${n.story?.title}: ${text}` }),
      turn: () => ({ title: `Your turn in ${n.story?.title}`, body: `${where}${text ? `: ${text}` : ''}` }),
      report: () => ({ title: 'New report', body: text }),
      follow: () => ({ title: 'New follower', body: text }),
      like: () => ({ title: 'New like', body: text }),
      comment: () => ({ title: 'New comment', body: text }),
      socialtag: () => ({ title: 'Tagged on THE NU', body: text }),
      tag: () => ({ title: `${n.actor?.displayName} tagged you in a thread`, body: `${where} · ${n.story?.title}` }),
      dm: () => ({ title: ctx.textTitle(n), body: text }),
      call: () => ({
        title: `${n.to?.name ?? 'You'} missed a ${text === 'facetime' ? 'FaceTime' : 'call'}`,
        body: `${n.from?.name ?? 'Someone'} called${n.group ? ` ${n.group.title || 'the group'}` : ''}`,
      }),
      followreq: () => ({ title: 'Follow request', body: text }),
      tie: () => ({ title: 'New tie', body: text }),
      reply: () => ({ title: `${n.actor?.displayName} replied to you`, body: `${where} · ${text}` }),
      message: () => ({
        title: n.count > 1 ? `${n.count} messages from ${n.actor?.displayName}` : `Message from ${n.actor?.displayName}`,
        body: text,
      }),
      connection: () => ({ title: 'Connection picked up', body: text }),
      added: () => ({ title: `Added to ${n.story?.title ?? 'a story'}`, body: `${n.actor?.displayName} added you` }),
    }[type]?.() ?? { title: 'NUUVI', body: text };
    // Phone/desktop pop-ups only when they're not actively using NUUVI.
    if (!hub.isActive(userId))
      ctx.pusher.send(userId, { ...push, url: `/${n.url}`, tag: n.channel ? `channel-${n.channel.id}` : `n-${n.id}` });
  }

  ctx.notify = createNotification;
  // "{a} texted {b}", "{a} sent 3 texts to {b}", "{a} texted {b} in Crew", "4 new texts for {b} in Crew".
  ctx.textTitle = (n) => {
    const from = n.from?.name ?? 'Someone';
    const to = n.to?.name ?? 'you';
    const where = n.group ? ` in ${n.group.title || 'a group chat'}` : '';
    if (n.count > 1) return n.group ? `${n.count} new texts for ${to}${where}` : `${from} sent ${n.count} texts to ${to}`;
    return `${from} texted ${to}${where}`;
  };

  ctx.notifyPost = (post, story, channel) => {
    const members = db
      .prepare(
        `SELECT m.user_id, m.notify, u.username FROM story_members m JOIN users u ON u.id = m.user_id
      WHERE m.story_id = ? AND m.user_id != ?`,
      )
      .all(story.id, post.userId);
    const blockers = new Set(
      db
        .prepare('SELECT blocker_id FROM blocks WHERE blocked_id = ?')
        .all(post.userId)
        .map((b) => b.blocker_id),
    );
    // @name ends at a space; trailing punctuation ("@rose!") is tried both with and without.
    const mentioned = new Set();
    for (const [, raw] of post.body.matchAll(/@([^\s@]+)/g)) {
      mentioned.add(nameKey(raw));
      mentioned.add(nameKey(raw.replace(/[.,!?;:)\]}'"’”…*_~|]+$/u, '')));
    }
    const text = snippet(post);
    for (const m of members) {
      if (blockers.has(m.user_id) || m.notify === 'none') continue;
      const base = { userId: m.user_id, actorId: post.userId, storyId: story.id, channelId: channel.id, postId: post.id, text };
      if (mentioned.has(nameKey(m.username))) createNotification({ ...base, type: 'mention' });
      else if (m.notify === 'all') createNotification({ ...base, type: 'post' });
    }
  };

  ctx.notifyTurn = (channel, actorId) => {
    const { current } = turnState(channel);
    if (!current || current === actorId) return;
    createNotification({ userId: current, type: 'turn', actorId, storyId: channel.story_id, channelId: channel.id });
  };

  ctx.notifyAdmins = (actorId, text) => {
    for (const a of db.prepare('SELECT id FROM users WHERE is_admin = 1 AND id != ?').all(actorId)) {
      createNotification({ userId: a.id, type: 'report', actorId, text });
    }
  };

  ctx.advanceTurn = (channel, actorId) => {
    const order = JSON.parse(channel.turn_order);
    if (!order.length) return channel;
    db.prepare('UPDATE channels SET turn_index = ? WHERE id = ?').run((channel.turn_index + 1) % order.length, channel.id);
    const updated = db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.id);
    hub.sendStory(channel.story_id, 'channel', toChannel(updated));
    ctx.notifyTurn(updated, actorId);
    return updated;
  };

  ctx.removeMember = (storyId, userId) => {
    db.prepare('DELETE FROM story_members WHERE story_id = ? AND user_id = ?').run(storyId, userId);
    for (const c of db.prepare('SELECT * FROM channels WHERE story_id = ?').all(storyId)) {
      const order = JSON.parse(c.turn_order);
      const at = order.indexOf(userId);
      if (at < 0) continue;
      order.splice(at, 1);
      let index = c.turn_index % (order.length + 1);
      if (at < index) index -= 1;
      if (index >= order.length) index = 0;
      db.prepare('UPDATE channels SET turn_order = ?, turn_index = ? WHERE id = ?').run(JSON.stringify(order), index, c.id);
    }
    hub.sendStory(storyId, 'story', { storyId });
  };

  const router = createRouter();
  accountRoutes(router, ctx);
  storyRoutes(router, ctx);
  postRoutes(router, ctx);
  adminRoutes(router, ctx);
  ctx.bots = createBots(ctx, botOptions);
  // Song previews for posts (from Apple Music's free search).
  ctx.songs = createSongs(songFetch ? { fetch: songFetch } : {});
  // Fan comments by Claude, looking at the pictures (only when an API key is set).
  ctx.ai = createAi(aiOptions);
  ctx.aiBuzz = createAiBuzz({ db, hub, uploadDir, ai: ctx.ai });
  const botTimer = setInterval(
    () => {
      try {
        ctx.bots.tick();
        ctx.batches?.tick();
      } catch (err) {
        console.error('bots', err);
      }
    },
    15 * 60 * 1000,
  );
  botTimer.unref?.();
  threadRoutes(router, ctx);
  eventRoutes(router, ctx);
  phoneRoutes(router, ctx);
  overviewRoutes(router, ctx);
  socialRoutes(router, ctx);
  batchRoutes(router, ctx, botOptions);
  socialPostRoutes(router, ctx);
  connectionRoutes(router, ctx);
  profileRoutes(router, ctx);
  messageRoutes(router, ctx);
  aiRoutes(router, ctx);
  placeRoutes(router, ctx);
  devRoutes(router, ctx);
  draftRoutes(router, ctx);
  suggestionRoutes(router, ctx);
  planRoutes(router, ctx);
  socialStoryRoutes(router, ctx);
  worldRoutes(router, ctx);

  // The date in Ardell City (see clock.js): everyone can read it, admins set it.
  router.get('/api/clock', () => ({ data: { clock: publicClock(ctx.clock()) } }));
  router.put('/api/admin/clock', ({ user, body }) => {
    requireAdmin(user);
    let clock;
    try {
      clock = writeClock(db, body || {});
    } catch (err) {
      fail(err.status || 400, err.message);
    }
    ctx.modLog(
      user.id,
      'set-clock',
      clock.mode === 'real'
        ? 'real date'
        : `${clock.mode} ${clock.date}${clock.mode === 'timer' ? `, +1 day every ${clock.every} days` : ''}`,
    );
    return { data: { clock: publicClock(clock) } };
  });

  // ---------- Live updates ----------
  function handleEvents(req, res, user, query) {
    const storyId = Number(query.get('story')) || null;
    if (storyId) storyAccess(db, storyId, user);
    else if (!user) fail(401, 'Please sign in');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
      ...SECURITY_HEADERS,
    });
    res.write('retry: 3000\n: connected\n\n');
    const tab = String(query.get('tab') || '').slice(0, 40);
    const remove = hub.add({ res, userId: user?.id ?? null, storyId, tab, visible: query.get('visible') !== '0' });
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      remove();
    });
  }

  // ---------- Static files & uploads ----------
  // Serves a file, honouring Range requests (Safari won't play audio/video without them).
  async function sendFile(res, file, cacheControl, req) {
    let info;
    try {
      info = await stat(file);
    } catch {
      fail(404, 'Not found');
    }
    if (!info.isFile()) fail(404, 'Not found');
    const headers = {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      'Accept-Ranges': 'bytes',
      ...SECURITY_HEADERS,
    };
    const range = req?.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
      let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
      end = Math.min(end, info.size - 1);
      if (start > end || start >= info.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}`, ...SECURITY_HEADERS });
        return res.end();
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Content-Length': end - start + 1,
      });
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (info.size > 1024 * 1024) return createReadStream(file).pipe(res);
    res.end(await readFile(file));
  }

  async function serveStatic(pathname, res, req) {
    const upload = pathname.match(/^\/uploads\/([\w-]+\.(?:png|jpg|webp|gif|mp4|mov|webm|m4a|weba|ogg|mp3|wav))$/);
    if (upload) return sendFile(res, join(uploadDir, upload[1]), 'private, max-age=31536000, immutable', req);
    let rel;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      fail(400, 'Bad path');
    }
    if (rel === '/' || !extname(rel)) rel = '/index.html'; // SPA fallback
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) fail(404, 'Not found');
    return sendFile(res, file, 'no-cache');
  }

  async function readBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) fail(413, 'That is too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  function parseJson(buf) {
    if (!buf.length) return {};
    let parsed;
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch {
      fail(400, 'Invalid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Expected a JSON object');
    return parsed;
  }

  function sendJson(res, status, data, extraHeaders = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      ...extraHeaders,
    });
    res.end(JSON.stringify(data));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed');
        return await serveStatic(url.pathname, res, req);
      }

      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const user = userForToken(db, token);

      if (url.pathname === '/api/events' && req.method === 'GET') return handleEvents(req, res, user, url.searchParams);

      const route = router.match(req.method, url.pathname);
      if (!route) fail(404, 'Not found');

      let body = {};
      let rawBody = null;
      if (req.method !== 'GET') {
        // Defence against cross-site requests: the browser's Origin must match this site.
        const origin = req.headers.origin;
        if (origin && origin !== 'null' && new URL(origin).host !== req.headers.host) fail(403, 'Cross-site request blocked');
        const type = req.headers['content-type'] || '';
        if (route.options.raw) {
          rawBody = await readBody(req, route.options.raw);
        } else if (req.method === 'POST' || req.method === 'PUT') {
          // JSON can't be sent cross-site without a CORS preflight, which we never grant.
          if (!type.startsWith('application/json')) fail(415, 'Expected application/json');
          body = parseJson(await readBody(req, MAX_JSON_BYTES));
        }
      }

      const cookies = [];
      const result = await route.handler({
        user,
        token,
        body,
        rawBody,
        params: route.params,
        query: url.searchParams,
        headers: req.headers,
        ip: trustProxy
          ? req.headers['fly-client-ip'] ||
            String(req.headers['x-forwarded-for'] || '')
              .split(',')[0]
              .trim() ||
            req.socket.remoteAddress
          : req.socket.remoteAddress,
        setSession: ({ token: t, maxAge }) => cookies.push(sessionCookie(t, maxAge, secureCookies)),
        clearSession: () => cookies.push(sessionCookie('', 0, secureCookies)),
      });
      sendJson(res, result.status || 200, result.data, cookies.length ? { 'Set-Cookie': cookies } : {});
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) {
        if (url.pathname.startsWith('/api/')) return sendJson(res, err.status, { error: err.message });
        res.writeHead(err.status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        return res.end(err.message);
      }
      console.error(err);
      sendJson(res, 500, { error: 'Something went wrong' });
    }
  });

  server.on('close', () => db.close());
  server.ctx = ctx;
  return server;
}
