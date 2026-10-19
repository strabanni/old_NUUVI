// Photo batches: a writer gives a supporting-cast character a set of 10 to 100 pictures, and the
// character posts them on THE NU by themselves, one every few days (3 to 7 by default), going round
// the set again until their writer gives them a new one.
import { fail, str } from '../http.js';
import { requireUser } from '../model.js';

const MIN_PHOTOS = 10;
const MAX_PHOTOS = 100;
const PICTURE = /^\/uploads\/([\w-]+\.(jpe?g|png|gif|webp|avif))$/i;
const CAPTION_SYSTEM = `You write the caption for a photo a supporting character is posting on THE NU, the Instagram-style feed inside NUUVI, a private roleplay writing community set in Ardell City (its version of New York). Look at the picture and write a short caption in the character's own voice, like a real post: it can be a few words, a feeling, a joke or just emojis. Match their writer's example lines if there are any. Never be cruel, hateful or sexual. Plain text.`;
const CAPTION_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
};

export function batchRoutes(r, ctx, { random = Math.random } = {}) {
  const { db } = ctx;
  const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const whenNext = (b, from = Date.now()) => sqlTime(from + (b.min_days + random() * (b.max_days - b.min_days)) * 86400e3);

  const toBatch = (b) =>
    b && {
      photos: JSON.parse(b.photos),
      nextIndex: b.next_index,
      posted: b.posted,
      minDays: b.min_days,
      maxDays: b.max_days,
      nextAt: b.next_at,
      paused: !!b.paused,
    };
  const batchOf = (id) => db.prepare('SELECT * FROM photo_batches WHERE character_id = ?').get(id);
  const ownNpc = (id, user) => {
    const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    if (!c || (c.user_id !== user.id && !user.isAdmin)) fail(404, 'Character not found');
    if (!c.npc) fail(400, 'Only supporting cast can post by themselves');
    return c;
  };
  const daysInput = (v, field) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 30) fail(400, `${field} must be a whole number of days from 1 to 30`);
    return n;
  };

  r.get('/api/characters/:id/batch', ({ user, params }) => {
    requireUser(user);
    const c = ownNpc(params.id, user);
    return { data: { batch: toBatch(batchOf(c.id)) ?? null, min: MIN_PHOTOS, max: MAX_PHOTOS } };
  });

  // A new set of pictures (starts over from the first), or just new timing / pause when no photos are sent.
  r.put('/api/characters/:id/batch', ({ user, params, body }) => {
    requireUser(user);
    const c = ownNpc(params.id, user);
    const old = batchOf(c.id);
    const minDays = body.minDays === undefined ? (old?.min_days ?? 3) : daysInput(body.minDays, 'Shortest gap');
    const maxDays = body.maxDays === undefined ? (old?.max_days ?? 7) : daysInput(body.maxDays, 'Longest gap');
    if (maxDays < minDays) fail(400, 'The longest gap must be at least the shortest gap');
    const paused = body.paused === undefined ? !!old?.paused : !!body.paused;
    if (body.photos === undefined) {
      if (!old) fail(400, 'Add some pictures first');
      const timingChanged = minDays !== old.min_days || maxDays !== old.max_days;
      db.prepare('UPDATE photo_batches SET min_days = ?, max_days = ?, paused = ?, next_at = ? WHERE character_id = ?').run(
        minDays,
        maxDays,
        paused ? 1 : 0,
        timingChanged ? whenNext({ min_days: minDays, max_days: maxDays }) : old.next_at,
        c.id,
      );
      return { data: { batch: toBatch(batchOf(c.id)) } };
    }
    if (!Array.isArray(body.photos) || body.photos.length < MIN_PHOTOS || body.photos.length > MAX_PHOTOS)
      fail(400, `A batch needs ${MIN_PHOTOS} to ${MAX_PHOTOS} pictures`);
    const photos = body.photos.map((p) => {
      const url = typeof p === 'string' ? p : p?.url;
      const m = typeof url === 'string' && url.match(PICTURE);
      if (!m || !db.prepare('SELECT 1 FROM uploads WHERE name = ? AND user_id = ?').get(m[1], user.id))
        fail(400, 'Upload the pictures first');
      return { url, caption: (str(p?.caption, 'Caption', { max: 2000 }) ?? '').trim() };
    });
    // The first one goes up within the hour; then every few days.
    db.prepare(
      `INSERT INTO photo_batches (character_id, photos, next_index, posted, min_days, max_days, next_at, paused)
      VALUES (?, ?, 0, 0, ?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET photos = excluded.photos, next_index = 0, posted = 0, min_days = excluded.min_days,
        max_days = excluded.max_days, next_at = excluded.next_at, paused = excluded.paused, created_at = datetime('now')`,
    ).run(c.id, JSON.stringify(photos), minDays, maxDays, sqlTime(Date.now() + 15 * 60e3), paused ? 1 : 0);
    return { data: { batch: toBatch(batchOf(c.id)) } };
  });

  r.delete('/api/characters/:id/batch', ({ user, params }) => {
    requireUser(user);
    const c = ownNpc(params.id, user);
    db.prepare('DELETE FROM photo_batches WHERE character_id = ?').run(c.id);
    return { data: { ok: true } };
  });

  // Post the next picture right away (the timer starts again from now).
  r.post('/api/characters/:id/batch/post', async ({ user, params }) => {
    requireUser(user);
    const c = ownNpc(params.id, user);
    const b = batchOf(c.id) ?? fail(400, 'Add some pictures first');
    const id = await postNext(c, b);
    return { data: { postId: id, batch: toBatch(batchOf(c.id)) } };
  });

  // A caption for a picture with none: Claude writes one when it's on (looking at the picture),
  // otherwise one of the character's own post lines, otherwise none.
  async function captionFor(c, url) {
    let lines = [];
    try {
      lines = JSON.parse(c.bot_lines || '{}').posts || [];
    } catch {
      /* none */
    }
    const picked = lines.length ? lines[Math.floor(random() * lines.length)].replace(/\{someone\}/g, 'someone') : '';
    if (!ctx.ai?.enabled || !ctx.aiBuzz?.pictures) return picked;
    try {
      const pictures = await ctx.aiBuzz.pictures({ kind: 'photo', media: JSON.stringify([url]) });
      const about = [
        `Character: ${c.name}${c.handle ? ` (@${c.handle})` : ''}.`,
        c.tagline ? `About them: ${c.tagline}` : '',
        lines.length
          ? `Their writer's example lines:\n${lines
              .slice(0, 10)
              .map((l) => `- ${l}`)
              .join('\n')}`
          : '',
        'Write the caption for this picture.',
      ]
        .filter(Boolean)
        .join('\n\n');
      const res = await ctx.ai.ask({
        system: CAPTION_SYSTEM,
        schema: CAPTION_SCHEMA,
        effort: 'low',
        content: [...pictures, { type: 'text', text: about }],
      });
      return String(res.text || '').trim() || picked;
    } catch {
      return picked;
    }
  }

  const busy = new Set(); // characters whose next picture is being posted
  async function postNext(c, b, now = Date.now()) {
    if (busy.has(c.id)) return null;
    busy.add(c.id);
    try {
      const photos = JSON.parse(b.photos);
      const i = b.next_index % photos.length;
      const { url, caption } = photos[i];
      const body = (caption || (await captionFor(c, url))).slice(0, 5000);
      // The set may have been replaced while the caption was being written.
      const still = batchOf(c.id);
      if (!still || still.photos !== b.photos || still.next_index !== b.next_index) return null;
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO social_posts (character_id, user_id, kind, body, media, created_at)
          VALUES (?, ?, 'photo', ?, ?, COALESCE(?, datetime('now')))`,
        )
        .run(c.id, c.user_id, body, JSON.stringify([url]), ctx.storyNow());
      const next = (i + 1) % photos.length;
      db.prepare('UPDATE photo_batches SET next_index = ?, posted = posted + 1, next_at = ? WHERE character_id = ?').run(
        next,
        whenNext(b, now),
        c.id,
      );
      const postId = Number(lastInsertRowid);
      ctx.buzzFor?.(postId);
      ctx.bots?.onSocialPost(postId);
      // Gone through every picture: let the writer know it starts again from the first.
      if (next === 0) {
        ctx.notify({
          userId: c.user_id,
          type: 'batch',
          characterId: c.id,
          text: `${c.name} has posted every picture in their batch. They'll start again from the first one until you give them a new batch.`,
        });
      }
      return postId;
    } finally {
      busy.delete(c.id);
    }
  }

  // Called every few minutes: anyone whose next picture is due posts it.
  ctx.batches = {
    tick(now = Date.now()) {
      if (ctx.bots && !ctx.bots.settings().enabled) return;
      const due = db
        .prepare(
          `SELECT b.*, c.id AS cid FROM photo_batches b JOIN characters c ON c.id = b.character_id
          WHERE b.paused = 0 AND b.next_at <= ? AND c.npc = 1 AND c.status IS NULL`,
        )
        .all(sqlTime(now));
      for (const b of due) {
        const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(b.cid);
        postNext(c, b, now).catch((err) => console.error('photo batch', err));
      }
    },
  };
}
