// NV-32: what each tagged person is to the poster (and whether they're in the picture), and a private
// "behind the post" note, both steering the fan comments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { makeComments } from '../server/buzz.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const mk = async (who, name) =>
  (await who('/api/characters', { method: 'POST', body: { name, color: '#8fa3c9' } })).data.character;

test('tagged people and the behind-the-post note are saved; only the writer sees the note', async () => {
  const a = await app.signUp('rel_writer');
  const b = await app.signUp('rel_reader');
  const ca = await mk(a, 'Mina Park');
  const cb = await mk(b, 'Cha Yoonoh');
  await b(`/api/characters/${cb.id}`, { method: 'PUT', body: { handle: 'chayoonoh' } });
  const body = {
    characterId: ca.id,
    body: 'dinner with @chayoonoh',
    context: 'first date, she is nervous',
    people: [
      { handle: '@chayoonoh', rel: 'partner', inPicture: true },
      { handle: 'bad name', rel: 'nonsense' },
    ],
  };
  const p = (await a('/api/social', { method: 'POST', body })).data.post;
  assert.deepEqual(p.meta.people, { chayoonoh: { handle: 'chayoonoh', rel: 'partner', in: true } });
  assert.equal(p.meta.tagged, true);
  assert.equal(p.meta.context, 'first date, she is nervous');
  const seen = (await b(`/api/social/${p.id}`)).data.post;
  assert.equal(seen.meta.context, undefined, 'the note is private');
  assert.equal(seen.meta.people.chayoonoh.rel, 'partner');
  // Editing other things keeps them; clearing works.
  const kept = (await a(`/api/social/${p.id}`, { method: 'PUT', body: { location: 'The Atlas' } })).data.post;
  assert.equal(kept.meta.people.chayoonoh.rel, 'partner');
  assert.equal(kept.meta.context, 'first date, she is nervous');
  const cleared = (
    await a(`/api/social/${p.id}`, {
      method: 'PUT',
      body: { context: '', people: [{ handle: 'chayoonoh', rel: 'ex', inPicture: false }] },
    })
  ).data.post;
  assert.equal(cleared.meta.context, undefined);
  assert.equal(cleared.meta.people.chayoonoh.rel, 'ex');
  assert.equal(cleared.meta.tagged, undefined);
});

test('built-in fan comments use what the tagged person is to the poster', () => {
  const post = {
    id: 7,
    kind: 'photo',
    body: 'night out @hana',
    media: '[]',
    meta: JSON.stringify({ people: { hana: { handle: 'hana', rel: 'ex', in: false } } }),
  };
  const all = [];
  for (let seed = 1; seed < 40; seed++)
    all.push(...makeComments(post, { name: 'Jun' }, 12, { mentions: ['@hana'], seed }).map((c) => c.body));
  const exLines = all.filter((t) => /after everything|thought that was over|being tagged 😭/.test(t));
  assert.ok(exLines.length > 0, 'some comments talk about the ex');
  assert.ok(!all.some((t) => /you and @hana are so cute|couple goals/.test(t)), 'no partner lines for an ex');
  assert.ok(
    !all.some((t) => /@hana (looks so good here|in the pics|photobombing)/.test(t)),
    'never says an untagged-in-picture person is in it',
  );
});

test('near-identical fan comments count as the same', async () => {
  const { sameness } = await import('../server/ai-buzz.js');
  assert.equal(sameness('omg the lighting!! 😍'), sameness('THE LIGHTING 😭'));
  assert.equal(sameness('soooo pretty fr'), sameness('so pretty'));
  assert.notEqual(sameness('love the jacket'), sameness('love the shoes'));
});

test("a quick second edit wins: the first edit's comments never land", async () => {
  const client = {
    beta: {
      messages: {
        async create(req) {
          await new Promise((r) => setTimeout(r, 150));
          const all = req.messages[0].content.map((b) => b.text || '').join(' ');
          const cap = all.match(/Caption: "([^"]*)"/)?.[1];
          const n = Number(req.messages[0].content.at(-1).text.match(/exactly (\d+)/)[1]);
          return {
            stop_reason: 'end_turn',
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  scene: '',
                  comments: Array.from({ length: n }, (_, i) => ({
                    handle: `f${i}`,
                    text: `${cap} comment number ${i}`,
                    mood: 'love',
                  })),
                }),
              },
            ],
          };
        },
      },
    },
  };
  const ai = await startApp({ ai: { client } });
  try {
    const w = await ai.signUp('quick_editor');
    const c = (await w('/api/characters', { method: 'POST', body: { name: 'Jun', color: '#c97a96' } })).data.character;
    // A famous character with an automatic comment number (8 fan comments).
    await w(`/api/characters/${c.id}`, { method: 'PUT', body: { followersDisplay: 1000000 } });
    const p = (await w('/api/social', { method: 'POST', body: { characterId: c.id, body: 'first' } })).data.post;
    await w(`/api/social/${p.id}`, { method: 'PUT', body: { body: 'second', freshComments: true } });
    await w(`/api/social/${p.id}`, { method: 'PUT', body: { body: 'third', freshComments: true } });
    let post;
    for (let i = 0; i < 100; i++) {
      post = (await w(`/api/social/${p.id}`)).data.post;
      if (!post.buzzPending) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    await new Promise((r) => setTimeout(r, 400)); // let any older run finish
    post = (await w(`/api/social/${p.id}`)).data.post;
    assert.equal(post.buzz.length, 8);
    assert.ok(
      post.buzz.every((b) => b.body.startsWith('third ')),
      JSON.stringify(post.buzz.map((b) => b.body)),
    );
    assert.equal(new Set(post.buzz.map((b) => b.body)).size, post.buzz.length);
  } finally {
    ai.close();
  }
});

test('character usernames can have special characters, and @mentions of them work', async () => {
  const a = await app.signUp('special_handles');
  const b = await app.signUp('special_tagged');
  const ca = await mk(a, 'Rose');
  const cb = await mk(b, 'Mina');
  const ok = await b(`/api/characters/${cb.id}`, { method: 'PUT', body: { handle: 'mina♡˚-ø' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.character.handle, 'mina♡˚-ø');
  for (const bad of ['mi na', 'mi@na', 'a#b', '<b>', 'x'.repeat(31)]) {
    assert.equal((await b(`/api/characters/${cb.id}`, { method: 'PUT', body: { handle: bad } })).status, 400, bad);
  }
  // Mentioned with punctuation after it: still the right person, and they hear about it.
  await a('/api/social', { method: 'POST', body: { characterId: ca.id, body: 'brunch with @mina♡˚-ø!!' } });
  const notes = (await b('/api/notifications')).data.notifications;
  assert.ok(
    notes.some((n) => n.type === 'socialtag' && n.text.startsWith('Rose tagged Mina')),
    JSON.stringify(notes),
  );
});

test('fan usernames are a mix, not mostly Korean names', () => {
  const post = { id: 3, kind: 'text', body: 'good morning', media: '[]', meta: '{}' };
  const names = makeComments(post, { name: 'Jun' }, 200, { seed: 5 }).map((c) => c.handle);
  const korean = names.filter((h) => /^(yuna|jae|dae|hyun|mina|yuri|roro|jiwoo|seo|minji|haru)/.test(h));
  assert.equal(korean.length, 0, korean.join(', '));
});

test("your character's comment can be edited (words and date); nobody else's", async () => {
  const a = await app.signUp('comment_editor');
  const b = await app.signUp('comment_other');
  const ca = await mk(a, 'Rose');
  const cb = await mk(b, 'Theo');
  const p = (await b('/api/social', { method: 'POST', body: { characterId: cb.id, body: 'sunset' } })).data.post;
  const after = (await a(`/api/social/${p.id}/comments`, { method: 'POST', body: { characterId: ca.id, body: 'so pretty' } }))
    .data.post;
  const cid = after.comments[0].id;
  const edited = await a(`/api/social/comments/${cid}`, {
    method: 'PUT',
    body: { body: 'so pretty!! wish i was there', postedAt: '2025-03-01T18:00:00.000Z' },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  const cm = edited.data.post.comments.find((c) => c.id === cid);
  assert.equal(cm.body, 'so pretty!! wish i was there');
  assert.equal(cm.createdAt, '2025-03-01 18:00:00');
  // The post's writer can delete it but not change the words.
  assert.equal((await b(`/api/social/comments/${cid}`, { method: 'PUT', body: { body: 'hacked' } })).status, 404);
  assert.equal((await a(`/api/social/comments/${cid}`, { method: 'PUT', body: { body: '' } })).status, 400);
});

test('song links become players on the profile; up to 20 gallery pictures', async () => {
  const { playlistEmbed } = await import('../server/routes/profiles.js');
  assert.deepEqual(playlistEmbed('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc'), {
    url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc',
    service: 'spotify',
    size: 'tall',
    embed: 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M',
  });
  assert.equal(
    playlistEmbed('https://open.spotify.com/intl-fr/track/4uLU6hMCjMI75M1A2tKUQC').embed,
    'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC',
  );
  assert.equal(
    playlistEmbed('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb').embed,
    'https://embed.music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb',
  );
  assert.equal(
    playlistEmbed('https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG').embed,
    'https://www.youtube-nocookie.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
  );
  assert.equal(playlistEmbed('https://youtu.be/dQw4w9WgXcQ').embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.match(
    playlistEmbed('https://soundcloud.com/artist/sets/late-nights').embed,
    /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Fartist%2Fsets%2Flate-nights/,
  );
  assert.throws(() => playlistEmbed('https://evil.example/playlist'));
  assert.throws(() => playlistEmbed('javascript:alert(1)'));

  const w = await app.signUp('playlist_owner');
  const c = await mk(w, 'Nova');
  // Each song can have its own link, shown as a little player; a song without one stays text.
  const songs = [
    { title: 'MR RECOUP', artist: '21 Savage, Drake', link: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x' },
    { title: 'Clarity', artist: 'Zedd, Foxes' },
    { title: '', artist: '', link: 'https://youtu.be/dQw4w9WgXcQ' },
    { title: '', artist: '' },
  ];
  const saved = await w(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier: { playlist: songs } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const pl = saved.data.dossier.playlist;
  assert.equal(pl.length, 3, 'the empty song is dropped');
  assert.equal(pl[0].link.embed, 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(pl[1].link, undefined);
  assert.equal(pl[2].link.service, 'youtube');
  assert.equal(
    (
      await w(`/api/profiles/${c.id}`, {
        method: 'PUT',
        body: { dossier: { playlist: [{ title: 'x', link: 'https://example.com/x' }] } },
      })
    ).status,
    400,
  );
  // Up to 20 gallery pictures.
  const pic = (
    await w('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      raw: Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'),
    })
  ).data.url;
  const g = await w(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier: { gallery: Array(25).fill(pic) } } });
  assert.equal(g.data.dossier.gallery.length, 20);
  const csp = (await w('/')).headers.get('content-security-policy');
  assert.match(csp, /frame-src [^;]*https:\/\/open\.spotify\.com/);
});

test("deceased / missing in action characters keep their profile but can't be played", async () => {
  const w = await app.signUp('status_writer');
  const c = await mk(w, 'Eli');
  const other = await mk(w, 'Ana');
  const post = (await w('/api/social', { method: 'POST', body: { characterId: other.id, body: 'hi' } })).data.post;
  const set = await w(`/api/characters/${c.id}`, { method: 'PUT', body: { status: 'deceased' } });
  assert.equal(set.status, 200, JSON.stringify(set.data));
  assert.equal(set.data.character.status, 'deceased');
  assert.equal(set.data.character.npc, false, 'not an NPC');
  assert.equal((await w(`/api/characters/${c.id}`)).data.character.status, 'deceased');
  // No new posts, comments, likes or follows as them.
  const p = await w('/api/social', { method: 'POST', body: { characterId: c.id, body: 'from beyond' } });
  assert.equal(p.status, 400);
  assert.match(p.data.error, /deceased/);
  assert.equal(
    (await w(`/api/social/${post.id}/comments`, { method: 'POST', body: { characterId: c.id, body: 'boo' } })).status,
    400,
  );
  assert.equal((await w(`/api/social/${post.id}/like`, { method: 'POST', body: { asCharacterId: c.id } })).status, 400);
  // Missing in action works the same; back to playable unlocks them.
  await w(`/api/characters/${c.id}`, { method: 'PUT', body: { status: 'mia' } });
  assert.match(
    (await w('/api/social', { method: 'POST', body: { characterId: c.id, body: 'x' } })).data.error,
    /missing in action/,
  );
  assert.equal((await w(`/api/characters/${c.id}`, { method: 'PUT', body: { status: 'zombie' } })).status, 400);
  await w(`/api/characters/${c.id}`, { method: 'PUT', body: { status: '' } });
  assert.equal((await w('/api/social', { method: 'POST', body: { characterId: c.id, body: "i'm back" } })).status, 201);
});

test("unticking characters in an episode's cast removes them; others stay", async () => {
  const w = await app.signUp('cast_editor');
  const a = await mk(w, 'Aedan');
  const b = await mk(w, 'Charlotte');
  const c = await mk(w, 'Camille');
  const story = (await w('/api/stories', { method: 'POST', body: { title: 'Cast test', visibility: 'private' } })).data.story;
  const ch = (
    await w(`/api/stories/${story.id}/channels`, {
      method: 'POST',
      body: { name: 'ep', kind: 'thread', tagged: [a.id, b.id, c.id] },
    })
  ).data.channel;
  const cast = async () => (await w(`/api/channels/${ch.id}`)).data.participants.map((p) => p.name).sort();
  assert.deepEqual(await cast(), ['Aedan', 'Camille', 'Charlotte']);
  const saved = await w(`/api/channels/${ch.id}`, {
    method: 'PUT',
    body: { name: 'ep', tagged: [a.id, b.id], untagged: [c.id] },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(await cast(), ['Aedan', 'Charlotte']);
  // Saving without untagged (older app) still never removes anyone.
  await w(`/api/channels/${ch.id}`, { method: 'PUT', body: { name: 'ep', tagged: [a.id] } });
  assert.deepEqual(await cast(), ['Aedan', 'Charlotte']);
});

test('character plans on the calendar: add, see, edit, private, delete', async () => {
  const a = await app.signUp('plan_writer');
  const b = await app.signUp('plan_reader');
  const ca = await mk(a, 'Aedan');
  const cb = await mk(b, 'Theo');
  const made = await a('/api/plans', {
    method: 'POST',
    body: {
      characterId: ca.id,
      kind: 'doctor',
      title: 'Check-up at Ardell General',
      startsAt: '2026-10-20T15:00:00.000Z',
      endsAt: '2026-10-20T16:00:00.000Z',
      location: 'Montclair Harbor',
    },
  });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.plan.character.name, 'Aedan');
  // A weekly work shift, kept private.
  const shift = (
    await a('/api/plans', {
      method: 'POST',
      body: { kind: 'work', title: 'Bar shift', startsAt: '2026-10-16T22:00:00.000Z', repeat: 'weekly', private: true },
    })
  ).data.plan;
  assert.equal(shift.repeat, 'weekly');
  // Others see the public one only.
  const seen = (await b('/api/plans')).data.plans.map((p) => p.title);
  assert.ok(seen.includes('Check-up at Ardell General'));
  assert.ok(!seen.includes('Bar shift'));
  assert.equal((await a('/api/plans')).data.plans.length >= 2, true);
  // Only the writer edits; can't use someone else's character; bad input refused.
  assert.equal((await b(`/api/plans/${made.data.plan.id}`, { method: 'PUT', body: { title: 'x' } })).status, 403);
  assert.equal(
    (await a('/api/plans', { method: 'POST', body: { characterId: cb.id, title: 'x', startsAt: '2026-10-20T15:00:00Z' } }))
      .status,
    400,
  );
  assert.equal(
    (
      await a('/api/plans', {
        method: 'POST',
        body: { title: 'x', startsAt: '2026-10-20T15:00:00Z', endsAt: '2026-10-19T15:00:00Z' },
      })
    ).status,
    400,
  );
  const edited = (
    await a(`/api/plans/${made.data.plan.id}`, { method: 'PUT', body: { title: 'Surgery follow-up', kind: 'surgery' } })
  ).data.plan;
  assert.equal(edited.title, 'Surgery follow-up');
  assert.equal(edited.location, 'Montclair Harbor');
  assert.equal((await a(`/api/plans/${made.data.plan.id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await b('/api/plans')).data.plans.some((p) => p.id === made.data.plan.id));
});

test('security: headers, common passwords refused, too many wrong passwords lock the account a while', async () => {
  const res = await fetch(app.base + '/');
  for (const h of [
    'content-security-policy',
    'cross-origin-opener-policy',
    'x-frame-options',
    'x-content-type-options',
    'referrer-policy',
  ])
    assert.ok(res.headers.get(h), h);
  assert.match(res.headers.get('content-security-policy'), /object-src 'none'/);
  // Very common passwords can't be used.
  const code = (await app.admin('/api/admin/invites', { method: 'POST', body: {} })).data.code;
  const c = app.client();
  const weak = await c('/api/auth/register', {
    method: 'POST',
    body: { username: 'weakling', password: 'password123', invite: code },
  });
  assert.equal(weak.status, 400);
  assert.match(weak.data.error, /too easy/);
  // Wrong passwords for one account, even from "different places", lock it for a while.
  const limited = await (await import('./helpers.js')).startApp({ authRateLimit: 20 });
  try {
    await limited.signUp('lockme');
    let last;
    for (let i = 0; i < 12; i++)
      last = await limited.client()('/api/auth/login', {
        method: 'POST',
        body: { username: 'lockme', password: `wrong guess ${i}` },
      });
    assert.equal(last.status, 429, JSON.stringify(last.data));
    const right = await limited.client()('/api/auth/login', {
      method: 'POST',
      body: { username: 'lockme', password: 'correct horse' },
    });
    assert.equal(right.status, 429, 'still waiting, even with the right password');
  } finally {
    limited.close();
  }
});
