// Row mappers, shared SELECTs and access checks.
import { fail } from './http.js';

export const toUser = (r, prefix = '') => ({
  id: r[`${prefix}id`],
  username: r[`${prefix}username`],
  displayName: r[`${prefix}display_name`],
  avatar: r[`${prefix}avatar`] ?? null,
});

export function toCharacter(r) {
  return {
    id: r.id, userId: r.user_id, name: r.name, tagline: r.tagline, bio: r.bio,
    color: r.color, avatar: r.avatar, createdAt: r.created_at,
  };
}

export const splitWarnings = (s) => (s ? s.split(',').map((w) => w.trim()).filter(Boolean) : []);

export function toStory(r) {
  return {
    id: r.id, ownerId: r.owner_id, title: r.title, summary: r.summary, genre: r.genre,
    rating: r.rating, contentWarnings: splitWarnings(r.content_warnings),
    visibility: r.visibility, status: r.status, color: r.color, icon: r.icon,
    createdAt: r.created_at, updatedAt: r.updated_at,
    memberCount: r.member_count, postCount: r.post_count, ownerName: r.owner_name,
  };
}

export function turnState(r) {
  const order = JSON.parse(r.turn_order);
  return {
    enabled: !!r.turns_enabled,
    order,
    current: r.turns_enabled && order.length ? order[r.turn_index % order.length] : null,
  };
}

export function toChannel(r) {
  return {
    id: r.id, storyId: r.story_id, name: r.name, topic: r.topic, position: r.position,
    turns: turnState(r), unread: r.unread ?? 0, mentions: r.mentions ?? 0, lastPostId: r.last_post_id ?? 0,
  };
}

export function toPost(r) {
  return {
    id: r.id, storyId: r.story_id, channelId: r.channel_id, userId: r.user_id, kind: r.kind,
    body: r.body, cw: r.cw, roll: r.roll ? JSON.parse(r.roll) : null, wordCount: r.word_count,
    createdAt: r.created_at, editedAt: r.edited_at,
    author: { id: r.user_id, username: r.username, displayName: r.display_name, avatar: r.user_avatar },
    character: r.character_id
      ? { id: r.character_id, name: r.character_name, color: r.character_color, avatar: r.character_avatar }
      : null,
  };
}

export const STORY_SELECT = `
  SELECT s.*, u.display_name AS owner_name,
    (SELECT COUNT(*) FROM story_members m WHERE m.story_id = s.id) AS member_count,
    (SELECT COUNT(*) FROM posts p WHERE p.story_id = s.id) AS post_count
  FROM stories s JOIN users u ON u.id = s.owner_id`;

export const POST_SELECT = `
  SELECT p.*, u.username, u.display_name, u.avatar AS user_avatar,
    c.name AS character_name, c.color AS character_color, c.avatar AS character_avatar
  FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN characters c ON c.id = p.character_id`;

export function requireUser(user) {
  if (!user) fail(401, 'Please sign in');
  return user;
}

export function requireAdmin(user) {
  requireUser(user);
  if (!user.isAdmin) fail(403, 'Admins only');
  return user;
}

export function membership(db, storyId, userId) {
  if (!userId) return null;
  return db.prepare('SELECT role FROM story_members WHERE story_id = ? AND user_id = ?').get(storyId, userId)?.role ?? null;
}

// Loads a story the user may read; private stories are invisible to non-members.
export function storyAccess(db, storyId, user) {
  const row = db.prepare(`${STORY_SELECT} WHERE s.id = ?`).get(storyId);
  if (!row) fail(404, 'Story not found');
  const role = membership(db, storyId, user?.id);
  if (row.visibility === 'private' && !role) fail(404, 'Story not found');
  return { row, role };
}

export function channelAccess(db, channelId, user) {
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(channelId);
  if (!channel) fail(404, 'Channel not found');
  const { row: story, role } = storyAccess(db, channel.story_id, user);
  return { channel, story, role };
}

export function requireOwner(role, user) {
  if (role !== 'owner' && !user?.isAdmin) fail(403, 'Only the story owner can do that');
}

// Accepts null/'' (clear) or a path to an image this user uploaded.
export function uploadRef(db, value, userId) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const m = typeof value === 'string' && value.match(/^\/uploads\/([\w-]+\.(?:png|jpg|webp|gif))$/);
  if (!m || !db.prepare('SELECT 1 FROM uploads WHERE name = ? AND user_id = ?').get(m[1], userId)) {
    fail(400, 'Upload the image first');
  }
  return value;
}

export function isBlocked(db, blockerId, blockedId) {
  return !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId);
}

export function modLog(db, actorId, action, detail = '') {
  db.prepare('INSERT INTO mod_log (actor_id, action, detail) VALUES (?, ?, ?)').run(actorId, action, detail);
}
