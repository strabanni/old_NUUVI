// Accounts, profiles, blocking, uploads, notifications and push subscriptions.
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, str, id, color, oneOf } from '../http.js';
import { hashPassword, verifyPassword, createSession, destroySession, toSelf } from '../auth.js';
import { toUser, toCharacter, requireUser, uploadRef, gradientInput, CHARACTER_STATUSES } from '../model.js';
import { validateSubscription } from '../push.js';
import { profileInput, detailsInput, parseProfile } from '../profile.js';
import { transaction, makeHandle } from '../db.js';
import { validUsername, validDisplayName, nameKey, validHandle } from '../names.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HEADERS_DIR = fileURLToPath(new URL('../../public/headers/', import.meta.url));

const MB = 1024 * 1024;
const MAX_UPLOAD_BYTES = 60 * MB;
const ftyp = (b) => b.subarray(4, 8).toString('latin1') === 'ftyp';
const ebml = (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
// Accepted uploads: type → extension, a check of the file's first bytes, and a size limit.
const MEDIA_TYPES = {
  'image/png': { ext: 'png', max: 8 * MB, magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', max: 8 * MB, magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { ext: 'gif', max: 15 * MB, magic: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  'image/webp': { ext: 'webp', max: 8 * MB, magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  'video/mp4': { ext: 'mp4', max: 60 * MB, magic: ftyp },
  'video/quicktime': { ext: 'mov', max: 60 * MB, magic: ftyp },
  'video/webm': { ext: 'webm', max: 60 * MB, magic: ebml },
  'audio/mp4': { ext: 'm4a', max: 20 * MB, magic: ftyp },
  'audio/x-m4a': { ext: 'm4a', max: 20 * MB, magic: ftyp },
  'audio/webm': { ext: 'weba', max: 20 * MB, magic: ebml },
  'audio/ogg': { ext: 'ogg', max: 20 * MB, magic: (b) => b.subarray(0, 4).toString('latin1') === 'OggS' },
  'audio/mpeg': { ext: 'mp3', max: 20 * MB, magic: (b) => b.subarray(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  'audio/wav': { ext: 'wav', max: 20 * MB, magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE' },
};
MEDIA_TYPES['audio/x-wav'] = MEDIA_TYPES['audio/wav'];

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

const USERNAME_COOLDOWN = 3 * 60 * 60 * 1000; // 3 hours between username changes

export function accountRoutes(r, ctx) {
  const { db, config, authLimiter } = ctx;

  // Exact match first (fast, case-insensitive for plain letters), then the same name in any
  // case or look-alike form, so "Rosé" and "ROSÉ" are one account.
  const findByUsername = (name) => {
    if (!name) return null;
    const exact = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
    if (exact) return exact;
    const key = nameKey(name);
    const hit = db.prepare('SELECT id, username FROM users').all().find((u) => nameKey(u.username) === key);
    return hit ? db.prepare('SELECT * FROM users WHERE id = ?').get(hit.id) : null;
  };

  r.get('/api/auth/status', () => {
    const firstUser = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    return { data: { firstUser, inviteRequired: !firstUser && !config.openRegistration } };
  });

  r.post('/api/auth/register', ({ body, ip, setSession }) => {
    if (!authLimiter(ip)) fail(429, 'Too many attempts, try again later');
    const username = validUsername(body.username);
    const password = validPassword(body.password);
    const displayName = validDisplayName(str(body.displayName, 'Display name', { max: 40 })) || username;

    const user = transaction(db, () => {
      const firstUser = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
      let invite = null;
      if (!firstUser && !config.openRegistration) {
        invite = inviteRow(db, body.invite);
        if (!invite) fail(403, 'You need a valid invite code to join');
      }
      if (findByUsername(username)) fail(409, 'That username is taken');
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
    const row = typeof body.username === 'string' ? findByUsername(body.username.normalize('NFC').trim()) : null;
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

  // Who's online right now (for the live indicator).
  // A tab reports whether it's visible, so pop-up notifications go only where the person isn't looking.
  r.post('/api/live/visible', ({ user, body }) => {
    requireUser(user);
    ctx.hub.setVisible(user.id, String(body.tab || '').slice(0, 40), !!body.visible);
    return { data: { ok: true } };
  });

  // Rotating header pictures for the main pages (set by admins).
  r.get('/api/headers', ({ user }) => {
    requireUser(user);
    const row = db.prepare("SELECT value FROM settings WHERE key = 'headers'").get();
    // Until an admin picks some, use any pictures that ship in public/headers/.
    const bundled = () => { try { return readdirSync(HEADERS_DIR).filter((f) => /\.(?:jpg|jpeg|png|webp)$/i.test(f)).sort().map((f) => `/headers/${f}`); } catch { return []; } };
    return { data: { headers: row ? JSON.parse(row.value) : bundled() } };
  });
  r.put('/api/headers', ({ user, body }) => {
    requireUser(user);
    if (!user.isAdmin) fail(403, 'Only admins can change the headers');
    if (!Array.isArray(body.headers) || body.headers.length > 30) fail(400, 'At most 30 header pictures');
    // Uploads, picture links, or pictures that ship with NUUVI (public/headers/).
    const headers = body.headers.map((h) => (typeof h === 'string' && /^\/headers\/[\w.-]+\.(?:jpg|jpeg|png|webp)$/.test(h) ? h
      : uploadRef(db, h, user.id) ?? fail(400, 'Picture missing')));
    db.prepare("INSERT INTO settings (key, value) VALUES ('headers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(headers));
    return { data: { headers } };
  });

  r.get('/api/online', ({ user }) => {
    requireUser(user);
    const ids = ctx.hub.online();
    const rows = ids.length ? db.prepare(`SELECT * FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
    return { data: { users: rows.map((u) => toUser(u)) } };
  });

  r.put('/api/me', ({ user, body }) => {
    requireUser(user);
    const displayName = validDisplayName(str(body.displayName, 'Display name', { min: 1, max: 40 })) ?? user.displayName;
    const bio = str(body.bio, 'Bio', { max: 2000 }) ?? user.bio;
    const avatar = uploadRef(db, body.avatar, user.id);
    const banner = uploadRef(db, body.banner, user.id);
    const profile = profileInput(body.profile, user.profile);
    const gradient = gradientInput(body.gradient);
    const row = db.prepare('SELECT show_about, username_changed_at FROM users WHERE id = ?').get(user.id);
    const showAbout = body.showAbout === undefined ? row.show_about : body.showAbout ? 1 : 0;
    // A new username: free to pick, but only once every 3 hours (so nobody can hop between names).
    let username = user.username;
    let changedAt = row.username_changed_at;
    if (body.username !== undefined && body.username !== user.username) {
      const next = validUsername(body.username);
      if (next !== user.username) {
        const since = changedAt ? Date.now() - new Date(`${changedAt.replace(' ', 'T')}Z`).getTime() : Infinity;
        if (since < USERNAME_COOLDOWN) {
          const mins = Math.ceil((USERNAME_COOLDOWN - since) / 60000);
          fail(429, `You can change your username again in ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}`);
        }
        const taken = findByUsername(next);
        if (taken && taken.id !== user.id) fail(409, 'That username is taken');
        username = next;
        changedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
      }
    }
    db.prepare(`UPDATE users SET display_name = ?, bio = ?, avatar = ?, banner = ?, profile = ?, gradient = ?, show_about = ?,
      username = ?, username_changed_at = ? WHERE id = ?`)
      .run(displayName, bio, avatar === undefined ? user.avatar : avatar, banner === undefined ? user.banner : banner,
        JSON.stringify(profile ?? user.profile), gradient === undefined ? user.gradient?.join(',') ?? null : gradient, showAbout,
        username, changedAt, user.id);
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
          ...toUser(row), bio: row.show_about === 0 && row.id !== user?.id ? '' : row.bio, banner: row.banner, profile: parseProfile(row.profile),
          showAbout: row.show_about !== 0,
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
    const type = MEDIA_TYPES[(headers['content-type'] || '').split(';')[0].trim().toLowerCase()];
    if (!type) fail(415, 'Use a PNG, JPEG, GIF or WebP image, an MP4/MOV/WebM video, or an M4A/MP3/WebM/OGG/WAV audio file');
    if (rawBody && rawBody.length > type.max) fail(413, `That file is too large (max ${type.max / MB} MB)`);
    if (!rawBody?.length) fail(400, 'Empty upload');
    if (!type.magic(rawBody)) fail(400, "That file doesn't look like the image type it claims to be");
    const count = db.prepare('SELECT COUNT(*) AS n FROM uploads WHERE user_id = ?').get(user.id).n;
    if (count >= 2000) fail(400, 'Upload limit reached');
    const used = db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM uploads WHERE user_id = ?').get(user.id).n;
    if (used + rawBody.length > 2048 * MB) fail(400, 'You have used all of your 2 GB of storage');
    const name = `${randomBytes(16).toString('base64url')}.${type.ext}`;
    await writeFile(join(config.uploadDir, name), rawBody, { flag: 'wx' });
    db.prepare('INSERT INTO uploads (name, user_id, size) VALUES (?, ?, ?)').run(name, user.id, rawBody.length);
    return { status: 201, data: { url: `/uploads/${name}` } };
  }, { raw: MAX_UPLOAD_BYTES });

  // Your own recent pictures, newest first, for the picture panel behind every + button.
  r.get('/api/uploads/recent', ({ user }) => {
    requireUser(user);
    const rows = db.prepare(`SELECT name FROM uploads WHERE user_id = ?
      AND (name LIKE '%.png' OR name LIKE '%.jpg' OR name LIKE '%.webp' OR name LIKE '%.gif')
      ORDER BY created_at DESC, rowid DESC LIMIT 60`).all(user.id);
    return { data: { pictures: rows.map((r) => `/uploads/${r.name}`) } };
  });

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
    // Your own characters include their NPC lines (for the editor).
    return { data: { characters: rows.map((c) => ({ ...toCharacter(c), followers: c.followers, botLines: JSON.parse(c.bot_lines || '{}') })) } };
  });

  // Directory: every writer (by username) and every character in their cast.
  // Suspended accounts and people on either side of a block are left out.
  // Everyone's NPCs, shared so anyone can find and tag them. Filter by category tag or search.
  r.get('/api/npcs', ({ user }) => {
    requireUser(user);
    const hidden = new Set(db.prepare('SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?')
      .all(user.id, user.id).map((r) => r.id));
    const rows = db.prepare(`SELECT c.*, u.username AS owner_username, u.display_name AS owner_name FROM characters c JOIN users u ON u.id = c.user_id
      WHERE c.npc = 1 AND (c.bot IS NULL OR c.bot != 'gossip') AND u.banned_at IS NULL ORDER BY c.name COLLATE NOCASE`).all()
      .filter((c) => !hidden.has(c.user_id));
    const tags = [...new Set(rows.flatMap((c) => (c.npc_tags ? c.npc_tags.split(',') : [])))].sort();
    return { data: { npcs: rows.map((c) => ({ ...toCharacter(c), owner: { id: c.user_id, username: c.owner_username, displayName: c.owner_name } })), tags } };
  });

  r.get('/api/directory', ({ user }) => {
    requireUser(user);
    const hidden = new Set(db.prepare('SELECT blocked_id AS id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?')
      .all(user.id, user.id).map((r) => r.id));
    const users = db.prepare('SELECT * FROM users WHERE banned_at IS NULL ORDER BY username COLLATE NOCASE').all().filter((u) => !hidden.has(u.id));
    const chars = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM character_follows f WHERE f.followed_id = c.id) AS followers
      FROM characters c ORDER BY c.name COLLATE NOCASE`).all();
    const byUser = new Map(users.map((u) => [u.id, []]));
    const anonymous = [];
    // The gossip account is listed on its own, never under whoever runs it.
    for (const c of chars) (c.bot === 'gossip' ? anonymous : byUser.get(c.user_id))?.push({ ...toCharacter(c), followers: c.followers });
    return {
      data: {
        writers: users.map((u) => ({
          id: u.id, username: u.username, displayName: u.display_name, avatar: u.avatar ?? null,
          gradient: u.gradient ? u.gradient.split(',') : null, isAdmin: !!u.is_admin, joinedAt: u.created_at, characters: byUser.get(u.id),
        })),
        anonymous,
      },
    };
  });

  // Count overrides: "" or null clears, otherwise a whole number (celebrities can have 2,400,000 followers).
  const countInput = (v, field) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const n = Number(String(v).replace(/[,\s]/g, ''));
    if (!Number.isSafeInteger(n) || n < 0 || n > 9_999_999_999) fail(400, `${field} must be a whole number`);
    return n;
  };

  // Styling and profile extras, applied after insert/update.
  // Lines an automatic NPC picks from: up to 200 per list, each up to 500 characters.
  function botLinesInput(v) {
    if (!v || typeof v !== 'object') fail(400, 'NPC lines must be lists');
    const out = {};
    for (const key of ['comments', 'posts', 'tips', 'finished']) {
      if (v[key] === undefined) continue;
      if (!Array.isArray(v[key]) || v[key].length > 200) fail(400, 'At most 200 lines per list');
      out[key] = v[key].map((l) => String(l).trim().slice(0, 500)).filter(Boolean);
    }
    return out;
  }

  function applyExtras(characterId, userId, body, existing = {}, isAdmin = false) {
    const aka = str(body.aka, 'AKA line', { max: 200 }) ?? existing.aka ?? '';
    const align = oneOf(body.postAlign, 'Name position', ['left', 'right']) ?? existing.post_align ?? 'right';
    const followers = countInput(body.followersDisplay, 'Followers');
    const following = countInput(body.followingDisplay, 'Following');
    const verified = body.verified === undefined ? existing.verified ?? 0 : body.verified ? 1 : 0;
    const banner = uploadRef(db, body.banner, userId);
    // The picture on their thread posts (empty: their avatar is used).
    const threadAvatar = uploadRef(db, body.threadAvatar, userId);
    if (threadAvatar !== undefined) db.prepare('UPDATE characters SET thread_avatar = ? WHERE id = ?').run(threadAvatar, characterId);
    // Deceased / missing in action (empty: playable again).
    if (body.status !== undefined) {
      const status = body.status ? oneOf(body.status, 'Status', CHARACTER_STATUSES) : null;
      db.prepare('UPDATE characters SET status = ? WHERE id = ?').run(status, characterId);
    }
    let handle;
    if (body.handle !== undefined && body.handle !== null && body.handle !== '') {
      handle = validHandle(body.handle);
      if (db.prepare('SELECT 1 FROM characters WHERE handle = ? COLLATE NOCASE AND id != ?').get(handle, characterId)) fail(409, `@${handle} is taken`);
    } else if (!existing.handle) {
      handle = makeHandle(db, body.name ?? existing.name ?? 'character', characterId);
    }
    const npc = body.npc === undefined ? existing.npc ?? 0 : body.npc ? 1 : 0;
    // Automatic NPCs post/comment on their own; the anonymous gossip account is admin-only.
    let bot = existing.bot ?? null;
    if (body.bot !== undefined) {
      // No choice (null / '') means a normal member of your cast: no automation.
      bot = body.bot ? oneOf(body.bot, 'Automation', ['bot', 'gossip']) : null;
      if (bot === 'gossip' && !isAdmin) fail(403, 'Only admins can run the gossip account');
      if (bot === 'bot' && !npc) fail(400, 'Only NPCs can post on their own');
    }
    const lines = body.botLines === undefined ? existing.bot_lines ?? '{}' : JSON.stringify(botLinesInput(body.botLines));
    // A gradient color: 2–3 hex stops, e.g. "#EE719E,#B8A6DB". Empty clears it.
    const g = gradientInput(body.gradient);
    const gradient = g === undefined ? existing.gradient ?? null : g;
    let npcTags = existing.npc_tags ?? '';
    if (body.npcTags !== undefined) {
      const list = Array.isArray(body.npcTags) ? body.npcTags : String(body.npcTags || '').split(',');
      npcTags = [...new Set(list.map((t) => String(t).trim().toLowerCase().replace(/^#/, '').slice(0, 30)).filter(Boolean))].slice(0, 12).join(',');
    }
    db.prepare('UPDATE characters SET gradient = ?, npc_tags = ? WHERE id = ?').run(gradient, npcTags, characterId);
    db.prepare('UPDATE characters SET handle = COALESCE(?, handle), npc = ?, bot = ?, bot_lines = ? WHERE id = ?')
      .run(handle ?? null, npc, bot, lines, characterId);
    db.prepare('UPDATE characters SET aka = ?, post_align = ?, followers_display = ?, following_display = ?, verified = ?, banner = ? WHERE id = ?')
      .run(aka, align, followers === undefined ? existing.followers_display ?? null : followers,
        following === undefined ? existing.following_display ?? null : following, verified,
        banner === undefined ? existing.banner ?? null : banner, characterId);
  }

  const characterFields = (body, existing = {}) => ({
    name: str(body.name, 'Name', { min: 1, max: 60, required: !existing.name }) ?? existing.name,
    tagline: str(body.tagline, 'Tagline', { max: 140 }) ?? existing.tagline ?? '',
    bio: str(body.bio, 'Bio', { max: 20000 }) ?? existing.bio ?? '',
    color: color(body.color) ?? existing.color ?? '#EE719E',
  });

  r.post('/api/characters', ({ user, body }) => {
    requireUser(user);
    const count = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id = ?').get(user.id).n;
    if (count >= 200) fail(400, 'You can have at most 200 characters');
    const f = characterFields(body);
    const avatar = uploadRef(db, body.avatar, user.id) ?? null;
    const portrait = uploadRef(db, body.portrait, user.id) ?? null;
    const details = JSON.stringify(detailsInput(body.details) ?? []);
    // One transaction, so a taken @username doesn't leave a half-made character behind.
    const lastInsertRowid = transaction(db, () => {
      const row = db.prepare('INSERT INTO characters (user_id, name, tagline, bio, color, avatar, portrait, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(user.id, f.name, f.tagline, f.bio, f.color, avatar, portrait, details);
      applyExtras(Number(row.lastInsertRowid), user.id, body, { name: f.name }, user.isAdmin);
      return row.lastInsertRowid;
    });
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
    transaction(db, () => {
      db.prepare('UPDATE characters SET name = ?, tagline = ?, bio = ?, color = ?, avatar = ?, portrait = ?, details = ? WHERE id = ?')
        .run(f.name, f.tagline, f.bio, f.color, avatar === undefined ? existing.avatar : avatar,
          portrait === undefined ? existing.portrait : portrait, details === undefined ? existing.details : JSON.stringify(details), existing.id);
      applyExtras(existing.id, user.id, body, existing, user.isAdmin);
    });
    return { data: { character: toCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(existing.id)) } };
  });

  r.delete('/api/characters/:id', ({ user, params }) => {
    requireUser(user);
    const { changes } = db.prepare('DELETE FROM characters WHERE id = ? AND user_id = ?').run(params.id, user.id);
    if (!changes) fail(404, 'Character not found');
    return { data: { ok: true } };
  });
}
