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
    profile: parseProfile(row.profile),
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
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}
