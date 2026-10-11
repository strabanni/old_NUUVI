// Posts inside channels, plus reporting posts and users.
import { fail, str, oneOf, countWords } from '../http.js';
import { rollDice } from '../dice.js';
import { toPost, POST_SELECT, requireUser, channelAccess, storyAccess, membership, turnState } from '../model.js';

const MAX_POST_CHARS = 30000;
const PAGE = 50;

export function postRoutes(r, ctx) {
  const { db, hub } = ctx;
  const loadPost = (postId) => toPost(db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(postId));

  r.get('/api/channels/:id/posts', ({ user, params, query }) => {
    const { channel } = channelAccess(db, params.id, user);
    const after = Number(query.get('after')) || 0;
    const before = Number(query.get('before')) || 0;
    let rows;
    if (after) {
      rows = db.prepare(`${POST_SELECT} WHERE p.channel_id = ? AND p.id > ? ORDER BY p.id LIMIT 500`).all(channel.id, after);
    } else {
      rows = db.prepare(`${POST_SELECT} WHERE p.channel_id = ? AND p.id < ? ORDER BY p.id DESC LIMIT ?`)
        .all(channel.id, before || Number.MAX_SAFE_INTEGER, PAGE + 1).reverse();
    }
    const hasMore = !after && rows.length > PAGE;
    if (hasMore) rows.shift();
    return { data: { posts: rows.map(toPost), hasMore } };
  });

  r.post('/api/channels/:id/posts', ({ user, body, params }) => {
    requireUser(user);
    const { channel, story, role } = channelAccess(db, params.id, user);
    if (!role) fail(403, 'Join the story to write in it');
    const kind = oneOf(body.kind, 'Kind', ['ic', 'ooc', 'narration', 'roll']) ?? 'ic';
    const text = str(body.body, 'Post', { min: kind === 'roll' ? 0 : 1, max: MAX_POST_CHARS, required: kind !== 'roll' }) ?? '';
    const cw = str(body.cw, 'Content warning', { max: 100 }) ?? '';
    const roll = kind === 'roll' ? JSON.stringify(rollDice(body.dice)) : null;

    let characterId = null;
    if (kind === 'ic' && body.characterId == null) fail(400, 'Pick a character to write in-character');
    if ((kind === 'ic' || kind === 'roll') && body.characterId != null) {
      const c = db.prepare('SELECT id FROM characters WHERE id = ? AND user_id = ?').get(Number(body.characterId), user.id);
      if (!c) fail(400, 'Choose one of your own characters');
      characterId = c.id;
    }

    const { lastInsertRowid } = db.prepare(`INSERT INTO posts (story_id, channel_id, user_id, character_id, kind, body, cw, roll, word_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(story.id, channel.id, user.id, characterId, kind, text, cw, roll, countWords(text));
    const postId = Number(lastInsertRowid);
    db.prepare("UPDATE stories SET updated_at = datetime('now') WHERE id = ?").run(story.id);
    db.prepare(`INSERT INTO channel_reads (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id`).run(user.id, channel.id, postId);

    const post = loadPost(postId);
    hub.sendStory(story.id, 'post', post);
    ctx.notifyPost(post, story, channel);

    // Writing your scene post passes the turn along.
    const turns = turnState(channel);
    if (turns.enabled && turns.current === user.id && (kind === 'ic' || kind === 'narration')) ctx.advanceTurn(channel, user.id);
    return { status: 201, data: { post } };
  });

  r.put('/api/posts/:id', ({ user, body, params }) => {
    requireUser(user);
    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(params.id);
    if (!existing || existing.user_id !== user.id) fail(404, 'Post not found');
    const text = str(body.body, 'Post', { min: existing.kind === 'roll' ? 0 : 1, max: MAX_POST_CHARS, required: true });
    const cw = str(body.cw, 'Content warning', { max: 100 }) ?? existing.cw;
    db.prepare("UPDATE posts SET body = ?, cw = ?, word_count = ?, edited_at = datetime('now') WHERE id = ?")
      .run(text, cw, countWords(text), existing.id);
    const post = loadPost(existing.id);
    hub.sendStory(existing.story_id, 'edit', post);
    return { data: { post } };
  });

  r.delete('/api/posts/:id', ({ user, params }) => {
    requireUser(user);
    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(params.id);
    if (!existing) fail(404, 'Post not found');
    const isOwner = membership(db, existing.story_id, user.id) === 'owner';
    if (existing.user_id !== user.id && !isOwner && !user.isAdmin) fail(404, 'Post not found');
    db.prepare('DELETE FROM posts WHERE id = ?').run(existing.id);
    if (existing.user_id !== user.id && !isOwner) ctx.modLog(user.id, 'delete-post', `#${existing.id} in story #${existing.story_id}`);
    hub.sendStory(existing.story_id, 'delete', { id: existing.id, channelId: existing.channel_id });
    return { data: { ok: true } };
  });

  // ---------- Reports ----------
  r.post('/api/posts/:id/report', ({ user, body, params }) => {
    requireUser(user);
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(params.id);
    if (!row) fail(404, 'Post not found');
    storyAccess(db, row.story_id, user); // must be able to see it
    const reason = str(body.reason, 'Reason', { min: 1, max: 1000, required: true });
    const post = loadPost(row.id);
    const snapshot = JSON.stringify({ body: post.body, kind: post.kind, character: post.character?.name ?? null, createdAt: post.createdAt });
    db.prepare('INSERT INTO reports (reporter_id, post_id, target_user, story_id, reason, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, row.id, row.user_id, row.story_id, reason, snapshot);
    ctx.notifyAdmins(user.id, `${user.displayName} reported a post by ${post.author.displayName}`);
    return { status: 201, data: { ok: true } };
  });

  r.post('/api/users/:id/report', ({ user, body, params }) => {
    requireUser(user);
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    if (!target) fail(404, 'User not found');
    const reason = str(body.reason, 'Reason', { min: 1, max: 1000, required: true });
    db.prepare('INSERT INTO reports (reporter_id, target_user, reason) VALUES (?, ?, ?)').run(user.id, target.id, reason);
    ctx.notifyAdmins(user.id, `${user.displayName} reported ${target.display_name}`);
    return { status: 201, data: { ok: true } };
  });
}
