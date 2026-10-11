// Threads (a story's channels, typed as thread / comms / event / ooc), tagging characters, and the feed.
import { fail, str, oneOf, id } from '../http.js';
import { transaction } from '../db.js';
import { toChannel, toCharacter, requireUser, storyAccess, channelAccess, isBlocked } from '../model.js';

export const KINDS = ['thread', 'comms', 'event', 'ooc'];
const OWNER_KINDS = ['event', 'ooc']; // only story owners create these
const STATUSES = ['open', 'closed', 'complete'];

function tagsInput(value) {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : fail(400, 'Tags must be a list');
  const clean = [...new Set(list.map((t) => String(t).trim().toLowerCase().replace(/,/g, '')).filter(Boolean))];
  if (clean.length > 12 || clean.some((t) => t.length > 30)) fail(400, 'Use at most 12 tags of 30 characters each');
  return clean.join(', ');
}

function eventInput(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) fail(400, 'Event date is invalid');
  return d.toISOString();
}

export function threadRoutes(r, ctx) {
  const { db, hub } = ctx;
  const storyChanged = (storyId) => hub.sendStory(storyId, 'story', { storyId });

  const participants = (channelId, limit = 12) => db.prepare(`
    SELECT c.* FROM channel_characters cc JOIN characters c ON c.id = cc.character_id
    WHERE cc.channel_id = ? ORDER BY c.name COLLATE NOCASE LIMIT ?`).all(channelId, limit).map(toCharacter);

  // Characters must belong to members of the story to be tagged.
  function validTagged(storyId, ids) {
    if (!Array.isArray(ids) || ids.length > 20) fail(400, 'Tag at most 20 characters');
    const out = [];
    for (const raw of ids) {
      const c = db.prepare(`SELECT c.id, c.user_id FROM characters c JOIN story_members m ON m.user_id = c.user_id AND m.story_id = ?
        WHERE c.id = ?`).get(storyId, id(raw, 'Character'));
      if (!c) fail(400, 'You can only tag characters of people in this story');
      out.push(c);
    }
    return out;
  }

  function tagCharacters(channel, chars, actor) {
    const ins = db.prepare('INSERT OR IGNORE INTO channel_characters (channel_id, character_id) VALUES (?, ?)');
    for (const c of chars) {
      const { changes } = ins.run(channel.id, c.id);
      if (changes && c.user_id !== actor.id && !isBlocked(db, c.user_id, actor.id)) {
        ctx.notify({ userId: c.user_id, type: 'tag', actorId: actor.id, storyId: channel.story_id, channelId: channel.id, text: channel.name });
      }
    }
  }

  function canManage(channel, role, user) {
    return role === 'owner' || user.isAdmin || channel.created_by === user.id;
  }

  r.get('/api/channels/:id', ({ user, params }) => {
    const { channel, story, role } = channelAccess(db, params.id, user);
    return {
      data: {
        channel: toChannel(channel),
        participants: participants(channel.id, 50),
        story: { id: story.id, title: story.title, color: story.color, icon: story.icon, banner: story.banner },
        canManage: !!user && canManage(channel, role, user),
        canPost: !!user && ctx.canPost(channel, role, user),
      },
    };
  });

  r.post('/api/stories/:id/channels', ({ user, body, params }) => {
    requireUser(user);
    const { row, role } = storyAccess(db, params.id, user);
    if (!role && !user.isAdmin) fail(403, 'Join the story to start a thread');
    const kind = oneOf(body.kind, 'Type', KINDS) ?? 'thread';
    if (OWNER_KINDS.includes(kind) && role !== 'owner' && !user.isAdmin) fail(403, 'Only the story owner can create that');
    if (db.prepare('SELECT COUNT(*) AS n FROM channels WHERE story_id = ?').get(row.id).n >= 500) fail(400, 'This story has too many threads');
    const name = str(body.name, 'Title', { min: 1, max: 80, required: true });
    const topic = str(body.topic, 'Topic', { max: 300 }) ?? '';
    const summary = str(body.summary, 'Summary', { max: 3000 }) ?? '';
    const tags = tagsInput(body.tags) ?? '';
    const status = oneOf(body.status, 'Status', STATUSES) ?? 'open';
    const eventAt = eventInput(body.eventAt) ?? null;
    let starter = null;
    if (body.characterId != null) {
      starter = db.prepare('SELECT id, user_id FROM characters WHERE id = ? AND user_id = ?').get(Number(body.characterId), user.id);
      if (!starter) fail(400, 'Choose one of your own characters');
    }
    const tagged = body.tagged !== undefined ? validTagged(row.id, body.tagged) : [];

    const channel = transaction(db, () => {
      const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM channels WHERE story_id = ?').get(row.id).p;
      const { lastInsertRowid } = db.prepare(`INSERT INTO channels
        (story_id, name, topic, position, kind, status, summary, tags, event_at, created_by, starter_character_id, last_post_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
        .run(row.id, name, topic, position, kind, status, summary, tags, eventAt, user.id, starter?.id ?? null);
      const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(lastInsertRowid);
      tagCharacters(ch, [...(starter ? [starter] : []), ...tagged], user);
      return ch;
    });
    storyChanged(row.id);
    return { status: 201, data: { channel: toChannel(channel) } };
  });

  r.put('/api/channels/:id', ({ user, body, params }) => {
    requireUser(user);
    const { channel, role } = channelAccess(db, params.id, user);
    if (!canManage(channel, role, user)) fail(403, 'Only the thread starter or story owner can change this');
    const kind = oneOf(body.kind, 'Type', KINDS) ?? channel.kind;
    if (kind !== channel.kind && OWNER_KINDS.includes(kind) && role !== 'owner' && !user.isAdmin) fail(403, 'Only the story owner can do that');
    const f = {
      name: str(body.name, 'Title', { min: 1, max: 80 }) ?? channel.name,
      topic: str(body.topic, 'Topic', { max: 300 }) ?? channel.topic,
      summary: str(body.summary, 'Summary', { max: 3000 }) ?? channel.summary,
      tags: tagsInput(body.tags) ?? channel.tags,
      status: oneOf(body.status, 'Status', STATUSES) ?? channel.status,
      eventAt: body.eventAt === undefined ? channel.event_at : eventInput(body.eventAt),
    };
    let position = channel.position;
    if (body.move === 'up' || body.move === 'down') {
      if (role !== 'owner' && !user.isAdmin) fail(403, 'Only the story owner can reorder channels');
      const neighbour = db.prepare(`SELECT * FROM channels WHERE story_id = ? AND position ${body.move === 'up' ? '<' : '>'} ?
        ORDER BY position ${body.move === 'up' ? 'DESC' : 'ASC'} LIMIT 1`).get(channel.story_id, channel.position);
      if (neighbour) {
        db.prepare('UPDATE channels SET position = ? WHERE id = ?').run(channel.position, neighbour.id);
        position = neighbour.position;
      }
    }
    db.prepare(`UPDATE channels SET name = ?, topic = ?, summary = ?, tags = ?, status = ?, event_at = ?, kind = ?, position = ?
      WHERE id = ?`).run(f.name, f.topic, f.summary, f.tags, f.status, f.eventAt, kind, position, channel.id);
    if (body.tagged !== undefined) tagCharacters(channel, validTagged(channel.story_id, body.tagged), user);
    storyChanged(channel.story_id);
    return { data: { channel: toChannel(db.prepare('SELECT * FROM channels WHERE id = ?').get(channel.id)) } };
  });

  r.delete('/api/channels/:id', ({ user, params }) => {
    requireUser(user);
    const { channel, role } = channelAccess(db, params.id, user);
    if (!canManage(channel, role, user)) fail(403, 'Only the thread starter or story owner can delete this');
    if (db.prepare('SELECT COUNT(*) AS n FROM channels WHERE story_id = ?').get(channel.story_id).n <= 1) {
      fail(400, 'A story needs at least one channel');
    }
    db.prepare('DELETE FROM channels WHERE id = ?').run(channel.id);
    storyChanged(channel.story_id);
    return { data: { ok: true } };
  });

  // ---------- Feed ----------
  // Every thread you can see, across stories, newest activity first.
  r.get('/api/feed', ({ user, query }) => {
    const filter = query.get('filter') || 'all';
    const q = (query.get('q') || '').trim().slice(0, 100);
    const where = [`(s.visibility = 'public' OR s.id IN (SELECT story_id FROM story_members WHERE user_id = :u))`];
    const args = { u: user?.id ?? 0 };
    if (filter === 'open') where.push("c.kind = 'thread' AND c.status = 'open'");
    else if (filter === 'mine') where.push('c.id IN (SELECT cc.channel_id FROM channel_characters cc JOIN characters ch ON ch.id = cc.character_id WHERE ch.user_id = :u)');
    else if (KINDS.includes(filter)) { where.push('c.kind = :kind'); args.kind = filter; }
    if (q) {
      where.push("(c.name LIKE :q ESCAPE '\\' OR c.summary LIKE :q ESCAPE '\\' OR c.tags LIKE :q ESCAPE '\\' OR s.title LIKE :q ESCAPE '\\')");
      args.q = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    }
    const rows = db.prepare(`
      SELECT c.*, s.title AS story_title, s.color AS story_color, s.icon AS story_icon, s.banner AS story_banner,
        (SELECT COUNT(*) FROM posts p WHERE p.channel_id = c.id) AS post_count,
        (SELECT MAX(p.id) FROM posts p WHERE p.channel_id = c.id) AS last_post_id,
        (SELECT COUNT(*) FROM posts p WHERE p.channel_id = c.id AND p.user_id != :u
           AND p.id > COALESCE((SELECT last_read_id FROM channel_reads r WHERE r.channel_id = c.id AND r.user_id = :u), 0)
           AND EXISTS (SELECT 1 FROM story_members m WHERE m.story_id = c.story_id AND m.user_id = :u)) AS unread
      FROM channels c JOIN stories s ON s.id = c.story_id
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(c.last_post_at, c.created_at) DESC, c.id DESC LIMIT 100`).all(args);
    const lastPost = db.prepare(`SELECT p.body, p.cw, p.created_at, u.display_name, ch.name AS character_name
      FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN characters ch ON ch.id = p.character_id WHERE p.id = ?`);
    const starter = db.prepare('SELECT * FROM characters WHERE id = ?');
    return {
      data: {
        items: rows.map((row) => {
          const lp = row.last_post_id ? lastPost.get(row.last_post_id) : null;
          const st = row.starter_character_id ? starter.get(row.starter_character_id) : null;
          return {
            ...toChannel(row),
            postCount: row.post_count,
            story: { id: row.story_id, title: row.story_title, color: row.story_color, icon: row.story_icon, banner: row.story_banner },
            starter: st ? toCharacter(st) : null,
            participants: participants(row.id, 6),
            lastPost: lp ? {
              by: lp.character_name || lp.display_name,
              text: lp.cw ? `CW: ${lp.cw}` : lp.body.replace(/[*_~|>]/g, '').replace(/\s+/g, ' ').slice(0, 160),
              createdAt: lp.created_at,
            } : null,
          };
        }),
      },
    };
  });

  // Who may write in a channel. Completed threads are read-only (except for their managers);
  // closed threads are for the people already in them.
  ctx.canPost = (channel, role, user) => {
    if (!role) return false;
    if (channel.kind === 'ooc' || canManage(channel, role, user)) return true;
    if (channel.status === 'complete') return false;
    if (channel.status === 'closed') {
      return !!db.prepare(`SELECT 1 FROM channel_characters cc JOIN characters c ON c.id = cc.character_id
        WHERE cc.channel_id = ? AND c.user_id = ?`).get(channel.id, user.id);
    }
    return true;
  };
}
