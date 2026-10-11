import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

let server;
let base;

before(async () => {
  server = createApp({ dbPath: ':memory:' });
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

// Minimal cookie-keeping client, one per simulated user.
function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
}

async function signUp(username) {
  const c = client();
  const r = await c('/api/auth/register', { method: 'POST', body: { username, password: 'correct horse', displayName: username.toUpperCase() } });
  assert.equal(r.status, 201);
  return c;
}

test('register, me, logout, login', async () => {
  const c = await signUp('ada');
  assert.equal((await c('/api/me')).data.user.username, 'ada');

  const dup = await client()('/api/auth/register', { method: 'POST', body: { username: 'ADA', password: 'whatever123' } });
  assert.equal(dup.status, 409);

  await c('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await c('/api/me')).data.user, null);

  assert.equal((await c('/api/auth/login', { method: 'POST', body: { username: 'ada', password: 'wrong pass' } })).status, 401);
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { username: 'ada', password: 'correct horse' } })).status, 200);
  assert.equal((await c('/api/me')).data.user.username, 'ada');
});

test('validation rejects bad input', async () => {
  const c = client();
  assert.equal((await c('/api/auth/register', { method: 'POST', body: { username: 'x', password: 'longenough' } })).status, 400);
  assert.equal((await c('/api/auth/register', { method: 'POST', body: { username: 'okname', password: 'short' } })).status, 400);
  assert.equal((await c('/api/auth/register', { method: 'POST', body: { username: 'bad name!', password: 'longenough' } })).status, 400);
});

test('mutations require JSON content type', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('full roleplay flow: characters, stories, posts, permissions', async () => {
  const owner = await signUp('gm_rose');
  const partner = await signUp('quill');
  const stranger = await signUp('lurker');
  const anon = client();

  // Characters
  const knight = (await owner('/api/characters', { method: 'POST', body: { name: 'Sir Aldric', tagline: 'Oathbound', color: '#aa3355' } })).data.character;
  const thief = (await partner('/api/characters', { method: 'POST', body: { name: 'Wren', bio: 'Quick hands.' } })).data.character;
  assert.equal((await owner('/api/characters', { method: 'POST', body: { name: 'X', color: 'red' } })).status, 400);
  assert.equal((await owner('/api/characters')).data.characters.length, 1);
  assert.equal((await partner(`/api/characters/${knight.id}`, { method: 'PUT', body: { name: 'Hijacked' } })).status, 404);

  // Public story
  const story = (await owner('/api/stories', { method: 'POST', body: { title: 'The Ashen Road', genre: 'Fantasy', rating: 'T' } })).data.story;
  assert.equal(story.memberCount, 1);
  assert.equal((await anon('/api/stories')).data.stories.length, 1);
  assert.equal((await anon('/api/stories?q=ashen')).data.stories.length, 1);
  assert.equal((await anon('/api/stories?q=nothing-like-this')).data.stories.length, 0);

  // Owner posts in character; can't post as someone else's character
  const p1 = await owner(`/api/stories/${story.id}/posts`, { method: 'POST', body: { kind: 'ic', characterId: knight.id, body: '*He draws his sword.* "Who goes there?"' } });
  assert.equal(p1.status, 201);
  assert.equal(p1.data.post.wordCount, 7);
  assert.equal(p1.data.post.character.name, 'Sir Aldric');
  assert.equal((await owner(`/api/stories/${story.id}/posts`, { method: 'POST', body: { kind: 'ic', characterId: thief.id, body: 'nope' } })).status, 400);

  // Non-members can read but not write until they join
  assert.equal((await partner(`/api/stories/${story.id}/posts`, { method: 'POST', body: { kind: 'ooc', body: 'hi!' } })).status, 403);
  assert.equal((await partner(`/api/stories/${story.id}/join`, { method: 'POST', body: {} })).status, 200);
  const p2 = await partner(`/api/stories/${story.id}/posts`, { method: 'POST', body: { kind: 'ic', characterId: thief.id, body: 'A shadow drops from the rafters.' } });
  assert.equal(p2.status, 201);
  const ooc = await partner(`/api/stories/${story.id}/posts`, { method: 'POST', body: { kind: 'ooc', body: 'brb dinner' } });
  assert.equal(ooc.data.post.character, null);

  const posts = (await anon(`/api/stories/${story.id}/posts`)).data.posts;
  assert.deepEqual(posts.map((p) => p.kind), ['ic', 'ic', 'ooc']);
  assert.equal((await anon(`/api/stories/${story.id}/posts?after=${p2.data.post.id}`)).data.posts.length, 1);

  // Story detail shows cast; invite code only for owner
  const detail = (await partner(`/api/stories/${story.id}`)).data;
  assert.equal(detail.role, 'writer');
  assert.deepEqual(detail.cast.map((c) => c.name), ['Sir Aldric', 'Wren']);
  assert.equal(detail.story.inviteCode, undefined);
  assert.ok((await owner(`/api/stories/${story.id}`)).data.story.inviteCode);

  // Editing: only the author; deleting: author or story owner
  assert.equal((await owner(`/api/posts/${p2.data.post.id}`, { method: 'PUT', body: { body: 'edited by owner' } })).status, 404);
  const edited = await partner(`/api/posts/${p2.data.post.id}`, { method: 'PUT', body: { body: 'A shadow drops silently.' } });
  assert.ok(edited.data.post.editedAt);
  assert.equal((await stranger(`/api/posts/${ooc.data.post.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await owner(`/api/posts/${ooc.data.post.id}`, { method: 'DELETE' })).status, 200);

  // Only owner can change settings; closing blocks joins without invite
  assert.equal((await partner(`/api/stories/${story.id}`, { method: 'PUT', body: { title: 'Mine now' } })).status, 403);
  await owner(`/api/stories/${story.id}`, { method: 'PUT', body: { status: 'closed' } });
  assert.equal((await stranger(`/api/stories/${story.id}/join`, { method: 'POST', body: {} })).status, 403);

  // Owner can't leave; writer can
  assert.equal((await owner(`/api/stories/${story.id}/leave`, { method: 'POST', body: {} })).status, 400);
  assert.equal((await partner(`/api/stories/${story.id}/leave`, { method: 'POST', body: {} })).status, 200);
});

test('private stories are hidden except to members and invitees', async () => {
  const owner = await signUp('secret_keeper');
  const friend = await signUp('friend');
  const other = await signUp('outsider');

  const story = (await owner('/api/stories', { method: 'POST', body: { title: 'Hidden Grove', visibility: 'private' } })).data.story;
  const code = (await owner(`/api/stories/${story.id}`)).data.story.inviteCode;

  assert.ok(!(await other('/api/stories')).data.stories.some((s) => s.id === story.id));
  assert.equal((await other(`/api/stories/${story.id}`)).status, 404);
  assert.equal((await other(`/api/stories/${story.id}/posts`)).status, 404);
  assert.equal((await other(`/api/stories/${story.id}/join`, { method: 'POST', body: {} })).status, 404);
  assert.equal((await other(`/api/stories/${story.id}/join`, { method: 'POST', body: { inviteCode: 'wrong' } })).status, 404);

  assert.equal((await friend(`/api/stories/${story.id}/join`, { method: 'POST', body: { inviteCode: code } })).status, 200);
  assert.equal((await friend(`/api/stories/${story.id}`)).data.role, 'writer');
  assert.ok((await friend('/api/stories?scope=mine')).data.stories.some((s) => s.id === story.id));

  // Regenerating the invite invalidates the old link
  await owner(`/api/stories/${story.id}`, { method: 'PUT', body: { regenerateInvite: true } });
  assert.equal((await other(`/api/stories/${story.id}/join`, { method: 'POST', body: { inviteCode: code } })).status, 404);
});

test('live events stream new posts', async () => {
  const c = await signUp('streamer');
  const char = (await c('/api/characters', { method: 'POST', body: { name: 'Echo' } })).data.character;
  const story = (await c('/api/stories', { method: 'POST', body: { title: 'Live Test' } })).data.story;

  const controller = new AbortController();
  const res = await fetch(`${base}/api/stories/${story.id}/events`, { signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  await reader.read(); // ": connected"

  await c(`/api/stories/${story.id}/posts`, { method: 'POST', body: { kind: 'ic', characterId: char.id, body: 'Hello, world.' } });
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /event: post/);
  assert.match(text, /Hello, world\./);
  controller.abort();
});

test('serves the app shell and blocks path traversal', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /NUUVI/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/some/spa/route')).status, 200);
  assert.equal((await fetch(base + '/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json');
  assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404);
  assert.equal((await fetch(base + '/missing.js')).status, 404);
});
