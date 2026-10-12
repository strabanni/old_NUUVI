// NPC automation. Characters marked as automatic NPCs ("bot") comment on social posts and post
// now and then, picking from lines their writer gave them. The gossip account (admin-only,
// anonymous) also posts tips when public threads start or finish. Lines can use placeholders:
//   comments: {name} {handle} (whose post it is)    posts: {someone} (a random character)
//   gossip tips: {a} {b} (characters in the thread), {thread}, {story}

export const DEFAULT_SETTINGS = { enabled: true, commentChance: 0.35, maxCommentsPerPost: 2, postEveryHours: 12, gossipAboutThreads: true };

export function createBots(ctx, { random = Math.random, delay = (fn) => setTimeout(fn, 20000 + random() * 100000).unref?.() } = {}) {
  const { db } = ctx;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const fill = (line, vars) => line.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  const linesOf = (c) => { try { return JSON.parse(c.bot_lines || '{}'); } catch { return {}; } };

  const settings = () => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'bots'").get();
    return { ...DEFAULT_SETTINGS, ...(row ? JSON.parse(row.value) : {}) };
  };
  const saveSettings = (s) => db.prepare(`INSERT INTO settings (key, value) VALUES ('bots', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(s));

  const automatic = (kind) => db.prepare('SELECT * FROM characters WHERE bot = ?').all(kind);

  function post(c, body) {
    if (!body) return null;
    const { lastInsertRowid } = db.prepare("INSERT INTO social_posts (character_id, user_id, kind, body) VALUES (?, ?, 'text', ?)")
      .run(c.id, c.user_id, body.slice(0, 5000));
    return Number(lastInsertRowid);
  }

  function comment(c, postRow, body) {
    if (!db.prepare('SELECT 1 FROM social_posts WHERE id = ?').get(postRow.id)) return; // deleted meanwhile
    db.prepare('INSERT INTO social_comments (post_id, character_id, user_id, body) VALUES (?, ?, ?, ?)').run(postRow.id, c.id, c.user_id, body.slice(0, 2000));
    if (postRow.user_id !== c.user_id) {
      ctx.notify({ userId: postRow.user_id, type: 'comment', actorId: c.user_id, characterId: c.id, socialId: postRow.id, text: `${c.name}: ${body.slice(0, 120)}` });
    }
  }

  return {
    settings,
    saveSettings,

    // A new social post: some automatic NPCs may comment on it (a little later, like real people).
    onSocialPost(postId) {
      const s = settings();
      if (!s.enabled) return;
      const p = db.prepare('SELECT p.*, c.name, c.handle FROM social_posts p JOIN characters c ON c.id = p.character_id WHERE p.id = ?').get(postId);
      if (!p) return;
      const bots = automatic('bot').filter((b) => b.id !== p.character_id && (linesOf(b).comments || []).length);
      let made = 0;
      for (const b of bots.sort(() => random() - 0.5)) {
        if (made >= s.maxCommentsPerPost) break;
        if (random() >= s.commentChance) continue;
        made += 1;
        const line = fill(pick(linesOf(b).comments), { name: p.name, handle: `@${p.handle}` });
        delay(() => comment(b, p, line));
      }
    },

    // A public thread started or finished: the gossip account may post a tip about it.
    onThread(channelId, what) {
      const s = settings();
      if (!s.enabled || !s.gossipAboutThreads) return;
      const ch = db.prepare('SELECT c.*, s.title AS story_title, s.visibility FROM channels c JOIN stories s ON s.id = c.story_id WHERE c.id = ?').get(channelId);
      if (!ch || ch.visibility !== 'public' || ch.status === 'closed' || !['thread', 'event', 'para'].includes(ch.kind)) return;
      const cast = db.prepare('SELECT ch.name FROM channel_characters cc JOIN characters ch ON ch.id = cc.character_id WHERE cc.channel_id = ?').all(ch.id).map((x) => x.name);
      if (!cast.length) return;
      for (const g of automatic('gossip')) {
        const tips = linesOf(g)[what === 'finished' ? 'finished' : 'tips'] || [];
        if (!tips.length) continue;
        const [a, b] = cast.sort(() => random() - 0.5);
        const line = fill(pick(tips), { a, b: b ?? 'someone', thread: ch.name, story: ch.story_title });
        delay(() => post(g, line));
      }
    },

    // Every so often each automatic NPC / gossip account posts one of its lines.
    tick(now = Date.now()) {
      const s = settings();
      if (!s.enabled) return;
      const someone = () => db.prepare('SELECT name FROM characters WHERE bot IS NULL ORDER BY RANDOM() LIMIT 1').get()?.name ?? 'someone';
      for (const b of [...automatic('bot'), ...automatic('gossip')]) {
        const lines = linesOf(b).posts || [];
        if (!lines.length) continue;
        const last = db.prepare('SELECT MAX(created_at) AS at FROM social_posts WHERE character_id = ?').get(b.id).at;
        const due = s.postEveryHours * 3600e3 * (0.6 + random() * 0.8);
        if (last && now - new Date(`${last.replace(' ', 'T')}Z`).getTime() < due) continue;
        post(b, fill(pick(lines), { someone: someone() }));
      }
    },

    // Admins can make a character post or comment right away (to try out its lines).
    runNow(characterId, what) {
      const b = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
      if (!b?.bot) return null;
      const lines = linesOf(b);
      if (what === 'comment') {
        const p = db.prepare('SELECT p.*, c.name, c.handle FROM social_posts p JOIN characters c ON c.id = p.character_id WHERE p.character_id != ? ORDER BY p.id DESC LIMIT 1').get(b.id);
        if (!p || !(lines.comments || []).length) return null;
        comment(b, p, fill(pick(lines.comments), { name: p.name, handle: `@${p.handle}` }));
        return p.id;
      }
      const list = lines.posts || [];
      if (!list.length) return null;
      return post(b, fill(pick(list), { someone: db.prepare('SELECT name FROM characters WHERE bot IS NULL ORDER BY RANDOM() LIMIT 1').get()?.name ?? 'someone' }));
    },
  };
}
