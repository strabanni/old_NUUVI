// NV-90: drafts (THE NU posts saved for later) and the suggestion box.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const mk = async (who, name) =>
  (await who('/api/characters', { method: 'POST', body: { name, color: '#8fa3c9' } })).data.character;

test('drafts: saved for your own characters only, private, changed, then posted', async () => {
  const owner = await app.signUp('dr_owner');
  const a = await app.signUp('dr_writer');
  const b = await app.signUp('dr_other');
  const ca = await mk(a, 'Mina Park');
  const cb = await mk(b, 'Cha Yoonoh');
  // Someone else's character can't be drafted for.
  const bad = await a('/api/drafts', { method: 'POST', body: { payload: { characterId: cb.id, kind: 'text', body: 'hi' } } });
  assert.equal(bad.status, 400);
  const r = await a('/api/drafts', {
    method: 'POST',
    body: { payload: { characterId: ca.id, kind: 'text', body: 'later tonight' } },
  });
  assert.equal(r.status, 201);
  const d = r.data.draft;
  assert.equal(d.character.name, 'Mina Park');
  assert.equal(d.payload.body, 'later tonight');
  // Nobody else sees it or can touch it, not even the owner.
  assert.equal((await b('/api/drafts')).data.drafts.length, 0);
  assert.equal((await owner('/api/drafts')).data.drafts.length, 0);
  assert.equal((await b(`/api/drafts/${d.id}`, { method: 'DELETE' })).status, 404);
  // Change it.
  const ch = await a(`/api/drafts/${d.id}`, { method: 'PUT', body: { payload: { ...d.payload, body: 'tonight for real' } } });
  assert.equal(ch.data.draft.payload.body, 'tonight for real');
  // Post it the way the app does: send the saved post, then drop the draft.
  const post = await a('/api/social', { method: 'POST', body: ch.data.draft.payload });
  assert.equal(post.status, 201, JSON.stringify(post.data));
  assert.equal(post.data.post.body, 'tonight for real');
  await a(`/api/drafts/${d.id}`, { method: 'DELETE' });
  assert.equal((await a('/api/drafts')).data.drafts.length, 0);
});

test('suggestions: anyone suggests and votes; only the team marks and replies, and the suggester hears', async () => {
  const owner = app.admin;
  const a = await app.signUp('sg_writer');
  const b = await app.signUp('sg_reader');
  const r = await a('/api/suggestions', { method: 'POST', body: { title: 'Playlists on profiles', body: 'like a mixtape' } });
  assert.equal(r.status, 201);
  const s = r.data.suggestion;
  assert.equal(s.votes, 1, 'you back your own idea');
  assert.equal(s.voted, true);
  // Someone else votes, then takes it back.
  assert.equal((await b(`/api/suggestions/${s.id}/vote`, { method: 'POST', body: {} })).data.suggestion.votes, 2);
  assert.equal((await b(`/api/suggestions/${s.id}/vote`, { method: 'POST', body: {} })).data.suggestion.votes, 1);
  // A writer can't mark someone's suggestion or change it.
  const noMark = await b(`/api/suggestions/${s.id}`, { method: 'PUT', body: { status: 'done' } });
  assert.equal(noMark.status, 403);
  // Its writer can change the wording but not the status.
  const own = await a(`/api/suggestions/${s.id}`, {
    method: 'PUT',
    body: { title: 'Playlists on character profiles', status: 'done' },
  });
  assert.equal(own.data.suggestion.title, 'Playlists on character profiles');
  assert.equal(own.data.suggestion.status, 'open');
  // The team marks it and replies; the writer is told.
  const marked = await owner(`/api/suggestions/${s.id}`, { method: 'PUT', body: { status: 'planned', reply: 'Coming soon!' } });
  assert.equal(marked.data.suggestion.status, 'planned');
  assert.equal(marked.data.suggestion.reply, 'Coming soon!');
  const notes = (await a('/api/notifications')).data.notifications;
  const n = notes.find((x) => x.type === 'suggestion');
  assert.ok(n, 'the suggester hears about it');
  assert.equal(n.url, '#/suggestions');
  assert.match(n.text, /planned/);
  // Only its writer or the team can remove it.
  assert.equal((await b(`/api/suggestions/${s.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await owner(`/api/suggestions/${s.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await a('/api/suggestions')).data.suggestions.length, 0);
});
