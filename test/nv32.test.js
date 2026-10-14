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
    people: [{ handle: '@chayoonoh', rel: 'partner', inPicture: true }, { handle: 'x', rel: 'nonsense' }] };
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
