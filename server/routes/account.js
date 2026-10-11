// Accounts, profiles, blocking, uploads, notifications and push subscriptions.
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, str, id, color } from '../http.js';
import { hashPassword, verifyPassword, createSession, destroySession, toSelf } from '../auth.js';
import { toUser, toCharacter, requireUser, uploadRef } from '../model.js';
import { validateSubscription } from '../push.js';
import { profileInput, detailsInput, parseProfile } from '../profile.js';
import { transaction } from '../db.js';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', magic: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
};

function validPassword(password) {
  if (typeof password !== 'string' || password.length < 8) fail(400, 'Password must be at least 8 characters');
  if (password.length > 200) fail(400, 'Password is too long');
  return password;
}

function inviteRow(db, code) {
  if (typeof code !== 'string' || !code.trim()) return null;
  const row = db.prepare('SELECT * FROM site_invites WHERE code = ?').get(code.trim());
  if (!row || row.revoked || row.uses >= row.max_uses || (row.expires_at && row.expires_at < Date.now())) return null;
  return row;
}

export function accountRoutes(r, ctx) {
  const { db, config, authLimiter } = ctx;

  r.get('/api/auth/status', () => {
    const firstUser = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    return { data: { firstUser, inviteRequired: !firstUser && !config.openRegistration } };
  });

  r.post('/api/auth/register', ({ body, ip, setSession }) => {
    if (!authLimiter(ip)) fail(429, 'Too many attempts, try again later');
    const username = str(body.username, 'Username', { min: 3, max: 24, required: true });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) fail(400, 'Username may only use letters, numbers and _');
    const password = validPassword(body.password);
    const displayName = str(body.displayName, 'Display name', { max: 40 }) || username;

    const user = transaction(db, () => {
      const firstUser = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
      let invite = null;
      if (!firstUser && !config.openRegistration) {
        invite = inviteRow(db, body.invite);
        if (!invite) fail(403, 'You need a valid invite code to join');
      }
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is taken');
      const { lastInsertRowid } = db.prepare('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?, ?, ?, ?)')
        .run(username, displayName, hashPassword(password), firstUser ? 1 : 0);
      if (invite) db.prepare('UPDATE site_invites SET uses = uses + 1 WHERE id = ?').run(invite.id);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    });
    setSession(createSession(db, user.id));
    return { status: 201, data: { user: toSelf(user) } };
  });

  r.post('/api/auth/login', ({ body, ip, setSession }) => {
    if (!authLimiter(ip)) fail(429, 'Too many attempts, try again later');
    const row = typeof body.username === 'string'
      ? db.prepare('SELECT * FROM users WHERE username = ?').get(body.username.trim())
      : null;
    if (!row || typeof body.password !== 'string' || !verifyPassword(body.password, row.password_hash)) {
      fail(401, 'Wrong username or password');
    }
    if (row.banned_at) fail(403, 'This account is suspended');
    setSession(createSession(db, row.id));
    return { data: { user: toSelf(row) } };
  });

  r.post('/api/auth/logout', ({ token, clearSession }) => {
    destroySession(db, token);
    clearSession();
    return { data: { ok: true } };
  });

  r.post('/api/auth/reset', ({ body, ip, setSession }) => {
    if (!authLimiter(ip)) fail(429, 'Too many attempts, try again later');
    const reset = typeof body.token === 'string'
      ? db.prepare('SELECT * FROM password_resets WHERE token = ?').get(body.token)
      : null;
    if (!reset || reset.expires_at < Date.now()) fail(400, 'This reset link is invalid or expired');
    const password = validPassword(body.password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), reset.user_id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(reset.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(reset.user_id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(reset.user_id);
    if (user.banned_at) fail(403, 'This account is suspended');
    setSession(createSession(db, user.id));
    return { data: { user: toSelf(user) } };
  });

  r.get('/api/me', ({ user }) => ({ data: { user } }));

  r.put('/api/me', ({ user, body }) => {
    requireUser(user);
    const displayName = str(body.displayName, 'Display name', { min: 1, max: 40 }) ?? user.displayName;
    const bio = str(body.bio, 'Bio', { max: 2000 }) ?? user.bio;
    const avatar = uploadRef(db, body.avatar, user.id);
    const banner = uploadRef(db, body.banner, user.id);
    const profile = profileInput(body.profile, user.profile);
    db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar = ?, banner = ?, profile = ? WHERE id = ?')
      .run(displayName, bio, avatar === undefined ? user.avatar : avatar, banner === undefined ? user.banner : banner,
        JSON.stringify(profile ?? user.profile), user.id);
    return { data: { user: toSelf(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) } };
  });

  r.put('/api/me/password', ({ user, body, token }) => {
    requireUser(user);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (typeof body.current !== 'string' || !verifyPassword(body.current, row.password_hash)) fail(400, 'Current password is wrong');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(validPassword(body.next)), user.id);
    // Sign out every other device.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, token);
    return { data: { ok: true } };
  });

  // ---------- Profiles ----------
  r.get('/api/users/:id', ({ user, params }) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    if (!row) fail(404, 'User not found');
    const characters = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(row.id).map(toCharacter);
    const blocked = user ? !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(user.id, row.id) : false;
    return {
      data: {
        user: {
          ...toUser(row), bio: row.bio, banner: row.banner, profile: parseProfile(row.profile),
          isAdmin: !!row.is_admin, suspended: !!row.banned_at, joinedAt: row.created_at,
        },
        stats: ctx.userStats(row.id),
        characters,
        blocked,
      },
    };
  });

  // ---------- Blocking ----------
  r.get('/api/blocks', ({ user }) => {
    requireUser(user);
    const rows = db.prepare('SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC').all(user.id);
    return { data: { users: rows.map((u) => toUser(u)) } };
  });

  r.post('/api/blocks', ({ user, body }) => {
    requireUser(user);
    const target = id(body.userId, 'User');
    if (target === user.id) fail(400, "You can't block yourself");
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(target)) fail(404, 'User not found');
    db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)').run(user.id, target);
    return { data: { ok: true } };
  });

  r.delete('/api/blocks/:id', ({ user, params }) => {
    requireUser(user);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(user.id, params.id);
    return { data: { ok: true } };
  });

  // ---------- Image uploads ----------
  r.post('/api/uploads', async ({ user, rawBody, headers }) => {
    requireUser(user);
    const type = IMAGE_TYPES[(headers['content-type'] || '').split(';')[0].trim()];
    if (!type) fail(415, 'Images must be PNG, JPEG, GIF or WebP');
    if (!rawBody?.length) fail(400, 'Empty upload');
    if (!type.magic(rawBody)) fail(400, "That file doesn't look like the image type it claims to be");
    const count = db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?').get(user.id).n;
    if (count >= 500) fail(400, 'Upload limit reached');
    const name = `${randomBytes(16).toString('base64url')}.${type.ext}`;
    await writeFile(join(config.uploadDir, name), rawBody, { flag: 'wx' });
    db.prepare('INSERT INTO uploads (name, user_id, size) VALUES (?, ?, ?)').run(name, user.id, rawBody.length);
    return { status: 201, data: { url: `/uploads/${name}` } };
  }, { raw: MAX_UPLOAD_BYTES });

  // ---------- Notifications ----------
  r.get('/api/notifications', ({ user, query }) => {
    requireUser(user);
    const before = Number(query.get('before')) || Number.MAX_SAFE_INTEGER;
    const rows = db.prepare(`
      SELECT n.*, a.username AS a_username, a.display_name AS a_display_name, a.avatar AS a_avatar, a.id AS a_id,
        s.title AS story_title, c.name AS channel_name
      FROM notifications n
      LEFT JOIN users a ON a.id = n.actor_id
      LEFT JOIN stories s ON s.id = n.story_id
      LEFT JOIN channels c ON c.id = n.channel_id
      WHERE n.user_id = ? AND n.id < ? ORDER BY n.id DESC LIMIT 50`).all(user.id, before);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
    return { data: { notifications: rows.map(ctx.toNotification), unread } };
  });

  r.post('/api/notifications/read', ({ user, body }) => {
    requireUser(user);
    if (Array.isArray(body.ids)) {
      const stmt = db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL");
      for (const n of body.ids.slice(0, 200)) stmt.run(id(n, 'Notification'), user.id);
    } else {
      db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(user.id);
    }
    return { data: { ok: true } };
  });

  // ---------- Push notifications ----------
  r.get('/api/push/key', () => ({ data: { publicKey: ctx.pusher.publicKey } }));

  r.post('/api/push/subscribe', ({ user, body }) => {
    requireUser(user);
    const sub = validateSubscription(body.subscription);
    if (!sub) fail(400, 'Invalid push subscription');
    db.prepare(`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(sub.endpoint, user.id, sub.p256dh, sub.auth);
    return { data: { ok: true } };
  });

  r.post('/api/push/unsubscribe', ({ user, body }) => {
    requireUser(user);
    if (typeof body.endpoint === 'string') {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(body.endpoint, user.id);
    }
    return { data: { ok: true } };
  });

  r.post('/api/push/test', ({ user }) => {
    requireUser(user);
    ctx.pusher.send(user.id, { title: 'NUUVI', body: 'Notifications are working!', url: '/#/' });
    return { data: { ok: true } };
  });

  // ---------- Characters ----------
  r.get('/api/characters', ({ user }) => {
    requireUser(user);
    const rows = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM character_follows f WHERE f.followed_id = c.id) AS followers
      FROM characters c WHERE c.user_id = ? ORDER BY c.name COLLATE NOCASE`).all(user.id);
    return { data: { characters: rows.map((c) => ({ ...toCharacter(c), followers: c.followers })) } };
  });

  const characterFields = (body, existing = {}) => ({
    name: str(body.name, 'Name', { min: 1, max: 60, required: !existing.name }) ?? existing.name,
    tagline: str(body.tagline, 'Tagline', { max: 140 }) ?? existing.tagline ?? '',
    bio: str(body.bio, 'Bio', { max: 20000 }) ?? existing.bio ?? '',
    color: color(body.color) ?? existing.color ?? '#F8769C',
  });

  r.post('/api/characters', ({ user, body }) => {
    requireUser(user);
    const count = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id = ?').get(user.id).n;
    if (count >= 200) fail(400, 'You can have at most 200 characters');
    const f = characterFields(body);
    const avatar = uploadRef(db, body.avatar, user.id) ?? null;
    const portrait = uploadRef(db, body.portrait, user.id) ?? null;
    const details = JSON.stringify(detailsInput(body.details) ?? []);
    const { lastInsertRowid } = db.prepare('INSERT INTO characters (user_id, name, tagline, bio, color, avatar, portrait, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(user.id, f.name, f.tagline, f.bio, f.color, avatar, portrait, details);
    return { status: 201, data: { character: toCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(lastInsertRowid)) } };
  });

  r.put('/api/characters/:id', ({ user, body, params }) => {
    requireUser(user);
    const existing = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(params.id, user.id);
    if (!existing) fail(404, 'Character not found');
    const f = characterFields(body, existing);
    const avatar = uploadRef(db, body.avatar, user.id);
    const portrait = uploadRef(db, body.portrait, user.id);
    const details = detailsInput(body.details);
    db.prepare('UPDATE characters SET name = ?, tagline = ?, bio = ?, color = ?, avatar = ?, portrait = ?, details = ? WHERE id = ?')
      .run(f.name, f.tagline, f.bio, f.color, avatar === undefined ? existing.avatar : avatar,
        portrait === undefined ? existing.portrait : portrait, details === undefined ? existing.details : JSON.stringify(details), existing.id);
    return { data: { character: toCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(existing.id)) } };
  });

  r.delete('/api/characters/:id', ({ user, params }) => {
    requireUser(user);
    const { changes } = db.prepare('DELETE FROM characters WHERE id = ? AND user_id = ?').run(params.id, user.id);
    if (!changes) fail(404, 'Character not found');
    return { data: { ok: true } };
  });
}
