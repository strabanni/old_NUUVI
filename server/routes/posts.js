// Posts inside channels, plus reporting posts and users.
import { fail, str, oneOf, countWords } from '../http.js';
import {
  toPost,
  POST_SELECT,
  requireUser,
  channelAccess,
  storyAccess,
  membership,
  turnState,
  uploadRef,
  isBlocked,
  requirePlayable,
} from '../model.js';
import { plainText } from '../text.js';

// No practical limit on how long a post can be (about 170,000 words); the cap only guards the server.
const MAX_POST_CHARS = 1_000_000;
const MAX_PICTURES = 10;
const PAGE = 50;

export function postRoutes(r, ctx) {
  const { db, hub } = ctx;
  const loadPost = (postId) => toPost(db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(postId));
  // Pictures attached to a message: uploads or https:// picture links.
  const pictures = (value, userId) => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail(400, 'Pictures must be a list');
    if (value.length > MAX_PICTURES) fail(400, `At most ${MAX_PICTURES} pictures per message`);
    return value.map((v) => uploadRef(db, v, userId) ?? fail(400, 'Picture missing'));
  };

  r.get('/api/channels/:id/posts', ({ user, params, query }) => {
    const { channel } = channelAccess(db, params.id, user);
    const after = Number(query.get('after')) || 0;
    const before = Number(query.get('before')) || 0;
    let rows;
    if (after) {
      rows = db.prepare(`${POST_SELECT} WHERE p.channel_id = ? AND p.id > ? ORDER BY p.id LIMIT 500`).all(channel.id, after);
    } else {
      rows = db
        .prepare(`${POST_SELECT} WHERE p.channel_id = ? AND p.id < ? ORDER BY p.id DESC LIMIT ?`)
        .all(channel.id, before || Number.MAX_SAFE_INTEGER, PAGE + 1)
        .reverse();
    }
    const hasMore = !after && rows.length > PAGE;
    if (hasMore) rows.shift();
    return { data: { posts: rows.map(toPost), hasMore } };
  });

  r.post('/api/channels/:id/posts', ({ user, body, params }) => {
    requireUser(user);
    const { channel, story, role } = channelAccess(db, params.id, user);
    if (!role) fail(403, 'Join the story to write in it');
    if (!ctx.canPost(channel, role, user)) {
      fail(
        403,
        story.completed_at
          ? 'This story is complete and archived'
          : channel.status === 'complete'
            ? 'This thread is complete'
            : 'This thread is private to the characters in it',
      );
    }
    const kind = oneOf(body.kind, 'Kind', ['ic', 'ooc', 'narration']) ?? 'ic';
    const media = pictures(body.media, user.id);
    const text = str(body.body, 'Post', { max: MAX_POST_CHARS }) ?? '';
    if (!text && !media.length) fail(400, 'Write something or add a picture');
    const cw = str(body.cw, 'Content warning', { max: 100 }) ?? '';
    // Where this post happens, when the scene moves somewhere new.
    const location = str(body.location, 'Location', { max: 100 }) || null;
    let replyTo = null;
    if (body.replyTo != null) {
      const target = db
        .prepare('SELECT id, user_id FROM posts WHERE id = ? AND channel_id = ?')
        .get(Number(body.replyTo), channel.id);
      if (!target) fail(400, 'That message is gone');
      replyTo = target;
    }

    let characterId = null;
    if (kind === 'ic' && body.characterId == null) fail(400, 'Pick a character to write in-character');
    if (kind === 'ic') {
      const c = db
        .prepare('SELECT id, name, status FROM characters WHERE id = ? AND user_id = ?')
        .get(Number(body.characterId), user.id);
      if (!c) fail(400, 'Choose one of your own characters');
      requirePlayable(c);
      characterId = c.id;
    }

    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO posts (story_id, channel_id, user_id, character_id, kind, body, cw, word_count, reply_to, media, location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        story.id,
        channel.id,
        user.id,
        characterId,
        kind,
        text,
        cw,
        countWords(text),
        replyTo?.id ?? null,
        JSON.stringify(media),
        location,
      );
    const postId = Number(lastInsertRowid);
    db.prepare("UPDATE stories SET updated_at = datetime('now') WHERE id = ?").run(story.id);
    db.prepare("UPDATE channels SET last_post_at = datetime('now') WHERE id = ?").run(channel.id);
    if (characterId)
      db.prepare('INSERT OR IGNORE INTO channel_characters (channel_id, character_id) VALUES (?, ?)').run(
        channel.id,
        characterId,
      );
    db.prepare(
      `INSERT INTO channel_reads (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
      ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_id = excluded.last_read_id`,
    ).run(user.id, channel.id, postId);

    const post = loadPost(postId);
    hub.sendStory(story.id, 'post', post);
    ctx.notifyPost(post, story, channel);
    if (replyTo && replyTo.user_id !== user.id && !isBlocked(db, replyTo.user_id, user.id)) {
      ctx.notify({
        userId: replyTo.user_id,
        type: 'reply',
        actorId: user.id,
        storyId: story.id,
        channelId: channel.id,
        postId,
        text: plainText(text) || 'sent a picture',
      });
    }

    // Writing your scene post passes the turn along.
    const turns = turnState(channel);
    if (turns.enabled && turns.current === user.id && (kind === 'ic' || kind === 'narration')) ctx.advanceTurn(channel, user.id);
    return { status: 201, data: { post } };
  });

  r.put('/api/posts/:id', ({ user, body, params }) => {
    requireUser(user);
    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(params.id);
    if (!existing || existing.user_id !== user.id) fail(404, 'Post not found');
    const text = str(body.body, 'Post', { max: MAX_POST_CHARS }) ?? existing.body;
    const media = body.media === undefined ? JSON.parse(existing.media || '[]') : pictures(body.media, user.id);
    if (!text && !media.length) fail(400, 'Write something or add a picture');
    const cw = str(body.cw, 'Content warning', { max: 100 }) ?? existing.cw;
    db.prepare("UPDATE posts SET body = ?, cw = ?, word_count = ?, media = ?, edited_at = datetime('now') WHERE id = ?").run(
      text,
      cw,
      countWords(text),
      JSON.stringify(media),
      existing.id,
    );
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
    if (existing.user_id !== user.id && !isOwner)
      ctx.modLog(user.id, 'delete-post', `#${existing.id} in story #${existing.story_id}`);
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
    const snapshot = JSON.stringify({
      body: post.body,
      kind: post.kind,
      character: post.character?.name ?? null,
      createdAt: post.createdAt,
    });
    db.prepare(
      'INSERT INTO reports (reporter_id, post_id, target_user, story_id, reason, snapshot) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(user.id, row.id, row.user_id, row.story_id, reason, snapshot);
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
