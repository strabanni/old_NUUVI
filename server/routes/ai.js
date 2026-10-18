// Writing tools powered by Claude: "Check my writing", translations and "Previously on…" recaps.
// They only work when the site has an ANTHROPIC_API_KEY; the buttons are hidden otherwise.
import { fail, str } from '../http.js';
import { requireUser, channelAccess } from '../model.js';
import { createRateLimiter } from '../auth.js';
import { plainText } from '../text.js';

const CHECK_SYSTEM = `You are the proofreader in NUUVI, a roleplay writing community. Writers send you a post, caption or comment. Fix spelling mistakes, typos, missing or wrong words, grammar and punctuation, so it reads cleanly.

Keep everything else exactly as it is:
- The writer's voice, tone, word choices and sentence rhythm. Don't rewrite, don't make it fancier, don't add or remove ideas.
- Deliberate style: slang, dialect, a character's way of speaking, stretched words ("nooo"), lowercase-on-purpose captions, swearing.
- Formatting codes, untouched: HTML tags, **markdown**, [b]forum codes[/b], line breaks, @mentions, #hashtags, links and emojis.
If nothing needs fixing, return the text unchanged.`;

const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'The corrected text.' },
    changes: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to 8 very short, plain notes on what was fixed (e.g. "their → there").',
    },
  },
  required: ['text', 'changes'],
  additionalProperties: false,
};

const TRANSLATE_SYSTEM = `You translate posts and comments from NUUVI, a roleplay writing community, into natural English. Keep the tone, slang and emotion (casual stays casual), and keep emojis, @mentions, #hashtags and links as they are. If the text is already English, return it unchanged.`;

const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string', description: 'The language it was written in, in English (e.g. "Korean").' },
    text: { type: 'string', description: 'The English translation.' },
  },
  required: ['language', 'text'],
  additionalProperties: false,
};

const RECAP_SYSTEM = `You write "Previously on…" recaps for episodes in NUUVI, a roleplay writing community where writers tell stories together through their characters. You get the episode's posts in order. Write a short recap that helps a writer catch up before they post next:
- 3 to 6 short paragraphs, plain and easy to read, in present tense, like a TV "previously on".
- Name the characters, say what happened, how things were left, and any open threads or tensions.
- Focus most on the latest posts. Don't invent anything that isn't in the posts.
- Plain text only (no headings, lists or formatting codes).`;

const RECAP_SCHEMA = {
  type: 'object',
  properties: { recap: { type: 'string' } },
  required: ['recap'],
  additionalProperties: false,
};

const RECAP_MIN_POSTS = 8;
const RECAP_MAX_CHARS = 150_000; // the most recent writing, if an episode is very long

export function aiRoutes(r, ctx) {
  const { db } = ctx;
  // Each use costs a little on the site's Anthropic account, so everyone gets a fair hourly share.
  const allow = createRateLimiter({ limit: 60, windowMs: 60 * 60 * 1000 });
  const ready = (user) => {
    requireUser(user);
    if (!ctx.ai?.enabled) fail(503, "Writing tools aren't switched on for this site");
    if (!allow(user.id)) fail(429, "You've used the writing tools a lot this hour. Try again a bit later.");
  };
  const failed = (err) => {
    console.error('AI request failed:', err.message);
    fail(502, "Claude couldn't be reached just now. Try again in a moment.");
  };

  r.get('/api/ai/status', ({ user }) => {
    requireUser(user);
    return { data: { enabled: !!ctx.ai?.enabled } };
  });

  r.post('/api/ai/check', async ({ user, body }) => {
    ready(user);
    const text = str(body.text, 'Text', { max: 20000 }) ?? '';
    if (!text.trim()) fail(400, 'Write something first');
    const out = await ctx.ai.ask({ system: CHECK_SYSTEM, schema: CHECK_SCHEMA, effort: 'low', content: text }).catch(failed);
    return { data: { text: out.text, changes: (out.changes || []).slice(0, 8), changed: out.text !== text } };
  });

  r.post('/api/ai/translate', async ({ user, body }) => {
    ready(user);
    const text = str(body.text, 'Text', { max: 5000 }) ?? '';
    if (!text.trim()) fail(400, 'Nothing to translate');
    const out = await ctx.ai
      .ask({ system: TRANSLATE_SYSTEM, schema: TRANSLATE_SCHEMA, effort: 'low', content: text })
      .catch(failed);
    return { data: { text: out.text, language: out.language } };
  });

  // The recap for an episode. Kept until someone posts again, so reading it again is free.
  r.post('/api/channels/:id/recap', async ({ user, params }) => {
    requireUser(user);
    const { channel } = channelAccess(db, params.id, user);
    const posts = db
      .prepare(
        `SELECT p.id, p.kind, p.body, c.name AS character_name, u.display_name
      FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN characters c ON c.id = p.character_id
      WHERE p.channel_id = ? AND p.kind != 'ooc' ORDER BY p.id`,
      )
      .all(channel.id);
    if (posts.length < RECAP_MIN_POSTS) fail(400, 'This episode is still short. Recaps start once it has a few more posts.');
    const last = posts.at(-1).id;
    const saved = db.prepare('SELECT * FROM channel_recaps WHERE channel_id = ?').get(channel.id);
    if (saved?.last_post_id === last) return { data: { recap: saved.body, createdAt: saved.created_at } };
    ready(user);
    // Newest writing first until the cap, then back into reading order.
    const parts = [];
    let size = 0;
    for (let i = posts.length - 1; i >= 0; i--) {
      const p = posts[i];
      const who = p.kind === 'narration' ? 'Narration' : p.character_name || p.display_name;
      const line = `${who}: ${plainText(String(p.body).replace(/<[^>]+>/g, ' '), 20000).trim()}`;
      if (size + line.length > RECAP_MAX_CHARS) break;
      parts.unshift(line);
      size += line.length;
    }
    const content = `Episode: ${channel.name}\n${parts.length < posts.length ? '(Only the most recent part of a long episode.)\n' : ''}\n${parts.join('\n\n')}`;
    const out = await ctx.ai.ask({ system: RECAP_SYSTEM, schema: RECAP_SCHEMA, content }).catch(failed);
    db.prepare(
      `INSERT INTO channel_recaps (channel_id, last_post_id, body) VALUES (?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET last_post_id = excluded.last_post_id, body = excluded.body, created_at = datetime('now')`,
    ).run(channel.id, last, out.recap);
    return { data: { recap: out.recap, createdAt: new Date().toISOString().slice(0, 19).replace('T', ' ') } };
  });
}
