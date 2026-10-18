// Fan comments written by Claude, who actually looks at the post's pictures (and reads the caption,
// place, song and who's tagged). Turned on by setting ANTHROPIC_API_KEY; without it, NUUVI uses the
// built-in comment writer in buzz.js.
//
// It runs in the background: the post saves straight away, and the comments arrive a little later
// (the writer's open page refreshes by itself when they do).
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setBuzz, insertBuzz, mentionedHandles, pronounSet } from './buzz.js';

const PER_CALL = 50; // comments per request
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // the API's limit for one picture
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

const SYSTEM = `You write the fan comments under posts on THE NU, the Instagram-style social feed inside NUUVI, a private roleplay writing community. The characters are fictional people living in Ardell City (NUUVI's version of New York). The commenters are their fans and followers: ordinary social media users.

Write comments the way real people comment on Instagram:
- Mostly lowercase, short (often 2-12 words), slang, emojis now and then, the odd typo. Some longer ones.
- A natural mix: mostly fans and hype, plus jokes, questions, people tagging friends, lukewarm takes and a few mild critics or haters. Never cruel, hateful or sexual.
- React to what is actually in the pictures: the outfit, the place, the light, the food, the people, the mood, small details. When there are pictures, most comments should be about them.
- Only say a tagged (@) person is in the picture if the post says they are. When it says what a tagged person is to the poster (partner, ex, rival…), comments should fit that.
- If there's a private note on what's really going on, use it to understand the post, but don't repeat it.
- Mention the location or the song only occasionally.
- Every comment must be different. Don't repeat the same idea in different words.
- Use the character's pronouns correctly.
- Each commenter gets a believable made-up username (letters, numbers, dots, underscores; no @). Ardell City is a melting pot like New York, so the commenters come from every background: Black, Latino, white, South Asian, Middle Eastern, African, East and Southeast Asian, European and more, mixed naturally. Don't lean on Korean or any one group's names.`;

const SCHEMA = {
  type: 'object',
  properties: {
    scene: {
      type: 'string',
      description: 'One or two plain sentences describing what is in the pictures (empty if there are none).',
    },
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          handle: { type: 'string' },
          text: { type: 'string' },
          mood: { type: 'string', enum: ['love', 'fun', 'ask', 'meh', 'shade'] },
        },
        required: ['handle', 'text', 'mood'],
        additionalProperties: false,
      },
    },
  },
  required: ['scene', 'comments'],
  additionalProperties: false,
};

// What different batches focus on, so a big set doesn't say the same things.
const ANGLES = [
  'a broad mix of everyone',
  'mostly excited fans gushing about specific details',
  'mostly jokes, banter and people tagging their friends',
  'mostly questions (where, what, who, when) and curious people',
  'a mix of lukewarm takes, mild critics and a few defenders replying to them',
  'mostly long-time followers who feel they know the character',
  'mostly people noticing small details others missed',
  'mostly short reactions and emoji-heavy comments',
];

// One line per tagged person: what they are to the poster and whether they're in the picture.
function taggedLines(tagged, people) {
  return `Tagged:\n${tagged
    .map((h) => {
      const p = people[h.slice(1).toLowerCase()] || {};
      return `- ${h}${p.rel ? `, the poster's ${p.rel === 'bestie' ? 'best friend' : p.rel === 'groupmate' ? 'group/band mate' : p.rel}` : ''}. ${p.in ? 'IS in the picture.' : 'is NOT in the picture (only mentioned).'}`;
    })
    .join('\n')}`;
}

// Two comments count as the same when only emojis, punctuation, capitals or little filler words differ.
const FILLER =
  /\b(ok|okay|omg|ngl|lol|lmao|fr|tbh|istg|wait|honestly|lowkey|stop|girl|bro|so|sooo+|really|literally|just|the|a|an)\b/g;
export function sameness(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(FILLER, ' ')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createAiBuzz({ db, hub, uploadDir, ai }) {
  const enabled = !!ai?.enabled;
  const runs = new Map(); // post id → the latest run (an edit while one is running replaces it)

  async function pictureBlocks(post) {
    if (!['photo', 'stream'].includes(post.kind)) return [];
    let media = [];
    try {
      media = JSON.parse(post.media || '[]');
    } catch {
      /* none */
    }
    const out = [];
    for (const url of media.slice(0, MAX_IMAGES)) {
      if (/^https:\/\//.test(url)) {
        out.push({ type: 'image', source: { type: 'url', url } });
        continue;
      }
      const m = String(url).match(/^\/uploads\/([\w-]+\.([a-z0-9]+))$/);
      const type = m && IMAGE_TYPES[m[2]];
      if (!type) continue;
      const file = join(uploadDir, m[1]);
      try {
        if ((await stat(file)).size > MAX_IMAGE_BYTES) continue;
        out.push({
          type: 'image',
          source: { type: 'base64', media_type: type, data: (await readFile(file)).toString('base64') },
        });
      } catch {
        /* file gone */
      }
    }
    return out;
  }

  function describe(post) {
    const c =
      db
        .prepare(
          'SELECT name, handle, pronouns, brand, COALESCE(followers_display, (SELECT COUNT(*) FROM character_follows WHERE followed_id = characters.id)) AS followers FROM characters WHERE id = ?',
        )
        .get(post.character_id) || {};
    let meta = {};
    try {
      meta = JSON.parse(post.meta || '{}');
    } catch {
      /* none */
    }
    const p = pronounSet(c.pronouns);
    const tagged = mentionedHandles(db, post);
    const lines = [
      c.brand
        ? `Posted by the brand account ${c.name || 'a brand'}${c.handle ? ` (@${c.handle})` : ''} (a business, not a person), ${Number(c.followers || 0).toLocaleString('en-US')} followers. The commenters are its customers and followers: they talk about the product, the shop, prices, drops, service and collabs, not about the brand as a person.`
        : `Posted by ${c.name || 'a character'}${c.handle ? ` (@${c.handle})` : ''}, pronouns ${p.sub}/${p.obj}, ${Number(c.followers || 0).toLocaleString('en-US')} followers.`,
      `Kind of post: ${post.category === 'musing' ? 'a musing (a written thought)' : post.kind}.`,
      `Caption: ${post.body ? `"${post.body}"` : '(none)'}`,
      post.title ? `Stream title: "${post.title}"` : '',
      post.location ? `Location tag: ${post.location}` : '',
      meta.music?.title ? `Song on the post: "${meta.music.title}"${meta.music.artist ? ` by ${meta.music.artist}` : ''}` : '',
      tagged.length
        ? meta.people
          ? taggedLines(tagged, meta.people)
          : `Tagged: ${tagged.join(', ')}. ${meta.tagged ? 'They ARE in the picture.' : 'They are NOT in the picture (only mentioned).'}`
        : '',
      meta.context
        ? `What's really going on (a private note from the writer, so the comments make sense — never quote it or reveal it word for word): ${meta.context}`
        : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  const ask = (content, count, angle) =>
    ai.ask({
      system: SYSTEM,
      schema: SCHEMA,
      content: [...content, { type: 'text', text: `Write exactly ${count} comments. This batch: ${angle}.` }],
    });

  // Writes `count` comments for a post and swaps them in for whatever it has.
  async function write(post, count) {
    const pictures = await pictureBlocks(post);
    const about = { type: 'text', text: describe(post) };
    const seen = new Set();
    const handles = new Set();
    const comments = [];
    const take = (list) => {
      for (const c of list || []) {
        const body = String(c.text || '')
          .trim()
          .slice(0, 300);
        const key = sameness(body);
        if (!body || !key || seen.has(key)) continue;
        seen.add(key);
        let handle =
          String(c.handle || '')
            .replace(/[^\w.]/g, '')
            .slice(0, 30) || 'fan';
        while (handles.has(handle.toLowerCase())) handle = `${handle.slice(0, 27)}${Math.floor(Math.random() * 90) + 10}`;
        handles.add(handle.toLowerCase());
        comments.push({ handle, body, mood: c.mood });
      }
    };
    // The first batch looks at the pictures and says what's in them; the rest work from that note,
    // one after another, each told what's already been said so nothing gets said twice.
    const first = await ask([...pictures, about], Math.min(PER_CALL, count), ANGLES[0]);
    const scene = String(first.scene || '').slice(0, 600);
    take(first.comments);
    const note = { type: 'text', text: scene ? `What's in the pictures: ${scene}` : 'There are no pictures.' };
    for (let i = 1, tries = 0; comments.length < count && tries < Math.ceil(count / PER_CALL) + 2; i++, tries++) {
      const said = {
        type: 'text',
        text: `Already written (don't repeat these or say the same thing in other words):\n${comments
          .slice(-150)
          .map((c) => `- ${c.body}`)
          .join('\n')}`,
      };
      const more = await ask([about, note, said], Math.min(PER_CALL, count - comments.length), ANGLES[i % ANGLES.length]).catch(
        () => null,
      );
      if (!more) break;
      take(more.comments);
    }
    return { comments: comments.slice(0, count), scene };
  }

  return {
    enabled,
    pending: (id) => runs.has(id),
    // How many comments the run in progress is writing (0 when none is).
    pendingCount: (id) => runs.get(id)?.count ?? 0,
    // Replaces a post's fan comments with `count` new ones (old ones go now). Returns the run.
    queue(post, count, { followers = 0 } = {}) {
      db.prepare('DELETE FROM social_buzz WHERE post_id = ?').run(post.id);
      // Any run still writing for an older version of the post is dropped (its comments never land).
      runs.delete(post.id);
      if (count <= 0) return null;
      const token = { count };
      const run = (async () => {
        let result = null;
        try {
          result = await write(post, count);
        } catch (err) {
          console.error('AI comments failed, using the built-in writer:', err.message);
        }
        if (runs.get(post.id) !== token) return; // edited again since: that run wins
        const row = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(post.id);
        if (row) {
          if (result?.comments.length) {
            db.prepare('DELETE FROM social_buzz WHERE post_id = ?').run(row.id);
            insertBuzz(db, row, result.comments, { followers });
            if (result.scene) {
              const meta = { ...JSON.parse(row.meta || '{}'), seen: result.scene };
              db.prepare('UPDATE social_posts SET meta = ? WHERE id = ?').run(JSON.stringify(meta), row.id);
            }
          } else {
            setBuzz(db, row, count, { followers });
          }
        }
        runs.delete(post.id);
        if (row) hub?.sendUser(row.user_id, 'buzz', { postId: row.id });
      })();
      token.done = run;
      runs.set(post.id, token);
      return run;
    },
  };
}
