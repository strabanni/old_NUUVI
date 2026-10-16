// Row mappers, shared SELECTs and access checks.
import { fail } from './http.js';
import { plainText } from './text.js';

export const toUser = (r, prefix = '') => ({
  id: r[`${prefix}id`],
  username: r[`${prefix}username`],
  displayName: r[`${prefix}display_name`],
  avatar: r[`${prefix}avatar`] ?? null,
  gradient: r[`${prefix}gradient`] ? r[`${prefix}gradient`].split(',') : null,
});

// A gradient: 2–3 hex stops, as a list or "#EE719E,#B8A6DB". Empty clears it (null); undefined leaves it.
export function gradientInput(value) {
  if (value === undefined) return undefined;
  const stops = (Array.isArray(value) ? value : String(value || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  if (stops.length && (stops.length < 2 || stops.length > 3 || !stops.every((x) => /^#[0-9a-f]{6}$/i.test(x)))) fail(400, 'A gradient needs 2 or 3 colors');
  return stops.length ? stops.join(',') : null;
}

export function toCharacter(r) {
  return {
    id: r.id, userId: r.user_id, name: r.name, tagline: r.tagline, bio: r.bio,
    color: r.color, avatar: r.avatar, portrait: r.portrait ?? null, banner: r.banner ?? null,
    details: r.details ? JSON.parse(r.details) : [], createdAt: r.created_at,
    aka: r.aka ?? '', postAlign: r.post_align ?? 'right', verified: !!r.verified,
    followersDisplay: r.followers_display ?? null, followingDisplay: r.following_display ?? null,
    handle: r.handle ?? null, npc: !!r.npc, bot: r.bot ?? null,
    gradient: r.gradient ? r.gradient.split(',') : null, npcTags: splitTags(r.npc_tags),
    pronouns: r.pronouns ?? null, threadAvatar: r.thread_avatar ?? null,
    status: r.status ?? null, brand: !!r.brand, private: !!r.private,
  };
}

// Deceased and missing-in-action characters stay on NUUVI (profile, posts, history) but can't be
// played: no new posts, comments, likes, follows or texts as them until the writer switches it off.
export const CHARACTER_STATUSES = ['deceased', 'mia'];
export function requirePlayable(c) {
  if (c?.status === 'deceased') fail(400, `${c.name} is deceased, so they can't be played. Their writer can change that in Edit profile.`);
  if (c?.status === 'mia') fail(400, `${c.name} is missing in action, so they can't be played. Their writer can change that in Edit profile.`);
  return c;
}

const splitTags = (s) => (s ? s.split(',').filter(Boolean) : []);

export const splitWarnings = (s) => (s ? s.split(',').map((w) => w.trim()).filter(Boolean) : []);

const loreTagline = (json) => { try { return JSON.parse(json || '{}').tagline || ''; } catch { return ''; } };

export function toStory(r) {
  return {
    id: r.id, ownerId: r.owner_id, title: r.title, summary: r.summary, genre: r.genre,
    rating: r.rating, contentWarnings: splitWarnings(r.content_warnings),
    visibility: r.visibility, status: r.status, color: r.color, icon: r.icon, banner: r.banner ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at ?? null,
    memberCount: r.member_count, postCount: r.post_count, ownerName: r.owner_name,
    hasOverview: !!r.overview && r.overview !== '{}',
    loreTagline: loreTagline(r.overview),
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
    kind: r.kind ?? 'thread', status: r.status ?? 'open', summary: r.summary ?? '', tags: splitWarnings(r.tags),
    eventAt: r.event_at ?? null, createdBy: r.created_by ?? null, starterCharacterId: r.starter_character_id ?? null,
    icon: r.icon ?? null, eventId: r.event_id ?? null,
    banner: r.banner ?? null, season: r.season ?? null, location: r.location ?? null,
    createdAt: r.created_at, lastPostAt: r.last_post_at ?? null,
    turns: turnState(r), unread: r.unread ?? 0, mentions: r.mentions ?? 0, lastPostId: r.last_post_id ?? 0,
  };
}

export function toPost(r) {
  return {
    id: r.id, storyId: r.story_id, channelId: r.channel_id, userId: r.user_id, kind: r.kind,
    body: r.body, cw: r.cw, roll: r.roll ? JSON.parse(r.roll) : null, wordCount: r.word_count,
    createdAt: r.created_at, editedAt: r.edited_at,
    media: r.media ? JSON.parse(r.media) : [],
    location: r.location ?? null,
    replyTo: r.reply_to && r.reply_user_id != null
      ? { id: r.reply_to, name: r.reply_name, color: r.reply_color ?? null, text: plainText(r.reply_body || ''), hasMedia: r.reply_media !== '[]' }
      : null,
    author: { id: r.user_id, username: r.username, displayName: r.display_name, avatar: r.user_avatar, gradient: r.user_gradient ? r.user_gradient.split(',') : null },
    character: r.character_id
      ? {
        id: r.character_id, name: r.character_name, color: r.character_color, avatar: r.character_avatar,
        portrait: r.character_portrait ?? null, threadAvatar: r.character_thread_avatar ?? null, tagline: r.character_tagline ?? '',
        details: r.character_details ? JSON.parse(r.character_details) : [],
        aka: r.character_aka ?? '', postAlign: r.character_align ?? 'right', verified: !!r.character_verified,
        gradient: r.character_gradient ? r.character_gradient.split(',') : null,
      }
      : null,
  };
}

export const STORY_SELECT = `
  SELECT s.*, u.display_name AS owner_name,
    (SELECT COUNT(*) FROM story_members m WHERE m.story_id = s.id) AS member_count,
    (SELECT COUNT(*) FROM posts p WHERE p.story_id = s.id) AS post_count
  FROM stories s JOIN users u ON u.id = s.owner_id`;

export const POST_SELECT = `
  SELECT p.*, u.username, u.display_name, u.avatar AS user_avatar, u.gradient AS user_gradient,
    c.name AS character_name, c.color AS character_color, c.avatar AS character_avatar,
    c.portrait AS character_portrait, c.thread_avatar AS character_thread_avatar, c.tagline AS character_tagline, c.details AS character_details,
    c.aka AS character_aka, c.post_align AS character_align, c.verified AS character_verified, c.gradient AS character_gradient,
    rp.body AS reply_body, rp.user_id AS reply_user_id, rp.media AS reply_media,
    COALESCE(rc.name, ru.display_name) AS reply_name, rc.color AS reply_color
  FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN characters c ON c.id = p.character_id
  LEFT JOIN posts rp ON rp.id = p.reply_to AND rp.channel_id = p.channel_id
  LEFT JOIN users ru ON ru.id = rp.user_id LEFT JOIN characters rc ON rc.id = rp.character_id`;

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

// Can this person see a private story they aren't in? Admins can see every regular writer's
// stories (for moderation); a private story that belongs to an admin stays that admin's own:
// other admins only get in when they're added.
export function adminCanSee(db, story, user) {
  if (!user?.isAdmin || story.owner_id === user.id) return !!user?.isAdmin;
  return !db.prepare('SELECT is_admin FROM users WHERE id = ?').get(story.owner_id)?.is_admin;
}

// Loads a story the user may read; private stories are invisible to non-members (see adminCanSee).
export function storyAccess(db, storyId, user) {
  const row = db.prepare(`${STORY_SELECT} WHERE s.id = ?`).get(storyId);
  if (!row) fail(404, 'Story not found');
  const role = membership(db, storyId, user?.id);
  if (row.visibility === 'private' && !role && !adminCanSee(db, row, user)) fail(404, 'Story not found');
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
// A picture link from anywhere on the web (writers often keep pictures on Pinterest, Tumblr…).
export function imageLink(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  let u;
  try { u = new URL(value); } catch { return null; }
  return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
}

// An image the person uploaded here, or an https:// picture link.
export function uploadRef(db, value, userId) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const link = imageLink(value);
  if (link) return link;
  const m = typeof value === 'string' && value.match(/^\/uploads\/([\w-]+\.(?:png|jpg|webp|gif))$/);
  if (!m || !db.prepare('SELECT 1 FROM uploads WHERE name = ? AND user_id = ?').get(m[1], userId)) {
    fail(400, 'Upload the image first');
  }
  return value;
}

// Private accounts: who may see a character's posts and stories. SQL for a character aliased `c`
// (with :viewer bound), and the same check in code. Their own writer and followers can.
export const CAN_SEE_ACCOUNT = `(COALESCE(c.private, 0) = 0 OR c.user_id = :viewer OR EXISTS (SELECT 1 FROM character_follows cf
  JOIN characters fc ON fc.id = cf.follower_id WHERE cf.followed_id = c.id AND fc.user_id = :viewer))`;
export function canSeeAccount(db, character, viewerId) {
  if (!character?.private || character.user_id === viewerId) return true;
  return !!db.prepare(`SELECT 1 FROM character_follows cf JOIN characters fc ON fc.id = cf.follower_id
    WHERE cf.followed_id = ? AND fc.user_id = ?`).get(character.id, viewerId);
}

export function isBlocked(db, blockerId, blockedId) {
  return !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(blockerId, blockedId);
}

export function modLog(db, actorId, action, detail = '') {
  db.prepare('INSERT INTO mod_log (actor_id, action, detail) VALUES (?, ?, ?)').run(actorId, action, detail);
}
