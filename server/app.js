import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import {
  hashPassword, verifyPassword, createSession, userForToken, destroySession,
  parseCookies, sessionCookie, createRateLimiter, SESSION_COOKIE,
} from './auth.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY_BYTES = 256 * 1024;
const MAX_POST_CHARS = 20000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new HttpError(status, message); };

function str(value, field, { min = 0, max = 200, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') fail(400, `${field} must be text`);
  const v = value.trim();
  if (v.length < min) fail(400, min === 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (v.length > max) fail(400, `${field} must be at most ${max} characters`);
  return v;
}

function oneOf(value, field, options) {
  if (value === undefined) return undefined;
  if (!options.includes(value)) fail(400, `${field} must be one of: ${options.join(', ')}`);
  return value;
}

function color(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) fail(400, 'color must be a hex value like #7c5cff');
  return value;
}

const countWords = (text) => (text.match(/\S+/g) || []).length;
const inviteCode = () => randomBytes(6).toString('base64url');

function toCharacter(r) {
  return { id: r.id, userId: r.user_id, name: r.name, tagline: r.tagline, bio: r.bio, color: r.color, createdAt: r.created_at };
}

function toStory(r) {
  return {
    id: r.id, ownerId: r.owner_id, title: r.title, summary: r.summary, genre: r.genre,
    rating: r.rating, visibility: r.visibility, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
    memberCount: r.member_count, postCount: r.post_count, ownerName: r.owner_name,
  };
}

function toPost(r) {
  return {
    id: r.id, storyId: r.story_id, userId: r.user_id, kind: r.kind, body: r.body, wordCount: r.word_count,
    createdAt: r.created_at, editedAt: r.edited_at,
    author: { username: r.username, displayName: r.display_name },
    character: r.character_id ? { id: r.character_id, name: r.character_name, color: r.character_color } : null,
  };
}

const STORY_SELECT = `
  SELECT s.*, u.display_name AS owner_name,
    (SELECT COUNT(*) FROM story_members m WHERE m.story_id = s.id) AS member_count,
    (SELECT COUNT(*) FROM posts p WHERE p.story_id = s.id) AS post_count
  FROM stories s JOIN users u ON u.id = s.owner_id`;

const POST_SELECT = `
  SELECT p.*, u.username, u.display_name, c.name AS character_name, c.color AS character_color
  FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN characters c ON c.id = p.character_id`;

export function createApp({ dbPath = ':memory:', secureCookies = false } = {}) {
  const db = openDb(dbPath);
  const authLimiter = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 });
  // storyId -> Set of SSE responses
  const listeners = new Map();

  function broadcast(storyId, event, data) {
    const subs = listeners.get(storyId);
    if (!subs) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of subs) res.write(payload);
  }

  function membership(storyId, userId) {
    if (!userId) return null;
    return db.prepare('SELECT role FROM story_members WHERE story_id = ? AND user_id = ?').get(storyId, userId)?.role ?? null;
  }

  // Loads a story the user may read; private stories are invisible to non-members.
  function readableStory(storyId, user) {
    const row = db.prepare(`${STORY_SELECT} WHERE s.id = ?`).get(storyId);
    if (!row) fail(404, 'Story not found');
    const role = membership(storyId, user?.id);
    if (row.visibility === 'private' && !role) fail(404, 'Story not found');
    return { row, role };
  }

  function requireUser(user) {
    if (!user) fail(401, 'Please sign in');
    return user;
  }

  function ownCharacter(characterId, userId) {
    const c = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(characterId, userId);
    if (!c) fail(400, 'Choose one of your own characters');
    return c;
  }

  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
    routes.push({ method, regex, keys, handler });
  };

  // ---------- Auth ----------
  route('POST', '/api/auth/register', ({ body, ip, setSession }) => {
    if (!authLimiter(ip)) fail(429, 'Too many attempts, try again later');
    const username = str(body.username, 'Username', { min: 3, max: 24, required: true });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) fail(400, 'Username may only use letters, numbers and _');
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8) fail(400, 'Password must be at least 8 characters');
    if (password.length > 200) fail(400, 'Password is too long');
    const displayName = str(body.displayName, 'Display name', { max: 40 }) || username;
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is taken');
    const { lastInsertRowid } = db.prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)')
      .run(username, displayName, hashPassword(password));
    setSession(createSession(db, Number(lastInsertRowid)));
    return { status: 201, data: { user: { id: Number(lastInsertRowid), username, displayName, bio: '' } } };
  });

  route('POST', '/api/auth/login', ({ body, ip, setSession }) => {
    if (!authLimiter(ip)) fail(429, 'Too many attempts, try again later');
    const row = typeof body.username === 'string'
      ? db.prepare('SELECT * FROM users WHERE username = ?').get(body.username.trim())
      : null;
    if (!row || typeof body.password !== 'string' || !verifyPassword(body.password, row.password_hash)) {
      fail(401, 'Wrong username or password');
    }
    setSession(createSession(db, row.id));
    return { data: { user: { id: row.id, username: row.username, displayName: row.display_name, bio: row.bio } } };
  });

  route('POST', '/api/auth/logout', ({ token, clearSession }) => {
    destroySession(db, token);
    clearSession();
    return { data: { ok: true } };
  });

  route('GET', '/api/me', ({ user }) => ({ data: { user } }));

  route('PUT', '/api/me', ({ user, body }) => {
    requireUser(user);
    const displayName = str(body.displayName, 'Display name', { min: 1, max: 40 }) ?? user.displayName;
    const bio = str(body.bio, 'Bio', { max: 2000 }) ?? user.bio;
    db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(displayName, bio, user.id);
    return { data: { user: { ...user, displayName, bio } } };
  });

  // ---------- Characters ----------
  route('GET', '/api/characters', ({ user }) => {
    requireUser(user);
    const rows = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(user.id);
    return { data: { characters: rows.map(toCharacter) } };
  });

  route('GET', '/api/characters/:id', ({ params }) => {
    const row = db.prepare('SELECT c.*, u.username, u.display_name FROM characters c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(params.id);
    if (!row) fail(404, 'Character not found');
    return { data: { character: { ...toCharacter(row), owner: { username: row.username, displayName: row.display_name } } } };
  });

  route('POST', '/api/characters', ({ user, body }) => {
    requireUser(user);
    const count = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id = ?').get(user.id).n;
    if (count >= 100) fail(400, 'You can have at most 100 characters');
    const name = str(body.name, 'Name', { min: 1, max: 60, required: true });
    const tagline = str(body.tagline, 'Tagline', { max: 140 }) ?? '';
    const bio = str(body.bio, 'Bio', { max: 10000 }) ?? '';
    const c = color(body.color) ?? '#7c5cff';
    const { lastInsertRowid } = db.prepare('INSERT INTO characters (user_id, name, tagline, bio, color) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, name, tagline, bio, c);
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(lastInsertRowid);
    return { status: 201, data: { character: toCharacter(row) } };
  });

  route('PUT', '/api/characters/:id', ({ user, body, params }) => {
    requireUser(user);
    const existing = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(params.id, user.id);
    if (!existing) fail(404, 'Character not found');
    const name = str(body.name, 'Name', { min: 1, max: 60 }) ?? existing.name;
    const tagline = str(body.tagline, 'Tagline', { max: 140 }) ?? existing.tagline;
    const bio = str(body.bio, 'Bio', { max: 10000 }) ?? existing.bio;
    const c = color(body.color) ?? existing.color;
    db.prepare('UPDATE characters SET name = ?, tagline = ?, bio = ?, color = ? WHERE id = ?').run(name, tagline, bio, c, existing.id);
    return { data: { character: toCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(existing.id)) } };
  });

  route('DELETE', '/api/characters/:id', ({ user, params }) => {
    requireUser(user);
    const { changes } = db.prepare('DELETE FROM characters WHERE id = ? AND user_id = ?').run(params.id, user.id);
    if (!changes) fail(404, 'Character not found');
    return { data: { ok: true } };
  });

  // ---------- Stories ----------
  route('GET', '/api/stories', ({ user, query }) => {
    const scope = query.get('scope') || 'public';
    const q = (query.get('q') || '').trim().slice(0, 100);
    const where = [];
    const args = [];
    if (scope === 'mine') {
      requireUser(user);
      where.push('s.id IN (SELECT story_id FROM story_members WHERE user_id = ?)');
      args.push(user.id);
    } else {
      where.push("s.visibility = 'public'");
    }
    if (q) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR s.summary LIKE ? ESCAPE '\\' OR s.genre LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      args.push(like, like, like);
    }
    const rows = db.prepare(`${STORY_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.updated_at DESC, s.id DESC LIMIT 100`).all(...args);
    return { data: { stories: rows.map(toStory) } };
  });

  route('POST', '/api/stories', ({ user, body }) => {
    requireUser(user);
    const title = str(body.title, 'Title', { min: 1, max: 120, required: true });
    const summary = str(body.summary, 'Summary', { max: 5000 }) ?? '';
    const genre = str(body.genre, 'Genre', { max: 60 }) ?? '';
    const rating = oneOf(body.rating, 'Rating', ['G', 'T', 'M']) ?? 'T';
    const visibility = oneOf(body.visibility, 'Visibility', ['public', 'private']) ?? 'public';
    let storyId;
    db.exec('BEGIN');
    try {
      storyId = Number(db.prepare('INSERT INTO stories (owner_id, title, summary, genre, rating, visibility, invite_code) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, title, summary, genre, rating, visibility, inviteCode()).lastInsertRowid);
      db.prepare("INSERT INTO story_members (story_id, user_id, role) VALUES (?, ?, 'owner')").run(storyId, user.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { status: 201, data: { story: toStory(db.prepare(`${STORY_SELECT} WHERE s.id = ?`).get(storyId)) } };
  });

  route('GET', '/api/stories/:id', ({ user, params }) => {
    const { row, role } = readableStory(params.id, user);
    const members = db.prepare(`
      SELECT u.id, u.username, u.display_name, m.role FROM story_members m JOIN users u ON u.id = m.user_id
      WHERE m.story_id = ? ORDER BY m.joined_at`).all(row.id)
      .map((m) => ({ id: m.id, username: m.username, displayName: m.display_name, role: m.role }));
    const cast = db.prepare(`
      SELECT DISTINCT c.* FROM posts p JOIN characters c ON c.id = p.character_id
      WHERE p.story_id = ? ORDER BY c.name COLLATE NOCASE`).all(row.id).map(toCharacter);
    const story = toStory(row);
    if (role === 'owner') story.inviteCode = row.invite_code;
    return { data: { story, role, members, cast } };
  });

  route('PUT', '/api/stories/:id', ({ user, body, params }) => {
    requireUser(user);
    const { row, role } = readableStory(params.id, user);
    if (role !== 'owner') fail(403, 'Only the story owner can change settings');
    const title = str(body.title, 'Title', { min: 1, max: 120 }) ?? row.title;
    const summary = str(body.summary, 'Summary', { max: 5000 }) ?? row.summary;
    const genre = str(body.genre, 'Genre', { max: 60 }) ?? row.genre;
    const rating = oneOf(body.rating, 'Rating', ['G', 'T', 'M']) ?? row.rating;
    const visibility = oneOf(body.visibility, 'Visibility', ['public', 'private']) ?? row.visibility;
    const status = oneOf(body.status, 'Status', ['open', 'closed']) ?? row.status;
    const code = body.regenerateInvite ? inviteCode() : row.invite_code;
    db.prepare(`UPDATE stories SET title = ?, summary = ?, genre = ?, rating = ?, visibility = ?, status = ?, invite_code = ?,
      updated_at = datetime('now') WHERE id = ?`).run(title, summary, genre, rating, visibility, status, code, row.id);
    const story = toStory(db.prepare(`${STORY_SELECT} WHERE s.id = ?`).get(row.id));
    story.inviteCode = code;
    return { data: { story } };
  });

  route('DELETE', '/api/stories/:id', ({ user, params }) => {
    requireUser(user);
    const { row, role } = readableStory(params.id, user);
    if (role !== 'owner') fail(403, 'Only the story owner can delete it');
    db.prepare('DELETE FROM stories WHERE id = ?').run(row.id);
    return { data: { ok: true } };
  });

  route('POST', '/api/stories/:id/join', ({ user, body, params }) => {
    requireUser(user);
    const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(params.id);
    if (!row) fail(404, 'Story not found');
    if (membership(row.id, user.id)) return { data: { ok: true } };
    const codeMatches = typeof body.inviteCode === 'string' && body.inviteCode === row.invite_code;
    if (row.visibility === 'private' && !codeMatches) fail(404, 'Story not found');
    if (row.status === 'closed' && !codeMatches) fail(403, 'This story is closed to new writers');
    db.prepare('INSERT INTO story_members (story_id, user_id) VALUES (?, ?)').run(row.id, user.id);
    return { data: { ok: true } };
  });

  route('POST', '/api/stories/:id/leave', ({ user, params }) => {
    requireUser(user);
    const role = membership(params.id, user.id);
    if (!role) fail(400, 'You are not in this story');
    if (role === 'owner') fail(400, 'The owner cannot leave their own story');
    db.prepare('DELETE FROM story_members WHERE story_id = ? AND user_id = ?').run(params.id, user.id);
    return { data: { ok: true } };
  });

  // ---------- Posts ----------
  route('GET', '/api/stories/:id/posts', ({ user, params, query }) => {
    const { row } = readableStory(params.id, user);
    const after = Number(query.get('after')) || 0;
    const rows = db.prepare(`${POST_SELECT} WHERE p.story_id = ? AND p.id > ? ORDER BY p.id LIMIT 500`).all(row.id, after);
    return { data: { posts: rows.map(toPost) } };
  });

  route('POST', '/api/stories/:id/posts', ({ user, body, params }) => {
    requireUser(user);
    const { row, role } = readableStory(params.id, user);
    if (!role) fail(403, 'Join the story to write in it');
    const kind = oneOf(body.kind, 'Kind', ['ic', 'ooc', 'narration']) ?? 'ic';
    const text = str(body.body, 'Post', { min: 1, max: MAX_POST_CHARS, required: true });
    let characterId = null;
    if (kind === 'ic') {
      if (body.characterId == null) fail(400, 'Pick a character to write in-character');
      characterId = ownCharacter(body.characterId, user.id).id;
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO posts (story_id, user_id, character_id, kind, body, word_count) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, user.id, characterId, kind, text, countWords(text));
    db.prepare("UPDATE stories SET updated_at = datetime('now') WHERE id = ?").run(row.id);
    const post = toPost(db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(lastInsertRowid));
    broadcast(row.id, 'post', post);
    return { status: 201, data: { post } };
  });

  route('PUT', '/api/posts/:id', ({ user, body, params }) => {
    requireUser(user);
    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(params.id);
    if (!existing || existing.user_id !== user.id) fail(404, 'Post not found');
    const text = str(body.body, 'Post', { min: 1, max: MAX_POST_CHARS, required: true });
    db.prepare("UPDATE posts SET body = ?, word_count = ?, edited_at = datetime('now') WHERE id = ?").run(text, countWords(text), existing.id);
    const post = toPost(db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(existing.id));
    broadcast(existing.story_id, 'edit', post);
    return { data: { post } };
  });

  route('DELETE', '/api/posts/:id', ({ user, params }) => {
    requireUser(user);
    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(params.id);
    if (!existing) fail(404, 'Post not found');
    const isOwner = membership(existing.story_id, user.id) === 'owner';
    if (existing.user_id !== user.id && !isOwner) fail(404, 'Post not found');
    db.prepare('DELETE FROM posts WHERE id = ?').run(existing.id);
    broadcast(existing.story_id, 'delete', { id: existing.id });
    return { data: { ok: true } };
  });

  // ---------- Live updates (Server-Sent Events) ----------
  function handleEvents(req, res, user, storyId) {
    readableStory(storyId, user);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...SECURITY_HEADERS,
    });
    res.write(': connected\n\n');
    if (!listeners.has(storyId)) listeners.set(storyId, new Set());
    const subs = listeners.get(storyId);
    subs.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      subs.delete(res);
      if (!subs.size) listeners.delete(storyId);
    });
  }

  // ---------- Static files ----------
  async function serveStatic(pathname, res) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !extname(rel)) rel = '/index.html'; // SPA fallback
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) fail(404, 'Not found');
    try {
      const info = await stat(file);
      if (!info.isFile()) fail(404, 'Not found');
    } catch {
      fail(404, 'Not found');
    }
    const ext = extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ...SECURITY_HEADERS };
    headers['Cache-Control'] = ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, headers);
    res.end(await readFile(file));
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) fail(413, 'Request too large');
      chunks.push(chunk);
    }
    if (!size) return {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fail(400, 'Expected a JSON object');
    } catch (err) {
      if (err instanceof HttpError) throw err;
      fail(400, 'Invalid JSON');
    }
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

      const events = url.pathname.match(/^\/api\/stories\/(\d+)\/events$/);
      if (events && req.method === 'GET') return handleEvents(req, res, user, Number(events[1]));

      let match;
      const r = routes.find((rt) => rt.method === req.method && (match = url.pathname.match(rt.regex)));
      if (!r) fail(404, 'Not found');

      // POST/PUT must be JSON, which browsers won't send cross-site without a CORS preflight.
      // (Plain forms can't send DELETE at all, so it needs no body.)
      if ((req.method === 'POST' || req.method === 'PUT') && !(req.headers['content-type'] || '').startsWith('application/json')) {
        fail(415, 'Expected application/json');
      }

      const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(match[i + 1])]));
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      const cookies = [];
      const result = await r.handler({
        user, token, body, params, query: url.searchParams, ip: req.socket.remoteAddress,
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
  return server;
}
