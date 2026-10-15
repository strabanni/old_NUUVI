import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { parseProfile } from './profile.js';

const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'nuuvi_session';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return { token, maxAge: SESSION_DAYS * 24 * 60 * 60 };
}

export function userForToken(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.*, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now() || row.banned_at) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return toSelf(row);
}

// The signed-in user's own view of their account.
export function toSelf(row) {
  return {
    id: row.id, username: row.username, displayName: row.display_name, bio: row.bio,
    avatar: row.avatar, banner: row.banner ?? null, isAdmin: !!row.is_admin,
    profile: parseProfile(row.profile), gradient: row.gradient ? row.gradient.split(',') : null,
    showAbout: row.show_about !== 0, usernameChangedAt: row.username_changed_at ?? null,
  };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAge, secure) {
  const attrs = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

// Simple fixed-window limiter for login/register attempts, keyed by IP.
export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  const limiter = (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 50000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
  // Whether `key` is over the limit right now, without counting a try.
  limiter.blocked = (key) => { const e = hits.get(key); return !!e && e.reset >= Date.now() && e.count >= limit; };
  return limiter;
}

// Passwords so common they're the first ones anyone guesses (and that phones warn about).
const COMMON = new Set(['password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789', '1234567890', '11111111',
  '00000000', '87654321', 'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'iloveyou1', 'sunshine', 'princess', 'football', 'baseball',
  'welcome1', 'abc12345', 'abcd1234', 'letmein1', 'trustno1', 'superman', 'starwars', 'whatever', 'dragon12', 'monkey12', 'charlie1',
  'aa123456', 'asdfghjk', 'asdf1234', 'zaq12wsx', '1q2w3e4r', '1qaz2wsx', 'qazwsxedc', 'michelle', 'jennifer', 'computer', 'internet',
  'liverpool', 'chocolate', 'blink182', 'butterfly', 'babygirl', 'lovelove', 'loveyou1', 'nuuvi123', 'nuuvinuuvi', 'roleplay', 'roleplay1']);
export function weakPassword(password, username = '') {
  const p = password.toLowerCase();
  if (COMMON.has(p)) return true;
  if (/^(.)\1+$/.test(p)) return true; // aaaaaaaa
  if (username && p.includes(String(username).toLowerCase()) && p.length < username.length + 4) return true;
  return false;
}
