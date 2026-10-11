import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, normalize, extname, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { userForToken, parseCookies, sessionCookie, createRateLimiter, SESSION_COOKIE } from './auth.js';
import { HttpError, fail, createRouter } from './http.js';
import { toUser, toChannel, turnState, storyAccess, modLog } from './model.js';
import { createPusher, loadVapidKeys } from './push.js';
import { accountRoutes } from './routes/account.js';
import { storyRoutes } from './routes/stories.js';
import { postRoutes } from './routes/posts.js';
import { adminRoutes } from './routes/admin.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_JSON_BYTES = 256 * 1024;

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
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

// Live connections (Server-Sent Events). Each stream belongs to a user (or an anonymous
// reader) and may be "watching" one story, which lets non-members read public stories live.
function createHub(db) {
  const streams = new Set();
  const write = (s, event, data) => s.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  return {
    add(stream) { streams.add(stream); return () => streams.delete(stream); },
    sendUser(userId, event, data) {
      for (const s of streams) if (s.userId === userId) write(s, event, data);
    },
    sendStory(storyId, event, data) {
      const story = db.prepare('SELECT visibility FROM stories WHERE id = ?').get(storyId);
      const members = new Set(db.prepare('SELECT user_id FROM story_members WHERE story_id = ?').all(storyId).map((m) => m.user_id));
      for (const s of streams) {
        if ((s.userId && members.has(s.userId)) || (s.storyId === storyId && story?.visibility === 'public')) write(s, event, data);
      }
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
} = {}) {
  const db = openDb(dbPath);
  uploadDir ??= dbPath === ':memory:' ? mkdtempSync(join(tmpdir(), 'nuuvi-uploads-')) : join(dirname(dbPath), 'uploads');
  mkdirSync(uploadDir, { recursive: true });

  const hub = createHub(db);
  const ctx = {
    db,
    hub,
    config: { uploadDir, openRegistration },
    authLimiter: createRateLimiter({ limit: authRateLimit, windowMs: 15 * 60 * 1000 }),
    pusher: createPusher({ db, vapid: loadVapidKeys(db), subject: vapidSubject, fetchImpl: pushFetch }),
    modLog: (actorId, action, detail) => modLog(db, actorId, action, detail),
  };

  // ---------- Notifications ----------
  ctx.toNotification = (row) => ({
    id: row.id, type: row.type, count: row.count, text: row.text, createdAt: row.created_at, read: !!row.read_at,
    actor: row.a_id ? toUser(row, 'a_') : null,
    story: row.story_id ? { id: row.story_id, title: row.story_title } : null,
    channel: row.channel_id ? { id: row.channel_id, name: row.channel_name } : null,
    postId: row.post_id,
    url: row.type === 'report' ? '#/admin' : row.story_id && row.channel_id ? `#/s/${row.story_id}/${row.channel_id}` : '#/notifications',
  });

  const snippet = (post) => {
    if (post.cw) return `CW: ${post.cw}`;
    if (post.roll) return `🎲 ${post.roll.expr} → ${post.roll.total}${post.body ? ` — ${post.body}` : ''}`;
    const text = post.body.replace(/[*_~`>]/g, '').replace(/\s+/g, ' ').trim();
    return text.length > 140 ? text.slice(0, 139) + '…' : text;
  };

  function createNotification({ userId, type, actorId = null, storyId = null, channelId = null, postId = null, text = '' }) {
    let notificationId;
    const existing = type === 'post' && db.prepare(`SELECT id FROM notifications
      WHERE user_id = ? AND type = 'post' AND channel_id = ? AND read_at IS NULL`).get(userId, channelId);
    if (existing) {
      db.prepare(`UPDATE notifications SET count = count + 1, actor_id = ?, post_id = ?, text = ?, created_at = datetime('now') WHERE id = ?`)
        .run(actorId, postId, text, existing.id);
      notificationId = existing.id;
    } else {
      notificationId = Number(db.prepare(`INSERT INTO notifications (user_id, type, actor_id, story_id, channel_id, post_id, text)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, type, actorId, storyId, channelId, postId, text).lastInsertRowid);
    }
    const n = ctx.toNotification(db.prepare(`
      SELECT n.*, a.username AS a_username, a.display_name AS a_display_name, a.avatar AS a_avatar, a.id AS a_id,
        s.title AS story_title, c.name AS channel_name
      FROM notifications n LEFT JOIN users a ON a.id = n.actor_id
      LEFT JOIN stories s ON s.id = n.story_id LEFT JOIN channels c ON c.id = n.channel_id
      WHERE n.id = ?`).get(notificationId));
    hub.sendUser(userId, 'notification', n);

    const where = n.channel ? `#${n.channel.name}` : '';
    const push = {
      post: () => ({
        title: n.story?.title ?? 'NUUVI',
        body: n.count > 1 ? `${n.count} new posts in ${where}` : `${n.actor?.displayName} in ${where}: ${text}`,
      }),
      mention: () => ({ title: `${n.actor?.displayName} mentioned you`, body: `${where} · ${n.story?.title}: ${text}` }),
      turn: () => ({ title: `Your turn in ${n.story?.title}`, body: `${where}${text ? ` — ${text}` : ''}` }),
      report: () => ({ title: 'New report', body: text }),
    }[type]();
    ctx.pusher.send(userId, { ...push, url: `/${n.url}`, tag: n.channel ? `channel-${n.channel.id}` : `n-${n.id}` });
  }

  ctx.notifyPost = (post, story, channel) => {
    const members = db.prepare(`SELECT m.user_id, m.notify, u.username FROM story_members m JOIN users u ON u.id = m.user_id
      WHERE m.story_id = ? AND m.user_id != ?`).all(story.id, post.userId);
    const blockers = new Set(db.prepare('SELECT blocker_id FROM blocks WHERE blocked_id = ?').all(post.userId).map((b) => b.blocker_id));
    const mentioned = new Set([...post.body.matchAll(/@([a-zA-Z0-9_]{3,24})/g)].map((m) => m[1].toLowerCase()));
    const text = snippet(post);
    for (const m of members) {
      if (blockers.has(m.user_id) || m.notify === 'none') continue;
      const base = { userId: m.user_id, actorId: post.userId, storyId: story.id, channelId: channel.id, postId: post.id, text };
      if (mentioned.has(m.username.toLowerCase())) createNotification({ ...base, type: 'mention' });
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
    const remove = hub.add({ res, userId: user?.id ?? null, storyId });
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      remove();
    });
  }

  // ---------- Static files & uploads ----------
  async function sendFile(res, file, cacheControl) {
    try {
      const info = await stat(file);
      if (!info.isFile()) fail(404, 'Not found');
    } catch {
      fail(404, 'Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': cacheControl, ...SECURITY_HEADERS });
    res.end(await readFile(file));
  }

  async function serveStatic(pathname, res) {
    const upload = pathname.match(/^\/uploads\/([\w-]+\.(?:png|jpg|webp|gif))$/);
    if (upload) return sendFile(res, join(uploadDir, upload[1]), 'private, max-age=31536000, immutable');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { fail(400, 'Bad path'); }
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
    try { parsed = JSON.parse(buf.toString('utf8')); } catch { fail(400, 'Invalid JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Expected a JSON object');
    return parsed;
  }

  function sendJson(res, status, data, extraHeaders = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extraHeaders });
    res.end(JSON.stringify(data));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed');
        return await serveStatic(url.pathname, res);
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
        user, token, body, rawBody, params: route.params, query: url.searchParams, headers: req.headers,
        ip: trustProxy ? (req.headers['fly-client-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress) : req.socket.remoteAddress,
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
