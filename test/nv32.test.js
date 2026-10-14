// NV-32: what each tagged person is to the poster (and whether they're in the picture), and a private
// "behind the post" note, both steering the fan comments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { makeComments } from '../server/buzz.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

const mk = async (who, name) => (await who('/api/characters', { method: 'POST', body: { name, color: '#8fa3c9' } })).data.character;

test('tagged people and the behind-the-post note are saved; only the writer sees the note', async () => {
  const a = await app.signUp('rel_writer');
  const b = await app.signUp('rel_reader');
  const ca = await mk(a, 'Mina Park');
  const cb = await mk(b, 'Cha Yoonoh');
  await b(`/api/characters/${cb.id}`, { method: 'PUT', body: { handle: 'chayoonoh' } });
  const body = { characterId: ca.id, body: 'dinner with @chayoonoh', context: 'first date, she is nervous',
    people: [{ handle: '@chayoonoh', rel: 'partner', inPicture: true }, { handle: 'bad name', rel: 'nonsense' }] };
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
  const cleared = (await a(`/api/social/${p.id}`, { method: 'PUT', body: { context: '', people: [{ handle: 'chayoonoh', rel: 'ex', inPicture: false }] } })).data.post;
  assert.equal(cleared.meta.context, undefined);
  assert.equal(cleared.meta.people.chayoonoh.rel, 'ex');
  assert.equal(cleared.meta.tagged, undefined);
});

test('built-in fan comments use what the tagged person is to the poster', () => {
  const post = { id: 7, kind: 'photo', body: 'night out @hana', media: '[]',
    meta: JSON.stringify({ people: { hana: { handle: 'hana', rel: 'ex', in: false } } }) };
  const all = [];
  for (let seed = 1; seed < 40; seed++) all.push(...makeComments(post, { name: 'Jun' }, 12, { mentions: ['@hana'], seed }).map((c) => c.body));
  const exLines = all.filter((t) => /after everything|thought that was over|being tagged 😭/.test(t));
  assert.ok(exLines.length > 0, 'some comments talk about the ex');
  assert.ok(!all.some((t) => /you and @hana are so cute|couple goals/.test(t)), 'no partner lines for an ex');
  assert.ok(!all.some((t) => /@hana (looks so good here|in the pics|photobombing)/.test(t)), 'never says an untagged-in-picture person is in it');
});

test('near-identical fan comments count as the same', async () => {
  const { sameness } = await import('../server/ai-buzz.js');
  assert.equal(sameness('omg the lighting!! 😍'), sameness('THE LIGHTING 😭'));
  assert.equal(sameness('soooo pretty fr'), sameness('so pretty'));
  assert.notEqual(sameness('love the jacket'), sameness('love the shoes'));
});

test('a quick second edit wins: the first edit\'s comments never land', async () => {
  const client = { beta: { messages: { async create(req) {
    await new Promise((r) => setTimeout(r, 150));
    const all = req.messages[0].content.map((b) => b.text || '').join(' ');
    const cap = all.match(/Caption: "([^"]*)"/)?.[1];
    const n = Number(req.messages[0].content.at(-1).text.match(/exactly (\d+)/)[1]);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ scene: '', comments: Array.from({ length: n }, (_, i) => ({ handle: `f${i}`, text: `${cap} comment number ${i}`, mood: 'love' })) }) }] };
  } } } };
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
    for (let i = 0; i < 100; i++) { post = (await w(`/api/social/${p.id}`)).data.post; if (!post.buzzPending) break; await new Promise((r) => setTimeout(r, 25)); }
    await new Promise((r) => setTimeout(r, 400)); // let any older run finish
    post = (await w(`/api/social/${p.id}`)).data.post;
    assert.equal(post.buzz.length, 8);
    assert.ok(post.buzz.every((b) => b.body.startsWith('third ')), JSON.stringify(post.buzz.map((b) => b.body)));
    assert.equal(new Set(post.buzz.map((b) => b.body)).size, post.buzz.length);
  } finally { ai.close(); }
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
  assert.ok(notes.some((n) => n.type === 'socialtag' && n.text.startsWith('Rose tagged Mina')), JSON.stringify(notes));
});

test('fan usernames are a mix, not mostly Korean names', () => {
  const post = { id: 3, kind: 'text', body: 'good morning', media: '[]', meta: '{}' };
  const names = makeComments(post, { name: 'Jun' }, 200, { seed: 5 }).map((c) => c.handle);
  const korean = names.filter((h) => /^(yuna|jae|dae|hyun|mina|yuri|roro|jiwoo|seo|minji|haru)/.test(h));
  assert.equal(korean.length, 0, korean.join(', '));
});

test('your character\'s comment can be edited (words and date); nobody else\'s', async () => {
  const a = await app.signUp('comment_editor');
  const b = await app.signUp('comment_other');
  const ca = await mk(a, 'Rose');
  const cb = await mk(b, 'Theo');
  const p = (await b('/api/social', { method: 'POST', body: { characterId: cb.id, body: 'sunset' } })).data.post;
  const after = (await a(`/api/social/${p.id}/comments`, { method: 'POST', body: { characterId: ca.id, body: 'so pretty' } })).data.post;
  const cid = after.comments[0].id;
  const edited = await a(`/api/social/comments/${cid}`, { method: 'PUT', body: { body: 'so pretty!! wish i was there', postedAt: '2025-03-01T18:00:00.000Z' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  const cm = edited.data.post.comments.find((c) => c.id === cid);
  assert.equal(cm.body, 'so pretty!! wish i was there');
  assert.equal(cm.createdAt, '2025-03-01 18:00:00');
  // The post's writer can delete it but not change the words.
  assert.equal((await b(`/api/social/comments/${cid}`, { method: 'PUT', body: { body: 'hacked' } })).status, 404);
  assert.equal((await a(`/api/social/comments/${cid}`, { method: 'PUT', body: { body: '' } })).status, 400);
});
