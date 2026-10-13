// Site moderation for admin accounts: reports, users, invites, stories and the mod log.
import { randomBytes } from 'node:crypto';
import { fail, str, oneOf } from '../http.js';
import { toUser, requireAdmin, STORY_SELECT, toStory, adminCanSee } from '../model.js';

const DAY = 24 * 60 * 60 * 1000;

export function adminRoutes(r, ctx) {
  const { db, hub } = ctx;
  const log = ctx.modLog;
  const target = (userId) => db.prepare('SELECT * FROM users WHERE id = ?').get(userId) ?? fail(404, 'User not found');

  r.get('/api/admin/overview', ({ user }) => {
    requireAdmin(user);
    const n = (sql) => db.prepare(sql).get().n;
    return {
      data: {
        users: n('SELECT COUNT(*) AS n FROM users'),
        stories: n('SELECT COUNT(*) AS n FROM stories'),
        posts: n('SELECT COUNT(*) AS n FROM posts'),
        openReports: n("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
      },
    };
  });

  r.get('/api/admin/reports', ({ user, query }) => {
    requireAdmin(user);
    const status = oneOf(query.get('status') || 'open', 'Status', ['open', 'resolved', 'dismissed']);
    const rows = db.prepare(`
      SELECT r.*, rep.username AS rep_username, rep.display_name AS rep_display_name, rep.avatar AS rep_avatar, rep.id AS rep_id,
        t.username AS t_username, t.display_name AS t_display_name, t.avatar AS t_avatar, t.id AS t_id, t.banned_at AS t_banned,
        s.title AS story_title, p.channel_id AS channel_id, p.id AS live_post_id
      FROM reports r
      LEFT JOIN users rep ON rep.id = r.reporter_id
      LEFT JOIN users t ON t.id = r.target_user
      LEFT JOIN stories s ON s.id = r.story_id
      LEFT JOIN posts p ON p.id = r.post_id
      WHERE r.status = ? ORDER BY r.id DESC LIMIT 200`).all(status);
    return {
      data: {
        reports: rows.map((row) => ({
          id: row.id, reason: row.reason, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at,
          reporter: row.rep_id ? toUser(row, 'rep_') : null,
          target: row.t_id ? { ...toUser(row, 't_'), suspended: !!row.t_banned } : null,
          story: row.story_id ? { id: row.story_id, title: row.story_title } : null,
          post: row.post_id ? { id: row.post_id, stillExists: !!row.live_post_id, channelId: row.channel_id } : null,
          snapshot: row.snapshot ? JSON.parse(row.snapshot) : null,
        })),
      },
    };
  });

  r.post('/api/admin/reports/:id', ({ user, body, params }) => {
    requireAdmin(user);
    const status = oneOf(body.status, 'Status', ['open', 'resolved', 'dismissed']) ?? fail(400, 'Status is required');
    const { changes } = db.prepare(`UPDATE reports SET status = ?, resolved_by = ?, resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE datetime('now') END
      WHERE id = ?`).run(status, user.id, status, params.id);
    if (!changes) fail(404, 'Report not found');
    log(user.id, `report-${status}`, `report #${params.id}`);
    return { data: { ok: true } };
  });

  r.get('/api/admin/users', ({ user }) => {
    requireAdmin(user);
    const rows = db.prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS post_count
      FROM users u ORDER BY u.created_at DESC`).all();
    return {
      data: {
        users: rows.map((u) => ({
          ...toUser(u), isAdmin: !!u.is_admin, suspended: !!u.banned_at, banReason: u.ban_reason,
          joinedAt: u.created_at, postCount: u.post_count,
        })),
      },
    };
  });

  r.post('/api/admin/users/:id/ban', ({ user, body, params }) => {
    requireAdmin(user);
    const t = target(params.id);
    if (t.id === user.id) fail(400, "You can't suspend yourself");
    const reason = str(body.reason, 'Reason', { max: 500 }) ?? '';
    db.prepare("UPDATE users SET banned_at = datetime('now'), ban_reason = ? WHERE id = ?").run(reason, t.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(t.id);
    hub.disconnectUser(t.id);
    log(user.id, 'suspend', `@${t.username}${reason ? `: ${reason}` : ''}`);
    return { data: { ok: true } };
  });

  r.post('/api/admin/users/:id/unban', ({ user, params }) => {
    requireAdmin(user);
    const t = target(params.id);
    db.prepare('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?').run(t.id);
    log(user.id, 'unsuspend', `@${t.username}`);
    return { data: { ok: true } };
  });

  r.put('/api/admin/users/:id/role', ({ user, body, params }) => {
    requireAdmin(user);
    const t = target(params.id);
    if (t.id === user.id) fail(400, "You can't change your own admin status");
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(body.isAdmin ? 1 : 0, t.id);
    log(user.id, body.isAdmin ? 'make-admin' : 'remove-admin', `@${t.username}`);
    return { data: { ok: true } };
  });

  // Creates a one-time password reset link (there is no email, so the admin passes it on).
  r.post('/api/admin/users/:id/reset', ({ user, params }) => {
    requireAdmin(user);
    const t = target(params.id);
    const token = randomBytes(24).toString('base64url');
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(t.id);
    db.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, t.id, Date.now() + DAY);
    log(user.id, 'password-reset-link', `@${t.username}`);
    return { data: { token, expiresInHours: 24 } };
  });

  r.get('/api/admin/invites', ({ user }) => {
    requireAdmin(user);
    const rows = db.prepare(`SELECT i.*, u.display_name AS by_name FROM site_invites i LEFT JOIN users u ON u.id = i.created_by
      ORDER BY i.id DESC LIMIT 200`).all();
    return {
      data: {
        invites: rows.map((i) => ({
          id: i.id, code: i.code, note: i.note, maxUses: i.max_uses, uses: i.uses, revoked: !!i.revoked,
          expiresAt: i.expires_at, createdAt: i.created_at, createdBy: i.by_name,
          active: !i.revoked && i.uses < i.max_uses && (!i.expires_at || i.expires_at > Date.now()),
        })),
      },
    };
  });

  r.post('/api/admin/invites', ({ user, body }) => {
    requireAdmin(user);
    const note = str(body.note, 'Note', { max: 100 }) ?? '';
    const maxUses = Math.min(Math.max(Number(body.maxUses) || 1, 1), 100);
    const days = Number(body.expiresDays) || 0;
    const expiresAt = days > 0 ? Date.now() + Math.min(days, 365) * DAY : null;
    const code = randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO site_invites (code, created_by, note, max_uses, expires_at) VALUES (?, ?, ?, ?, ?)').run(code, user.id, note, maxUses, expiresAt);
    log(user.id, 'create-invite', note || code.slice(0, 4) + '…');
    return { status: 201, data: { code } };
  });

  r.delete('/api/admin/invites/:id', ({ user, params }) => {
    requireAdmin(user);
    db.prepare('UPDATE site_invites SET revoked = 1 WHERE id = ?').run(params.id);
    log(user.id, 'revoke-invite', `#${params.id}`);
    return { data: { ok: true } };
  });

  // Admins see every story, except another admin's private stories they haven't been added to:
  // those show as "Private story" with their owner, nothing more, and can't be deleted from here.
  r.get('/api/admin/stories', ({ user }) => {
    requireAdmin(user);
    const mine = new Set(db.prepare('SELECT story_id FROM story_members WHERE user_id = ?').all(user.id).map((m) => m.story_id));
    const rows = db.prepare(`${STORY_SELECT} ORDER BY s.updated_at DESC`).all();
    const stories = rows.map((r) => {
      const st = toStory(r);
      return r.visibility !== 'private' || mine.has(r.id) || adminCanSee(db, r, user) ? st
        : { ...st, title: 'Private story', summary: '', genre: '', icon: null, banner: null, contentWarnings: [], loreTagline: null, hidden: true };
    });
    return { data: { stories } };
  });

  r.delete('/api/admin/stories/:id', ({ user, params }) => {
    requireAdmin(user);
    const s = db.prepare('SELECT * FROM stories WHERE id = ?').get(params.id) ?? fail(404, 'Story not found');
    const inIt = db.prepare('SELECT 1 FROM story_members WHERE story_id = ? AND user_id = ?').get(s.id, user.id);
    if (s.visibility === 'private' && !inIt && !adminCanSee(db, s, user)) fail(404, 'Story not found');
    hub.sendStory(s.id, 'story', { storyId: s.id });
    db.prepare('DELETE FROM stories WHERE id = ?').run(s.id);
    log(user.id, 'delete-story', `#${s.id} "${s.title}"`);
    return { data: { ok: true } };
  });

  r.get('/api/admin/log', ({ user }) => {
    requireAdmin(user);
    const rows = db.prepare(`SELECT l.*, u.display_name FROM mod_log l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.id DESC LIMIT 200`).all();
    return { data: { entries: rows.map((l) => ({ id: l.id, action: l.action, detail: l.detail, actor: l.display_name, createdAt: l.created_at })) } };
  });

  // ---------- NPC automation ----------
  r.get('/api/admin/bots', ({ user }) => {
    requireAdmin(user);
    const rows = db.prepare(`SELECT c.*, u.display_name AS owner_name FROM characters c JOIN users u ON u.id = c.user_id
      WHERE c.bot IS NOT NULL ORDER BY c.bot DESC, c.name COLLATE NOCASE`).all();
    return {
      data: {
        settings: ctx.bots.settings(),
        characters: rows.map((c) => ({ id: c.id, name: c.name, handle: c.handle, bot: c.bot, avatar: c.avatar, color: c.color, ownerName: c.owner_name,
          lines: Object.fromEntries(Object.entries(JSON.parse(c.bot_lines || '{}')).map(([k, v]) => [k, v.length])) })),
      },
    };
  });

  r.put('/api/admin/bots', ({ user, body }) => {
    requireAdmin(user);
    const cur = ctx.bots.settings();
    const num = (v, lo, hi, fallback) => (v === undefined ? fallback : Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);
    const next = {
      enabled: body.enabled === undefined ? cur.enabled : !!body.enabled,
      commentChance: num(body.commentChance, 0, 1, cur.commentChance),
      maxCommentsPerPost: Math.round(num(body.maxCommentsPerPost, 0, 10, cur.maxCommentsPerPost)),
      postEveryHours: num(body.postEveryHours, 1, 24 * 30, cur.postEveryHours),
      gossipAboutThreads: body.gossipAboutThreads === undefined ? cur.gossipAboutThreads : !!body.gossipAboutThreads,
    };
    ctx.bots.saveSettings(next);
    ctx.modLog(user.id, 'bot-settings', JSON.stringify(next));
    return { data: { settings: next } };
  });

  // Try a character's lines right now.
  r.post('/api/admin/bots/run', ({ user, body }) => {
    requireAdmin(user);
    const what = body.what === 'comment' ? 'comment' : 'post';
    const res = ctx.bots.runNow(Number(body.characterId), what);
    if (!res) fail(400, `Nothing to ${what} — add some ${what === 'comment' ? 'comment' : 'post'} lines first`);
    return { data: { ok: true, socialId: res } };
  });
}
