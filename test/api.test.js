import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, sseReader } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

const post = (c, channelId, body) => c(`/api/channels/${channelId}/posts`, { method: 'POST', body });

async function makeStory(c, body = {}) {
  const r = await c('/api/stories', { method: 'POST', body: { title: 'A Story', visibility: 'public', ...body } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  // New stories don't come with an OOC channel any more (writers use Messages); older stories have one.
  const ooc = await c(`/api/stories/${r.data.story.id}/channels`, { method: 'POST', body: { name: 'ooc-chat', kind: 'ooc' } });
  assert.equal(ooc.status, 201, JSON.stringify(ooc.data));
  return { story: r.data.story, main: r.data.channels[0], ooc: ooc.data.channel };
}

test('first user becomes admin; everyone after needs an invite', async () => {
  const admin = await app.signUp('owner_admin');
  assert.equal(admin.user.isAdmin, true);
  assert.equal((await app.client()('/api/auth/status')).data.inviteRequired, true);

  const noInvite = await app.client()('/api/auth/register', { method: 'POST', body: { username: 'gatecrasher', password: 'longenough' } });
  assert.equal(noInvite.status, 403);

  const { code } = (await admin('/api/admin/invites', { method: 'POST', body: { note: 'for Sam' } })).data;
  const sam = await app.signUp('sam', { invite: code });
  assert.equal(sam.user.isAdmin, false);
  // Single-use by default.
  const reuse = await app.client()('/api/auth/register', { method: 'POST', body: { username: 'samtwin', password: 'longenough', invite: code } });
  assert.equal(reuse.status, 403);
  // Non-admins can't create invites.
  assert.equal((await sam('/api/admin/invites', { method: 'POST', body: {} })).status, 403);
});

test('usernames can use any characters, are unique in any case, and @mentions find them', async () => {
  const owner = await app.signUp('名前_owner');
  const invite = (await app.admin('/api/admin/invites', { method: 'POST', body: {} })).data.code;
  const c = app.client();
  const reg = await c('/api/auth/register', { method: 'POST', body: { username: '✿Rosé✿', password: 'supersecret1', invite } });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const invite2 = (await app.admin('/api/admin/invites', { method: 'POST', body: {} })).data.code;
  const dup = await app.client()('/api/auth/register', { method: 'POST', body: { username: '✿ROSÉ✿', password: 'supersecret1', invite: invite2 } });
  assert.equal(dup.status, 409);
  assert.equal((await app.client()('/api/auth/register', { method: 'POST', body: { username: 'has space', password: 'supersecret1', invite: invite2 } })).status, 400);
  assert.equal((await app.client()('/api/auth/login', { method: 'POST', body: { username: '✿rosé✿', password: 'supersecret1' } })).status, 200);

  const story = (await owner('/api/stories', { method: 'POST', body: { title: 'Names', visibility: 'public' } })).data.story;
  await c(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });
  const channel = (await owner(`/api/stories/${story.id}`)).data.channels[0];
  await owner(`/api/channels/${channel.id}/posts`, { method: 'POST', body: { kind: 'ooc', body: 'hey @✿rosé✿! you around?' } });
  const notes = (await c('/api/notifications')).data.notifications;
  assert.ok(notes.some((n) => n.type === 'mention'), JSON.stringify(notes));
});

test('login, logout, password change and validation', async () => {
  const c = await app.signUp('ada');
  assert.equal((await c('/api/me')).data.user.username, 'ada');
  await c('/api/auth/logout', { method: 'POST', body: {} });
  assert.equal((await c('/api/me')).data.user, null);
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { username: 'ada', password: 'nope nope' } })).status, 401);
  assert.equal((await c('/api/auth/login', { method: 'POST', body: { username: 'ADA', password: 'correct horse' } })).status, 200);

  assert.equal((await c('/api/me/password', { method: 'PUT', body: { current: 'wrong', next: 'new password!' } })).status, 400);
  assert.equal((await c('/api/me/password', { method: 'PUT', body: { current: 'correct horse', next: 'new password!' } })).status, 200);
  assert.equal((await app.client()('/api/auth/login', { method: 'POST', body: { username: 'ada', password: 'new password!' } })).status, 200);

  const bad = await app.client()('/api/auth/register', { method: 'POST', body: { username: 'bad name!', password: 'longenough', invite: 'x' } });
  assert.equal(bad.status, 400);
});

test('requests from other sites and non-JSON bodies are rejected', async () => {
  const c = await app.signUp('csrf_target');
  const cross = await c('/api/stories', { method: 'POST', body: { title: 'x' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  const res = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('stories come with channels; members post in character, narration and OOC', async () => {
  const gm = await app.signUp('gm_rose');
  const quill = await app.signUp('quill');
  const anon = app.client();

  const knight = (await gm('/api/characters', { method: 'POST', body: { name: 'Sir Aldric', color: '#aa3355' } })).data.character;
  const wren = (await quill('/api/characters', { method: 'POST', body: { name: 'Wren' } })).data.character;
  const { story, main, ooc } = await makeStory(gm, { title: 'The Ashen Road', contentWarnings: 'violence, blood', rating: 'M' });
  assert.deepEqual(story.contentWarnings, ['violence', 'blood']);
  assert.equal(main.name, 'main-story');
  assert.equal(ooc.name, 'ooc-chat');

  const p1 = await post(gm, main.id, { kind: 'ic', characterId: knight.id, body: '*He draws his sword.* "Who goes there?"' });
  assert.equal(p1.status, 201);
  assert.equal(p1.data.post.character.name, 'Sir Aldric');
  assert.equal((await post(gm, main.id, { kind: 'ic', characterId: wren.id, body: 'not mine' })).status, 400);
  assert.equal((await post(quill, main.id, { kind: 'ooc', body: 'hi' })).status, 403);

  assert.equal((await quill(`/api/stories/${story.id}/join`, { method: 'POST', body: {} })).status, 200);
  await post(quill, main.id, { kind: 'ic', characterId: wren.id, body: 'A shadow drops from the rafters.', cw: 'spiders' });
  await post(quill, ooc.id, { kind: 'ooc', body: 'brb dinner' });
  await post(quill, main.id, { kind: 'narration', body: 'Somewhere, a bell rings.' });
  // Dice are gone.
  assert.equal((await post(quill, main.id, { kind: 'roll', dice: '1d20' })).status, 400);

  const mainPosts = (await anon(`/api/channels/${main.id}/posts`)).data.posts;
  assert.deepEqual(mainPosts.map((p) => p.kind), ['ic', 'ic', 'narration']);
  assert.equal(mainPosts[1].cw, 'spiders');
  assert.equal((await anon(`/api/channels/${ooc.id}/posts`)).data.posts.length, 1);

  // Editing: only the author. Deleting: author, story owner or admin.
  assert.equal((await gm(`/api/posts/${mainPosts[1].id}`, { method: 'PUT', body: { body: 'hijack' } })).status, 404);
  const edited = await quill(`/api/posts/${mainPosts[1].id}`, { method: 'PUT', body: { body: 'A shadow drops silently.' } });
  assert.ok(edited.data.post.editedAt);
  assert.equal((await gm(`/api/posts/${mainPosts[2].id}`, { method: 'DELETE' })).status, 200);

  const detail = (await quill(`/api/stories/${story.id}`)).data;
  assert.equal(detail.role, 'writer');
  assert.equal(detail.channels.length, 2);
  assert.deepEqual(detail.cast.map((c) => c.name), ['Sir Aldric', 'Wren']);
  assert.equal(detail.story.inviteCode, undefined);
});

test('channels: owner can add, rename, reorder and delete', async () => {
  const gm = await app.signUp('chan_gm');
  const other = await app.signUp('chan_other');
  const { story, main } = await makeStory(gm);
  const created = await gm(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'Chapter 2', topic: 'The ball' } });
  assert.equal(created.status, 201);
  assert.equal((await other(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'mine' } })).status, 403);
  await gm(`/api/channels/${created.data.channel.id}`, { method: 'PUT', body: { move: 'up' } });
  const names = (await gm(`/api/stories/${story.id}`)).data.channels.map((c) => c.name);
  assert.deepEqual(names, ['main-story', 'Chapter 2', 'ooc-chat']);
  assert.equal((await gm(`/api/channels/${main.id}`, { method: 'DELETE' })).status, 200);
});

test('unread counts, mentions and notifications', async () => {
  const gm = await app.signUp('notif_gm');
  const pal = await app.signUp('notif_pal');
  const { story, main } = await makeStory(gm);
  await pal(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });

  await post(gm, main.id, { kind: 'narration', body: 'The storm rolls in.' });
  await post(gm, main.id, { kind: 'narration', body: 'Thunder.' });
  await post(gm, main.id, { kind: 'ooc', body: '@notif_pal your move!' });

  let home = (await pal('/api/home')).data;
  const mine = home.stories.find((s) => s.id === story.id);
  assert.equal(mine.unread, 3);
  assert.equal(mine.mentions, 1);

  const notes = (await pal('/api/notifications')).data;
  // Two plain posts collapse into one notification; the mention is separate.
  assert.deepEqual(notes.notifications.map((n) => [n.type, n.count]), [['mention', 1], ['post', 2]]);
  assert.equal(notes.unread, 2);

  await pal(`/api/channels/${main.id}/read`, { method: 'POST', body: {} });
  home = (await pal('/api/home')).data;
  assert.equal(home.stories.find((s) => s.id === story.id).unread, 0);
  assert.equal(home.notificationsUnread, 0);

  // Muting a story stops plain post notifications.
  await pal(`/api/stories/${story.id}/notify`, { method: 'PUT', body: { level: 'mentions' } });
  await post(gm, main.id, { kind: 'narration', body: 'Quiet.' });
  assert.equal((await pal('/api/notifications')).data.unread, 0);
});

test('turn order passes along and notifies the next writer', async () => {
  const gm = await app.signUp('turn_gm');
  const a = await app.signUp('turn_a');
  const b = await app.signUp('turn_b');
  const { story, main } = await makeStory(gm);
  for (const c of [a, b]) await c(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });

  assert.equal((await a(`/api/channels/${main.id}/turns`, { method: 'PUT', body: { enabled: true } })).status, 403);
  const set = await gm(`/api/channels/${main.id}/turns`, { method: 'PUT', body: { enabled: true, order: [a.user.id, b.user.id, gm.user.id] } });
  assert.equal(set.data.channel.turns.current, a.user.id);
  assert.equal((await a('/api/notifications')).data.notifications[0].type, 'turn');

  // Writing in character on your turn passes it on; OOC does not.
  await post(a, main.id, { kind: 'ooc', body: 'thinking…' });
  assert.equal((await gm(`/api/stories/${story.id}`)).data.channels[0].turns.current, a.user.id);
  await post(a, main.id, { kind: 'narration', body: 'She steps forward.' });
  assert.equal((await gm(`/api/stories/${story.id}`)).data.channels[0].turns.current, b.user.id);
  assert.equal((await b('/api/notifications')).data.notifications[0].type, 'turn');

  // Only the current writer can pass; the owner can skip.
  assert.equal((await a(`/api/channels/${main.id}/turns/advance`, { method: 'POST', body: {} })).status, 403);
  await b(`/api/channels/${main.id}/turns/advance`, { method: 'POST', body: {} });
  assert.equal((await gm(`/api/stories/${story.id}`)).data.channels[0].turns.current, gm.user.id);

  // Leaving removes you from the order.
  await b(`/api/stories/${story.id}/leave`, { method: 'POST', body: {} });
  const turns = (await gm(`/api/stories/${story.id}`)).data.channels[0].turns;
  assert.deepEqual(turns.order, [a.user.id, gm.user.id]);
  assert.equal(turns.current, gm.user.id);
});

test('private stories are hidden except to members and invitees', async () => {
  const owner = await app.signUp('secret_keeper');
  const friend = await app.signUp('friend');
  const other = await app.signUp('outsider');
  const { story, main } = await makeStory(owner, { title: 'Hidden Grove', visibility: 'private' });
  const code = (await owner(`/api/stories/${story.id}`)).data.story.inviteCode;

  assert.ok(!(await other('/api/stories')).data.stories.some((s) => s.id === story.id));
  assert.equal((await other(`/api/stories/${story.id}`)).status, 404);
  assert.equal((await other(`/api/channels/${main.id}/posts`)).status, 404);
  assert.equal((await other(`/api/stories/${story.id}/join`, { method: 'POST', body: { inviteCode: 'wrong' } })).status, 404);
  assert.equal((await other(`/api/events?story=${story.id}`)).status, 404);

  assert.equal((await friend(`/api/stories/${story.id}/join`, { method: 'POST', body: { inviteCode: code } })).status, 200);
  assert.equal((await friend(`/api/stories/${story.id}`)).data.role, 'writer');

  await owner(`/api/stories/${story.id}`, { method: 'PUT', body: { regenerateInvite: true } });
  assert.equal((await other(`/api/stories/${story.id}/join`, { method: 'POST', body: { inviteCode: code } })).status, 404);
});

test('owners can remove writers, who then cannot rejoin', async () => {
  const owner = await app.signUp('kick_owner');
  const pest = await app.signUp('kick_pest');
  const { story } = await makeStory(owner);
  await pest(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });
  assert.equal((await pest(`/api/stories/${story.id}/kick`, { method: 'POST', body: { userId: owner.user.id } })).status, 403);
  assert.equal((await owner(`/api/stories/${story.id}/kick`, { method: 'POST', body: { userId: pest.user.id } })).status, 200);
  assert.equal((await pest(`/api/stories/${story.id}`)).data.role, null);
  assert.equal((await pest(`/api/stories/${story.id}/join`, { method: 'POST', body: {} })).status, 403);
});

test('blocking hides notifications and stops joining the blocker\'s stories', async () => {
  const me = await app.signUp('blocker');
  const them = await app.signUp('blockee');
  const { story, main } = await makeStory(them);
  await me(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });
  await me('/api/blocks', { method: 'POST', body: { userId: them.user.id } });
  assert.deepEqual((await me('/api/blocks')).data.users.map((u) => u.username), ['blockee']);

  await post(them, main.id, { kind: 'ooc', body: '@blocker hello?' });
  assert.equal((await me('/api/notifications')).data.unread, 0);

  const { story: mine } = await makeStory(me);
  assert.equal((await them(`/api/stories/${mine.id}/join`, { method: 'POST', body: {} })).status, 403);

  await me(`/api/blocks/${them.user.id}`, { method: 'DELETE' });
  assert.equal((await me('/api/blocks')).data.users.length, 0);
});

test('reports reach admins, who can resolve them and suspend users', async () => {
  const admin = app.admin;
  const victim = await app.signUp('reporter');
  const troll = await app.signUp('troll');
  const { story, ooc } = await makeStory(victim);
  await troll(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });
  const bad = (await post(troll, ooc.id, { kind: 'ooc', body: 'something awful' })).data.post;

  assert.equal((await victim(`/api/posts/${bad.id}/report`, { method: 'POST', body: { reason: 'harassment' } })).status, 201);
  assert.equal((await troll('/api/admin/reports')).status, 403);
  const reports = (await admin('/api/admin/reports')).data.reports;
  const report = reports.find((r) => r.post?.id === bad.id);
  assert.equal(report.snapshot.body, 'something awful');
  assert.equal(report.target.username, 'troll');
  assert.ok((await admin('/api/notifications')).data.notifications.some((n) => n.type === 'report'));

  // Admin deletes the post, suspends the user, resolves the report.
  assert.equal((await admin(`/api/posts/${bad.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await admin(`/api/admin/users/${troll.user.id}/ban`, { method: 'POST', body: { reason: 'harassment' } })).status, 200);
  assert.equal((await troll('/api/me')).data.user, null);
  assert.equal((await app.client()('/api/auth/login', { method: 'POST', body: { username: 'troll', password: 'correct horse' } })).status, 403);
  await admin(`/api/admin/reports/${report.id}`, { method: 'POST', body: { status: 'resolved' } });
  assert.ok(!(await admin('/api/admin/reports')).data.reports.some((r) => r.id === report.id));
  assert.ok((await admin('/api/admin/log')).data.entries.some((e) => e.action === 'suspend'));

  // Password reset links work once and sign out old sessions.
  const { token } = (await admin(`/api/admin/users/${victim.user.id}/reset`, { method: 'POST', body: {} })).data;
  const fresh = app.client();
  assert.equal((await fresh('/api/auth/reset', { method: 'POST', body: { token, password: 'brand new pw' } })).status, 200);
  assert.equal((await victim('/api/me')).data.user, null);
  assert.equal((await fresh('/api/auth/reset', { method: 'POST', body: { token, password: 'again again' } })).status, 400);
});

test('image uploads are type-checked and usable as character pictures', async () => {
  const c = await app.signUp('artist');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const up = await c('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, raw: png });
  assert.equal(up.status, 201);
  assert.match(up.data.url, /^\/uploads\/[\w-]+\.png$/);

  const fake = await c('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, raw: Buffer.from('<script>') });
  assert.equal(fake.status, 400);
  const svg = await c('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, raw: Buffer.from('<svg/>') });
  assert.equal(svg.status, 415);

  const ch = await c('/api/characters', { method: 'POST', body: { name: 'Pic', avatar: up.data.url } });
  assert.equal(ch.data.character.avatar, up.data.url);
  // Can't use someone else's (or a made-up) upload.
  const other = await app.signUp('copycat');
  assert.equal((await other('/api/characters', { method: 'POST', body: { name: 'X', avatar: up.data.url } })).status, 400);

  const img = await fetch(app.base + up.data.url);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
});

test('live events: story watchers get posts, users get notifications', async () => {
  const gm = await app.signUp('live_gm');
  const pal = await app.signUp('live_pal');
  const { story, main } = await makeStory(gm);
  await pal(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });

  const controller = new AbortController();
  const res = await fetch(`${app.base}/api/events`, { headers: { Cookie: pal.cookie() }, signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const next = sseReader(res);

  await post(gm, main.id, { kind: 'narration', body: 'Hello, world.' });
  const ev = await next('post');
  assert.equal(ev.data.body, 'Hello, world.');
  const note = await next('notification');
  assert.equal(note.data.type, 'post');
  controller.abort();
});

test('push subscriptions receive encrypted pushes', async () => {
  const gm = await app.signUp('push_gm');
  const pal = await app.signUp('push_pal');
  const { createECDH, randomBytes } = await import('node:crypto');
  const ua = createECDH('prime256v1');
  const subscription = {
    endpoint: 'https://push.example.com/send/abc',
    keys: { p256dh: ua.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
  assert.equal((await pal('/api/push/subscribe', { method: 'POST', body: { subscription } })).status, 200);
  assert.equal((await pal('/api/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'http://insecure' } } })).status, 400);

  const { story, main } = await makeStory(gm);
  await pal(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });
  const before = app.pushes.length;
  await post(gm, main.id, { kind: 'narration', body: 'ping' });
  await new Promise((r) => setTimeout(r, 50));
  const sent = app.pushes.slice(before).find((p) => p.url === subscription.endpoint);
  assert.ok(sent, 'push was sent');
  assert.equal(sent.init.headers['Content-Encoding'], 'aes128gcm');
  assert.match(sent.init.headers.Authorization, /^vapid t=.+, k=.+/);
});

test('serves the app shell, blocks path traversal, and asks not to be indexed', async () => {
  const home = await fetch(app.base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /NUUVI/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await fetch(app.base + '/some/spa/route')).status, 200);
  assert.equal((await fetch(app.base + '/..%2fpackage.json')).status, 404);
  assert.equal((await fetch(app.base + '/uploads/..%2f..%2fetc.png')).status, 404);
});

test('roleplay profiles, banners and character details', async () => {
  const c = await app.signUp('profiled');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const banner = (await c('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, raw: png })).data.url;

  const me = await c('/api/me', {
    method: 'PUT',
    body: { banner, profile: { pronouns: 'she/her', timezone: 'GMT-5', activity: 'low', plots: 'selective', limits: 'no gore', styles: { longThreads: 120, oneLiners: 30, bogus: 5 } } },
  });
  assert.equal(me.status, 200, JSON.stringify(me.data));
  assert.equal(me.data.user.banner, banner);
  assert.deepEqual(me.data.user.profile.styles, { longThreads: 100, oneLiners: 30 });
  assert.equal((await c('/api/me', { method: 'PUT', body: { profile: { activity: 'sleepy' } } })).status, 400);

  // Partial updates keep the other fields.
  await c('/api/me', { method: 'PUT', body: { profile: { status: 'writing!' } } });
  const pub = (await c(`/api/users/${c.user.id}`)).data;
  assert.equal(pub.user.profile.pronouns, 'she/her');
  assert.equal(pub.user.profile.status, 'writing!');
  assert.deepEqual(Object.keys(pub.stats).sort(), ['characters', 'posts', 'stories', 'words']);

  const ch = await c('/api/characters', { method: 'POST', body: { name: 'Hide', portrait: banner, details: [{ label: 'Age', value: '21' }, { label: '', value: 'dropped' }] } });
  assert.deepEqual(ch.data.character.details, [{ label: 'Age', value: '21' }]);
  assert.equal(ch.data.character.portrait, banner);

  const { story } = (await c('/api/stories', { method: 'POST', body: { title: 'Bannered', banner } })).data;
  assert.equal(story.banner, banner);
});

test('threads: members start typed threads, tag characters, and statuses control who can post', async () => {
  const gm = await app.signUp('thread_gm');
  const a = await app.signUp('thread_a');
  const b = await app.signUp('thread_b');
  const { story } = await makeStory(gm);
  for (const c of [a, b]) await c(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });
  const yoonoh = (await a('/api/characters', { method: 'POST', body: { name: 'Cha Yoonoh' } })).data.character;
  const daehyun = (await b('/api/characters', { method: 'POST', body: { name: 'Bang Daehyun' } })).data.character;
  const outsider = (await (await app.signUp('thread_out'))('/api/characters', { method: 'POST', body: { name: 'Nobody' } })).data.character;

  // Event threads have to belong to a calendar event.
  assert.equal((await a(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'A party', kind: 'event' } })).status, 400);
  assert.equal((await a(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'x', tagged: [outsider.id] } })).status, 400);
  const created = await a(`/api/stories/${story.id}/channels`, {
    method: 'POST',
    body: { name: 'childhood friends reunited', kind: 'thread', status: 'closed', characterId: yoonoh.id, tagged: [daehyun.id], summary: 'An old friend calls his old name.', tags: 'angst, Reunion' },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const thread = created.data.channel;
  assert.deepEqual(thread.tags, ['angst', 'reunion']);
  assert.equal(thread.status, 'closed');
  assert.ok((await b('/api/notifications')).data.notifications.some((n) => n.type === 'tag'));

  const detail = (await b(`/api/channels/${thread.id}`)).data;
  assert.deepEqual(detail.participants.map((c) => c.name).sort(), ['Bang Daehyun', 'Cha Yoonoh']);
  assert.equal(detail.canPost, true);

  // Closed: only the people in it (and the owner) can post.
  const intruder = await app.signUp('thread_intruder');
  await intruder(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });
  assert.equal((await post(intruder, thread.id, { kind: 'ooc', body: 'hi?' })).status, 403);
  assert.equal((await post(b, thread.id, { kind: 'ic', characterId: daehyun.id, body: '"Daehyun?"' })).status, 201);

  // Only the starter or owner can edit; complete threads are read-only for others.
  assert.equal((await b(`/api/channels/${thread.id}`, { method: 'PUT', body: { status: 'complete' } })).status, 403);
  await a(`/api/channels/${thread.id}`, { method: 'PUT', body: { status: 'complete' } });
  assert.equal((await post(b, thread.id, { kind: 'ic', characterId: daehyun.id, body: 'one more' })).status, 403);

  // Comms threads.
  const comms = (await b(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'group chat', kind: 'comms' } })).data.channel;
  assert.equal(comms.kind, 'comms');

  // Feed lists them, filterable.
  // The feed shows open and finished episodes (finished ones with a full progress bar), self paras,
  // events and social posts — not comms.
  const para = (await a(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'alone at last', kind: 'para', characterId: yoonoh.id } })).data.channel;
  const feed = (await b('/api/feed')).data.items;
  assert.ok(feed.some((i) => i.type === 'thread' && i.id === para.id));
  assert.ok(!feed.some((i) => i.type === 'thread' && i.id === comms.id));
  assert.equal(feed.find((i) => i.type === 'thread' && i.id === thread.id)?.status, 'complete');
  assert.equal((await b('/api/feed?filter=comms')).status, 400);
  assert.ok((await b('/api/feed?filter=para')).data.items.every((i) => i.kind === 'para'));
  assert.ok((await b('/api/feed?filter=mine')).data.items.some((i) => i.id === thread.id));
});

test('characters follow characters; profiles show followers, following and threads', async () => {
  const a = await app.signUp('follow_a');
  const b = await app.signUp('follow_b');
  const olivia = (await a('/api/characters', { method: 'POST', body: { name: 'Olivia' } })).data.character;
  const marina = (await b('/api/characters', { method: 'POST', body: { name: 'Marina' } })).data.character;

  assert.equal((await b(`/api/characters/${olivia.id}/follow`, { method: 'POST', body: { asCharacterId: olivia.id } })).status, 400);
  assert.equal((await b(`/api/characters/${marina.id}/follow`, { method: 'POST', body: { asCharacterId: marina.id } })).status, 400);
  const res = await b(`/api/characters/${olivia.id}/follow`, { method: 'POST', body: { asCharacterId: marina.id } });
  assert.equal(res.data.stats.followers, 1);
  assert.ok((await a('/api/notifications')).data.notifications.some((n) => n.type === 'follow' && n.url === `#/c/${marina.id}`));

  const profile = (await b(`/api/characters/${olivia.id}`)).data;
  assert.deepEqual(profile.followedBy, [marina.id]);
  assert.equal((await a(`/api/characters/${marina.id}`)).data.stats.following, 1);
  assert.deepEqual((await a(`/api/characters/${olivia.id}/followers`)).data.characters.map((c) => c.name), ['Marina']);

  await b(`/api/characters/${olivia.id}/unfollow`, { method: 'POST', body: { asCharacterId: marina.id } });
  assert.equal((await b(`/api/characters/${olivia.id}`)).data.stats.followers, 0);
});

test('character social posts: create, feed, like, comment, notifications', async () => {
  const a = await app.signUp('social_a');
  const b = await app.signUp('social_b');
  const star = (await a('/api/characters', { method: 'POST', body: { name: 'Idol', followersDisplay: '2,400,000', verified: true } })).data.character;
  const fan = (await b('/api/characters', { method: 'POST', body: { name: 'Fan' } })).data.character;
  assert.equal(star.followersDisplay, 2400000);
  assert.equal(star.verified, true);
  assert.equal((await b(`/api/characters/${star.id}`)).data.stats.followers, 2400000);

  assert.equal((await a('/api/social', { method: 'POST', body: { characterId: fan.id, body: 'not mine' } })).status, 400);
  assert.equal((await a('/api/social', { method: 'POST', body: { characterId: star.id, kind: 'photo', body: 'no photo' } })).status, 400);
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const photo = (await a('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, raw: png })).data.url;
  const p1 = await a('/api/social', { method: 'POST', body: { characterId: star.id, kind: 'photo', body: 'tour day 1', media: [photo] } });
  assert.equal(p1.status, 201, JSON.stringify(p1.data));
  const stream = await a('/api/social', { method: 'POST', body: { characterId: star.id, kind: 'stream', title: 'q&a', meta: { viewers: 12000 } } });
  assert.equal(stream.data.post.meta.viewers, 12000);

  const feed = (await b('/api/feed?filter=social')).data.items;
  assert.deepEqual(feed.filter((i) => i.character.id === star.id).map((i) => i.kind), ['stream', 'photo']);

  // Famous characters start with likes from their followers; each real like adds one.
  const before = p1.data.post.likes;
  assert.ok(before > 50000, `a 2.4M-follower character starts with likes (${before})`);
  const liked = await b(`/api/social/${p1.data.post.id}/like`, { method: 'POST', body: { asCharacterId: fan.id } });
  assert.equal(liked.data.post.likes, before + 1);
  assert.deepEqual(liked.data.post.likedBy, [fan.id]);
  const commented = await b(`/api/social/${p1.data.post.id}/comments`, { method: 'POST', body: { characterId: fan.id, body: 'omg!!' } });
  assert.equal(commented.data.post.comments[0].body, 'omg!!');
  // Replies hang under the comment; the crowd chimes in on famous characters' posts.
  const reply = await a(`/api/social/${p1.data.post.id}/comments`, { method: 'POST', body: { characterId: star.id, body: 'ty!', parentId: commented.data.post.comments[0].id } });
  assert.equal(reply.data.post.comments.find((c) => c.body === 'ty!').parentId, commented.data.post.comments[0].id);
  assert.ok(reply.data.post.buzz.length > 0, 'crowd comments on a famous post');
  assert.ok(reply.data.post.comments[0].likes >= 0);
  const notes = (await a('/api/notifications')).data.notifications;
  assert.ok(notes.some((n) => n.type === 'like' && n.url === `#/p/${p1.data.post.id}`));
  assert.ok(notes.some((n) => n.type === 'comment'));
  assert.equal((await b(`/api/social/${p1.data.post.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await a(`/api/social?character=${star.id}`)).data.posts.length, 2);
});

test('songs on social posts and optional character banners', async () => {
  const a = await app.signUp('music_a');
  const c = (await a('/api/characters', { method: 'POST', body: { name: 'Singer' } })).data.character;
  assert.equal(c.banner, null);
  const song = { title: 'Ditto', artist: 'NewJeans', url: 'https://open.spotify.com/track/abc' };
  const p = await a('/api/social', { method: 'POST', body: { characterId: c.id, body: 'on repeat', music: song } });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.deepEqual(p.data.post.meta.music, song);
  for (const bad of [{ title: 'x', url: 'javascript:alert(1)' }, { artist: 'no title' }, { title: 'x', url: 'not a link' }]) {
    assert.equal((await a('/api/social', { method: 'POST', body: { characterId: c.id, body: 'x', music: bad } })).status, 400);
  }
  const edited = await a(`/api/social/${p.data.post.id}`, { method: 'PUT', body: { body: 'still on repeat' } });
  assert.deepEqual(edited.data.post.meta.music, song);
  const cleared = await a(`/api/social/${p.data.post.id}`, { method: 'PUT', body: { music: null } });
  assert.equal(cleared.data.post.meta.music, undefined);

  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const img = (await a('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, raw: png })).data.url;
  const withBanner = await a(`/api/characters/${c.id}`, { method: 'PUT', body: { banner: img } });
  assert.equal(withBanner.data.character.banner, img);
  assert.equal((await a(`/api/characters/${c.id}`, { method: 'PUT', body: { name: 'Singer 2' } })).data.character.banner, img);
  assert.equal((await a(`/api/characters/${c.id}`, { method: 'PUT', body: { banner: '' } })).data.character.banner, null);
  assert.equal((await a(`/api/characters/${c.id}`, { method: 'PUT', body: { banner: '/uploads/nope.png' } })).status, 400);
});

test('stars, contact names and audio uploads with range requests', async () => {
  const a = await app.signUp('star_a');
  const { story, main } = await makeStory(a);
  const me = (await a('/api/characters', { method: 'POST', body: { name: 'Yoonoh' } })).data.character;
  const p = (await post(a, main.id, { kind: 'ic', characterId: me.id, body: 'a moment worth keeping' })).data.post;
  await a(`/api/posts/${p.id}/star`, { method: 'POST', body: {} });
  assert.deepEqual((await a(`/api/channels/${main.id}`)).data.starred, [p.id]);
  await a(`/api/posts/${p.id}/star`, { method: 'DELETE' });
  assert.deepEqual((await a(`/api/channels/${main.id}`)).data.starred, []);

  await a(`/api/contacts/${me.id}`, { method: 'PUT', body: { name: 'hyung 🖤' } });
  assert.equal((await a(`/api/channels/${main.id}`)).data.contacts[me.id], 'hyung 🖤');
  void story;

  const audio = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
  const up = await a('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus' }, raw: audio });
  assert.equal(up.status, 201);
  assert.match(up.data.url, /\.weba$/);
  const ranged = await fetch(app.base + up.data.url, { headers: { Range: 'bytes=0-99' } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 0-99/2004');
  assert.equal((await ranged.arrayBuffer()).byteLength, 100);
  const fake = await a('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, raw: Buffer.from('not a video at all') });
  assert.equal(fake.status, 400);
});

test('replies, pictures and picture links in messages; comms icons; very long posts', async () => {
  const a = await app.signUp('reply_a');
  const b = await app.signUp('reply_b');
  const { story, main, ooc } = await makeStory(a, { title: 'Replies', visibility: 'public' });
  await b(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });

  const first = (await post(a, ooc.id, { kind: 'ooc', body: 'anyone up?' })).data.post;
  const reply = await post(b, ooc.id, { kind: 'ooc', body: 'me!', replyTo: first.id });
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  assert.deepEqual(reply.data.post.replyTo, { id: first.id, name: 'reply_a', color: null, text: 'anyone up?', hasMedia: false });
  assert.ok((await a('/api/notifications')).data.notifications.some((n) => n.type === 'reply'));
  assert.equal((await post(b, ooc.id, { kind: 'ooc', body: 'x', replyTo: 999999 })).status, 400);

  const link = 'https://i.pinimg.com/originals/aa/bb/cc.jpg';
  const pic = await post(b, ooc.id, { kind: 'ooc', media: [link] });
  assert.equal(pic.status, 201, JSON.stringify(pic.data));
  assert.deepEqual(pic.data.post.media, [link]);
  assert.equal((await post(b, ooc.id, { kind: 'ooc', body: '' })).status, 400);
  for (const bad of ['http://insecure.example/x.jpg', 'javascript:alert(1)', '/uploads/not-mine.png']) {
    assert.equal((await post(b, ooc.id, { kind: 'ooc', media: [bad] })).status, 400, bad);
  }

  const comms = await a(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'dms', kind: 'comms', icon: '💌' } });
  assert.equal(comms.data.channel.icon, '💌');
  const pictured = await a(`/api/channels/${comms.data.channel.id}`, { method: 'PUT', body: { icon: link } });
  assert.equal(pictured.data.channel.icon, link);
  assert.equal((await a(`/api/channels/${comms.data.channel.id}`, { method: 'PUT', body: { icon: 'way too long icon' } })).status, 400);

  const avatarLink = await a('/api/characters', { method: 'POST', body: { name: 'Linked', avatar: link, portrait: link, banner: link } });
  assert.equal(avatarLink.data.character.avatar, link);

  const novel = 'word '.repeat(60000);
  const long = await post(a, main.id, { kind: 'narration', body: novel });
  assert.equal(long.status, 201);
  assert.equal(long.data.post.wordCount, 60000);
});

test('the directory lists every writer by username with their characters', async () => {
  const a = await app.signUp('dir_a');
  const b = await app.signUp('dir_b');
  await a('/api/characters', { method: 'POST', body: { name: 'Zed' } });
  await a('/api/characters', { method: 'POST', body: { name: 'Amy' } });
  await b('/api/characters', { method: 'POST', body: { name: 'Bo' } });
  const { writers } = (await b('/api/directory')).data;
  const mine = writers.find((w) => w.username === 'dir_a');
  assert.deepEqual(mine.characters.map((c) => c.name), ['Amy', 'Zed']);
  assert.ok(writers.find((w) => w.username === 'dir_b').characters.some((c) => c.name === 'Bo'));
  const bId = writers.find((w) => w.username === 'dir_b').id;
  await a('/api/blocks', { method: 'POST', body: { userId: bId } });
  assert.ok(!(await b('/api/directory')).data.writers.some((w) => w.username === 'dir_a'));
});

test('calendar events: members add them, threads and comms join them, and the event lists its threads', async () => {
  const gm = await app.signUp('cal_gm');
  const a = await app.signUp('cal_a');
  const { story } = await makeStory(gm, { title: 'Gala night', visibility: 'private' });
  const invite = (await gm(`/api/stories/${story.id}`)).data.story.inviteCode;
  await a(`/api/stories/${story.id}/join`, { method: 'POST', body: { inviteCode: invite } });
  const outsider = await app.signUp('cal_out');

  assert.equal((await a(`/api/stories/${story.id}/calendar`, { method: 'POST', body: { title: 'No date' } })).status, 400);
  const made = await a(`/api/stories/${story.id}/calendar`, { method: 'POST', body: {
    title: 'Trinity Gala', startsAt: '2026-10-14T20:00:00Z', endsAt: '2026-10-15T02:00:00Z', location: 'The Plaza', summary: 'Black tie.' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const ev = made.data.event;
  assert.equal((await a(`/api/stories/${story.id}/calendar`, { method: 'POST', body: { title: 'Backwards', startsAt: '2026-10-14T20:00:00Z', endsAt: '2026-10-13T20:00:00Z' } })).status, 400);

  const t1 = await a(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'the ballroom', kind: 'event', eventId: ev.id } });
  assert.equal(t1.status, 201, JSON.stringify(t1.data));
  assert.equal(t1.data.channel.eventId, ev.id);
  const c1 = await a(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'gala texts', kind: 'comms', eventId: ev.id } });
  assert.equal(c1.data.channel.eventId, ev.id);

  const detail = (await gm(`/api/calendar/${ev.id}`)).data;
  assert.deepEqual(detail.threads.map((t) => t.name).sort(), ['gala texts', 'the ballroom']);
  assert.equal(detail.canEdit, true);
  assert.equal((await gm('/api/calendar')).data.events.find((e) => e.id === ev.id).threadCount, 2);
  assert.ok((await gm('/api/feed?filter=event')).data.items.some((i) => i.type === 'event' && i.id === ev.id));

  // Private story: outsiders can't see the event.
  assert.equal((await outsider(`/api/calendar/${ev.id}`)).status, 404);
  assert.ok(!(await outsider('/api/calendar')).data.events.some((e) => e.id === ev.id));

  const edited = await gm(`/api/calendar/${ev.id}`, { method: 'PUT', body: { location: 'Rooftop' } });
  assert.equal(edited.data.event.location, 'Rooftop');
  assert.equal((await gm(`/api/calendar/${ev.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await a(`/api/channels/${t1.data.channel.id}`)).data.channel.eventId, null);
});

test('phones: contacts, private texts between two characters, unread counts and notifications', async () => {
  const a = await app.signUp('phone_a');
  const b = await app.signUp('phone_b');
  const snoop = await app.signUp('phone_snoop');
  const yoonoh = (await a('/api/characters', { method: 'POST', body: { name: 'Cha Yoonoh' } })).data.character;
  const daehyun = (await b('/api/characters', { method: 'POST', body: { name: 'Bang Daehyun' } })).data.character;
  assert.match(yoonoh.handle, /^chayoonoh\d*$/); // numbered if an earlier Cha Yoonoh took it

  assert.equal((await b(`/api/phone/${yoonoh.id}`)).status, 404); // not your phone
  const added = await a(`/api/phone/${yoonoh.id}/contacts`, { method: 'POST', body: { contactId: daehyun.id, name: 'daehyunie' } });
  assert.equal(added.data.contact.name, 'daehyunie');
  assert.equal((await a(`/api/phone/${yoonoh.id}/contacts`, { method: 'POST', body: { contactId: yoonoh.id } })).status, 400);

  const thread = (await a(`/api/phone/${yoonoh.id}/threads`, { method: 'POST', body: { withId: daehyun.id } })).data.thread;
  assert.equal(thread.name, 'daehyunie');
  const sent = await a(`/api/phone/threads/${thread.id}/messages`, { method: 'POST', body: { as: yoonoh.id, body: 'are you free tonight?' } });
  assert.equal(sent.status, 201);
  const pic = await b(`/api/phone/threads/${thread.id}/messages`, { method: 'POST', body: { as: daehyun.id, media: ['https://i.pinimg.com/x.jpg'], replyTo: sent.data.message.id } });
  assert.equal(pic.data.message.replyTo.text, 'are you free tonight?');

  // Only the two writers can see it.
  assert.equal((await snoop(`/api/phone/threads/${thread.id}`)).status, 404);
  assert.equal((await snoop(`/api/phone/threads/${thread.id}/messages`, { method: 'POST', body: { body: 'hi' } })).status, 404);

  const bPhone = (await b(`/api/phone/${daehyun.id}`)).data;
  assert.equal(bPhone.threads[0].name, 'Cha Yoonoh'); // Daehyun hasn't saved him as a contact
  assert.equal(bPhone.threads[0].unread, 0); // their own photo was the last message
  const aPhone = (await a(`/api/phone/${yoonoh.id}`)).data;
  assert.equal(aPhone.threads[0].unread, 1);
  assert.equal(aPhone.threads[0].last.text, 'Photo');
  const textNote = (await b('/api/notifications')).data.notifications.find((n) => n.type === 'dm');
  assert.equal(textNote.url, `#/phone/${daehyun.id}/t/${thread.id}`);
  assert.equal(textNote.from.name, 'Cha Yoonoh'); // who texted, with their picture
  assert.equal(textNote.to.name, 'Bang Daehyun'); // and whose phone it went to
  assert.equal((await a('/api/phone/unread')).data.unread[yoonoh.id], 1);

  await a(`/api/phone/threads/${thread.id}/read`, { method: 'POST', body: { as: yoonoh.id, lastId: pic.data.message.id } });
  assert.equal((await a(`/api/phone/${yoonoh.id}`)).data.threads[0].unread, 0);

  // Tapbacks: one per character, tap the same again to take it off; only emoji.
  const react = (who, as, emoji) => who(`/api/phone/messages/${sent.data.message.id}/react`, { method: 'POST', body: { as, emoji } });
  assert.deepEqual((await react(b, daehyun.id, '❤️')).data.reactions, [{ characterId: daehyun.id, emoji: '❤️' }]);
  assert.deepEqual((await react(b, daehyun.id, '😂')).data.reactions, [{ characterId: daehyun.id, emoji: '😂' }]);
  assert.deepEqual((await react(b, daehyun.id, '😂')).data.reactions, []);
  assert.equal((await react(b, daehyun.id, 'lol')).status, 400);
  assert.equal((await react(snoop, daehyun.id, '❤️')).status, 404);

  // A call shows in the conversation and as "{b} missed a call from {a}".
  const call = await a(`/api/phone/threads/${thread.id}/call`, { method: 'POST', body: { as: yoonoh.id } });
  assert.equal(call.data.message.kind, 'call');
  const missed = (await b('/api/notifications')).data.notifications.find((n) => n.type === 'call');
  assert.equal(missed.from.name, 'Cha Yoonoh');
  assert.equal(missed.to.name, 'Bang Daehyun');
  await b(`/api/phone/threads/${thread.id}/read`, { method: 'POST', body: { as: daehyun.id, lastId: call.data.message.id } });
  assert.equal((await a(`/api/phone/threads/${thread.id}?as=${yoonoh.id}`)).data.thread.readUpTo, call.data.message.id);
  assert.equal((await b('/api/phone/unread')).data.unread[daehyun.id], undefined);

  // Blocking ends it.
  await b('/api/blocks', { method: 'POST', body: { userId: (await a('/api/me')).data.user.id } });
  assert.equal((await a(`/api/phone/threads/${thread.id}/messages`, { method: 'POST', body: { as: yoonoh.id, body: 'hello?' } })).status, 403);
  assert.equal((await a(`/api/phone/${yoonoh.id}`)).data.threads.length, 0);
});

test('phones: group texts with three or more characters', async () => {
  const a = await app.signUp('grp_a');
  const b = await app.signUp('grp_b');
  const c = await app.signUp('grp_c');
  const out = await app.signUp('grp_out');
  const mk = async (who, name) => (await who('/api/characters', { method: 'POST', body: { name } })).data.character;
  const [ann, bo, cy, dee] = [await mk(a, 'Ann Grp'), await mk(b, 'Bo Grp'), await mk(c, 'Cy Grp'), await mk(out, 'Dee Grp')];
  assert.equal((await a(`/api/phone/${ann.id}/groups`, { method: 'POST', body: { memberIds: [bo.id] } })).status, 400); // needs two others
  const g = (await a(`/api/phone/${ann.id}/groups`, { method: 'POST', body: { memberIds: [bo.id, cy.id], title: 'Crew' } })).data.thread;
  assert.equal(g.group, true);
  assert.equal(g.name, 'Crew');
  assert.equal(g.members.length, 2);
  await a(`/api/phone/threads/${g.id}/messages`, { method: 'POST', body: { as: ann.id, body: 'meeting at 9' } });
  const forBo = (await b('/api/notifications')).data.notifications.find((n) => n.type === 'dm');
  assert.equal(forBo.group.title, 'Crew');
  assert.equal(forBo.to.name, 'Bo Grp');
  assert.ok((await c('/api/notifications')).data.notifications.some((n) => n.type === 'dm' && n.url === `#/phone/${cy.id}/t/${g.id}`));
  const boPhone = (await b(`/api/phone/${bo.id}`)).data;
  assert.equal(boPhone.threads[0].group, true);
  assert.equal(boPhone.threads[0].last.text, 'Ann: meeting at 9');
  assert.equal((await out(`/api/phone/threads/${g.id}?as=${dee.id}`)).status, 404);
  // Anyone in it can rename it or add people; only the starter can remove others; anyone can leave.
  assert.equal((await b(`/api/phone/threads/${g.id}`, { method: 'PUT', body: { as: bo.id, title: 'Crew 🖤' } })).status, 200);
  assert.equal((await b(`/api/phone/threads/${g.id}/members`, { method: 'POST', body: { as: bo.id, memberIds: [dee.id] } })).data.added, 1);
  assert.equal((await out(`/api/phone/threads/${g.id}?as=${dee.id}`)).data.thread.name, 'Crew 🖤');
  assert.equal((await b(`/api/phone/threads/${g.id}/members/${cy.id}?as=${bo.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await a(`/api/phone/threads/${g.id}/members/${cy.id}?as=${ann.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await c(`/api/phone/threads/${g.id}?as=${cy.id}`)).status, 404);
  assert.equal((await out(`/api/phone/threads/${g.id}/members/${dee.id}?as=${dee.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await a(`/api/phone/threads/${g.id}?as=${ann.id}`)).data.thread.members.length, 1);
});

test('story overview: owners write the lore page, members read it', async () => {
  const gm = await app.signUp('ov_gm');
  const a = await app.signUp('ov_a');
  const { story } = await makeStory(gm, { title: 'Lore', visibility: 'public' });
  await a(`/api/stories/${story.id}/join`, { method: 'POST', body: {} });
  const empty = (await a(`/api/stories/${story.id}/overview`)).data;
  assert.deepEqual(empty.overview, {});
  assert.equal(empty.canEdit, false);
  const body = {
    tagline: 'nobody meets by accident.', intro: 'every introduction can be traced…',
    sections: [{ title: 'ownership', body: 'someone funded it.' }, { title: '', body: '' }],
    orgs: [{ name: 'FOYAEN INC.', kind: 'conglomerate', founded: '2019' }, { name: 'AUURA', kind: 'subsidiary', parent: 'FOYAEN INC.' }, { name: '' }],
  };
  assert.equal((await a(`/api/stories/${story.id}/overview`, { method: 'PUT', body })).status, 403);
  const saved = (await gm(`/api/stories/${story.id}/overview`, { method: 'PUT', body })).data.overview;
  assert.equal(saved.sections.length, 1);
  assert.deepEqual(saved.orgs.map((o) => o.name), ['FOYAEN INC.', 'AUURA']);
  const read = (await a(`/api/stories/${story.id}/overview`)).data;
  assert.equal(read.overview.tagline, 'nobody meets by accident.');
  assert.equal(read.stats.writers, 2);
  assert.equal((await a(`/api/stories/${story.id}`)).data.story.hasOverview, true);
  assert.equal((await gm(`/api/stories/${story.id}/overview`, { method: 'PUT', body: { intro: 'x'.repeat(30001) } })).status, 400);
});

test('gradient colors, shared NPCs with categories, header pictures, and no pushes while active', async () => {
  const a = await app.signUp('grad_a');
  const b = await app.signUp('grad_b');
  const c = (await a('/api/characters', { method: 'POST', body: { name: 'Gradient Girl', gradient: ['#EE719E', '#B8A6DB'] } })).data.character;
  assert.deepEqual(c.gradient, ['#EE719E', '#B8A6DB']);
  assert.equal((await a(`/api/characters/${c.id}`, { method: 'PUT', body: { gradient: ['#EE719E'] } })).status, 400);
  assert.equal((await a(`/api/characters/${c.id}`, { method: 'PUT', body: { gradient: '' } })).data.character.gradient, null);

  const npc = (await a('/api/characters', { method: 'POST', body: { name: 'Doorman Lee', npc: true, npcTags: 'Staff, #FOYAEN, staff' } })).data.character;
  assert.deepEqual(npc.npcTags, ['staff', 'foyaen']);
  const listed = (await b('/api/npcs')).data;
  assert.ok(listed.npcs.some((x) => x.id === npc.id && x.owner.username === 'grad_a'));
  assert.ok(listed.tags.includes('foyaen'));
  // Anyone's NPC can be tagged into a story its writer isn't in.
  const story = (await b('/api/stories', { method: 'POST', body: { title: 'NPC land', visibility: 'public' } })).data.story;
  const ch = await b(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'lobby', tagged: [npc.id] } });
  assert.equal(ch.status, 201, JSON.stringify(ch.data));
  assert.equal((await b(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'no', tagged: [c.id] } })).status, 400);

  // Until an admin picks some, the pictures that ship in public/headers/ are used.
  const bundled = (await a('/api/headers')).data.headers;
  assert.ok(bundled.length > 0 && bundled.every((h) => /^\/headers\/[\w.-]+\.jpg$/.test(h)));
  assert.equal((await b('/api/headers', { method: 'PUT', body: { headers: ['/headers/one.jpg'] } })).status, 403);
  const set = await app.admin('/api/headers', { method: 'PUT', body: { headers: ['/headers/one.jpg', 'https://i.pinimg.com/x.jpg'] } });
  assert.deepEqual(set.data.headers, ['/headers/one.jpg', 'https://i.pinimg.com/x.jpg']);
  assert.equal((await app.admin('/api/headers', { method: 'PUT', body: { headers: ['/etc/passwd'] } })).status, 400);
});

test('push pop-ups are skipped while the person has NUUVI open in front of them', async () => {
  const p = await startApp();
  try {
    const owner = await p.signUp('vis_owner');
    const fan = await p.signUp('vis_fan');
    const ownerChar = (await owner('/api/characters', { method: 'POST', body: { name: 'Star' } })).data.character;
    const fanChar = (await fan('/api/characters', { method: 'POST', body: { name: 'Fan' } })).data.character;
    const { createECDH, randomBytes } = await import('node:crypto');
    const ua = createECDH('prime256v1');
    const subscription = { endpoint: 'https://push.example.com/send/vis', keys: { p256dh: ua.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    assert.equal((await owner('/api/push/subscribe', { method: 'POST', body: { subscription } })).status, 200);
    const post = (await owner('/api/social', { method: 'POST', body: { characterId: ownerChar.id, body: 'hi' } })).data.post;
    // Owner has a visible tab open.
    const ctrl = new AbortController();
    const res = await fetch(`${p.base}/api/events?tab=t1`, { headers: { Cookie: owner.cookie() }, signal: ctrl.signal });
    await new Promise((r) => setTimeout(r, 50));
    await fan(`/api/social/${post.id}/like`, { method: 'POST', body: { asCharacterId: fanChar.id } });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(p.pushes.length, 0);
    // Tab goes to the background: pushes resume.
    await owner('/api/live/visible', { method: 'POST', body: { tab: 't1', visible: false } });
    await fan(`/api/social/${post.id}/comments`, { method: 'POST', body: { characterId: fanChar.id, body: 'yay' } });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(p.pushes.length >= 1);
    ctrl.abort(); void res;
  } finally { p.close(); }
});

test('a writer\'s own gradient, and like/comment numbers set on a character\'s post', async () => {
  const a = await app.signUp('colors_a');
  const b = await app.signUp('colors_b');
  assert.equal((await a('/api/me')).data.user.gradient, null);
  const me = await a('/api/me', { method: 'PUT', body: { displayName: 'Colors A', gradient: ['#EE719E', '#C79AD8', '#B8A6DB'] } });
  assert.deepEqual(me.data.user.gradient, ['#EE719E', '#C79AD8', '#B8A6DB']);
  assert.equal((await a('/api/me', { method: 'PUT', body: { gradient: ['red', 'blue'] } })).status, 400);
  // Saving the profile without colors keeps them.
  assert.deepEqual((await a('/api/me', { method: 'PUT', body: { bio: 'hi' } })).data.user.gradient.length, 3);
  const profile = (await b(`/api/users/${me.data.user.id}`)).data.user;
  assert.deepEqual(profile.gradient, ['#EE719E', '#C79AD8', '#B8A6DB']);

  const star = (await a('/api/characters', { method: 'POST', body: { name: 'Famous Fern' } })).data.character;
  const post = (await a('/api/social', { method: 'POST', body: { characterId: star.id, body: 'hello world' } })).data.post;
  assert.equal(post.likes, 0);
  assert.equal((await b(`/api/social/${post.id}`, { method: 'PUT', body: { likesDisplay: 5 } })).status, 404);
  const set = (await a(`/api/social/${post.id}`, { method: 'PUT', body: { likesDisplay: 1200000, commentsDisplay: 3400 } })).data.post;
  assert.equal(set.likes, 1200000);
  assert.equal(set.commentCount, 3400);
  assert.equal(set.editedAt, null, 'changing the numbers does not mark the post as edited');
  assert.equal((await a(`/api/social/${post.id}`, { method: 'PUT', body: { likesDisplay: -3 } })).status, 400);
  const reset = (await a(`/api/social/${post.id}`, { method: 'PUT', body: { likesDisplay: null } })).data.post;
  assert.equal(reset.likes, 0);
  assert.equal(reset.commentCount, 3400);
});

test('the lore is one page for the whole world: everyone reads it, only admins edit it', async () => {
  const a = await app.signUp('lore_reader');
  const lore = (await a('/api/lore')).data;
  assert.equal(lore.overview.tagline, 'nobody in this world actually meets by accident.');
  assert.ok(lore.overview.orgs.some((o) => o.name === 'FOYAEN INC.'));
  assert.equal(lore.canEdit, false);
  assert.equal((await a('/api/lore', { method: 'PUT', body: { tagline: 'nope' } })).status, 403);
  const saved = await app.admin('/api/lore', { method: 'PUT', body: { ...lore.overview, tagline: 'everyone knows someone.' } });
  assert.equal(saved.status, 200);
  assert.equal((await a('/api/lore')).data.overview.tagline, 'everyone knows someone.');
});

test('connections: post an idea, someone picks it up for their muse, it locks', async () => {
  const a = await app.signUp('conn_a');
  const b = await app.signUp('conn_b');
  const mine = (await a('/api/characters', { method: 'POST', body: { name: 'Seo Jin' } })).data.character;
  const theirs = (await b('/api/characters', { method: 'POST', body: { name: 'Han Eli' } })).data.character;
  const made = await a('/api/connections', { method: 'POST', body: { characterId: mine.id, title: 'the ex who kept my hoodie', body: 'looking for…', tags: 'Ex, #angst' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const k = made.data.connection;
  assert.deepEqual(k.tags, ['ex', 'angst']);
  assert.ok((await b('/api/feed')).data.items.some((i) => i.type === 'connection' && i.id === k.id));
  assert.equal((await a(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: mine.id } })).status, 400);
  assert.equal((await b(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: mine.id } })).status, 400);
  const taken = await b(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: theirs.id } });
  assert.equal(taken.data.connection.takenBy.character.id, theirs.id);
  assert.equal((await b(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: theirs.id } })).status, 409);
  assert.ok((await a('/api/notifications')).data.notifications.some((n) => n.type === 'connection'));
  // Still on THE : NU, locked.
  assert.ok((await a('/api/feed?filter=connection')).data.items.find((i) => i.id === k.id).takenBy);
  assert.equal((await b(`/api/connections/${k.id}/release`, { method: 'POST', body: {} })).data.connection.takenBy, null);
});

test('messages: private conversations between writers', async () => {
  const a = await app.signUp('msg_a');
  const b = await app.signUp('msg_b');
  const c = await app.signUp('msg_c');
  const bId = (await b('/api/me')).data.user.id;
  const aId = (await a('/api/me')).data.user.id;
  const sent = await a(`/api/messages/${bId}`, { method: 'POST', body: { body: 'hey! plotting later?' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.equal((await b('/api/home')).data.messagesUnread, 1);
  const list = (await b('/api/messages')).data.conversations;
  assert.equal(list[0].with.id, aId);
  assert.equal(list[0].unread, 1);
  assert.equal((await b(`/api/messages/${aId}`)).data.messages[0].body, 'hey! plotting later?');
  await b(`/api/messages/${aId}/read`, { method: 'POST', body: {} });
  assert.equal((await b('/api/home')).data.messagesUnread, 0);
  // Nobody else can see it.
  assert.equal((await c('/api/messages')).data.conversations.length, 0);
  assert.equal((await c(`/api/messages/item/${sent.data.message.id}`, { method: 'DELETE' })).status, 404);
  // Blocking stops messages.
  await b('/api/blocks', { method: 'POST', body: { userId: aId } });
  assert.equal((await a(`/api/messages/${bId}`, { method: 'POST', body: { body: 'hello?' } })).status, 403);
});

test('saving a character without choosing bot or NPC keeps them in your own cast', async () => {
  const a = await app.signUp('cast_saver');
  const c = (await a('/api/characters', { method: 'POST', body: { name: 'Plain Jane', npc: false, bot: null } })).data.character;
  assert.equal(c.npc, false);
  const saved = await a(`/api/characters/${c.id}`, { method: 'PUT', body: { name: 'Plain Jane', npc: false, bot: null, botLines: {} } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.character.bot, null);
  assert.equal((await a(`/api/characters/${c.id}`, { method: 'PUT', body: { bot: '' } })).status, 200);
});

test('each writer can drag their stories into their own sidebar order', async () => {
  const a = await app.signUp('rail_sorter');
  const s1 = (await makeStory(a, { title: 'One' })).story;
  const s2 = (await makeStory(a, { title: 'Two' })).story;
  const s3 = (await makeStory(a, { title: 'Three' })).story;
  const ids = async () => (await a('/api/home')).data.stories.map((s) => s.id);
  assert.deepEqual(await ids(), [s3.id, s2.id, s1.id]); // newest activity first until sorted
  const saved = await a('/api/home/order', { method: 'PUT', body: { storyIds: [s1.id, s3.id, s2.id] } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(await ids(), [s1.id, s3.id, s2.id]);
  // Activity doesn't shuffle a sorted sidebar; a new story shows on top until it's placed.
  await post(a, (await a(`/api/stories/${s2.id}`)).data.channels[0].id, { kind: 'ooc', body: 'bump' });
  const s4 = (await makeStory(a, { title: 'Four' })).story;
  assert.deepEqual(await ids(), [s4.id, s1.id, s3.id, s2.id]);
  // Stories you're not in are ignored.
  const other = (await makeStory(await app.signUp('rail_other'))).story;
  assert.equal((await a('/api/home/order', { method: 'PUT', body: { storyIds: [other.id, s2.id] } })).status, 200);
  const after = await ids();
  assert.equal(after.includes(other.id), false);
  assert.equal(after.at(-1), s2.id);
  assert.equal((await a('/api/home/order', { method: 'PUT', body: { storyIds: 'nope' } })).status, 400);
});

test('admins can see every writer\'s private story, but not another admin\'s unless added', async () => {
  const admin = app.admin;
  // A regular writer's private story: admins can open it, list it and moderate it.
  const writer = await app.signUp('private_writer');
  const { story: wStory, main: wMain } = await makeStory(writer, { title: 'Writer Secret', visibility: 'private' });
  assert.equal((await admin(`/api/stories/${wStory.id}`)).status, 200);
  assert.equal((await admin(`/api/channels/${wMain.id}`)).status, 200);
  assert.equal((await admin('/api/admin/stories')).data.stories.find((s) => s.id === wStory.id).title, 'Writer Secret');
  // Ordinary writers still can't.
  const stranger = await app.signUp('private_stranger');
  assert.equal((await stranger(`/api/stories/${wStory.id}`)).status, 404);

  // A private story that belongs to an admin stays theirs: other admins can't get in.
  const boss = await app.signUp('private_boss');
  const bossId = (await boss('/api/me')).data.user.id;
  await admin(`/api/admin/users/${bossId}/role`, { method: 'PUT', body: { isAdmin: true } });
  const { story, main } = await makeStory(boss, { title: 'Secret Garden', visibility: 'private' });
  assert.equal((await admin(`/api/stories/${story.id}`)).status, 404);
  assert.equal((await admin(`/api/channels/${main.id}`)).status, 404);
  assert.equal((await admin(`/api/stories/${story.id}/characters`)).status, 404);
  assert.equal((await admin(`/api/stories/${story.id}/join`, { method: 'POST', body: {} })).status, 404);
  const listed = (await admin('/api/admin/stories')).data.stories.find((s) => s.id === story.id);
  assert.equal(listed.title, 'Private story');
  assert.equal(listed.hidden, true);
  assert.equal((await admin(`/api/admin/stories/${story.id}`, { method: 'DELETE' })).status, 404);
  // The owner adds people by username.
  const adminName = (await admin('/api/me')).data.user.username;
  assert.equal((await stranger(`/api/stories/${story.id}/members`, { method: 'POST', body: { username: adminName } })).status, 404);
  assert.equal((await boss(`/api/stories/${story.id}/members`, { method: 'POST', body: { username: 'nobody_here' } })).status, 404);
  const added = await boss(`/api/stories/${story.id}/members`, { method: 'POST', body: { username: `@${adminName}` } });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  assert.equal((await boss(`/api/stories/${story.id}/members`, { method: 'POST', body: { username: adminName } })).status, 400);
  assert.equal((await admin(`/api/stories/${story.id}`)).status, 200);
  assert.equal((await admin('/api/admin/stories')).data.stories.find((s) => s.id === story.id).title, 'Secret Garden');
  assert.ok((await admin('/api/notifications')).data.notifications.some((n) => n.type === 'added' && n.url === `#/s/${story.id}`));
});

test('any channel can be deleted, even the last one', async () => {
  const owner = await app.signUp('chan_deleter');
  const { story, main, ooc } = await makeStory(owner);
  assert.equal((await owner(`/api/channels/${ooc.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await owner(`/api/channels/${main.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await owner(`/api/stories/${story.id}`)).data.channels.length, 0);
});

test('a story marked complete goes to the Archive: read-only until reopened', async () => {
  const owner = await app.signUp('archive_owner');
  const { story, main } = await makeStory(owner, { title: 'Finished Tale' });
  assert.equal((await post(owner, main.id, { kind: 'ooc', body: 'last words' })).status, 201);
  const done = await owner(`/api/stories/${story.id}`, { method: 'PUT', body: { complete: true } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.ok(done.data.story.completedAt);
  const home = (await owner('/api/home')).data.stories.find((s) => s.id === story.id);
  assert.ok(home.completedAt);
  assert.equal(home.role, 'owner');
  // Still readable, but nobody can post or start episodes.
  assert.equal((await owner(`/api/channels/${main.id}`)).status, 200);
  assert.equal((await owner(`/api/channels/${main.id}`)).data.canPost, false);
  assert.equal((await post(owner, main.id, { kind: 'ooc', body: 'one more?' })).status, 403);
  assert.equal((await owner(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'sequel', kind: 'thread' } })).status, 403);
  // Reopen it.
  await owner(`/api/stories/${story.id}`, { method: 'PUT', body: { complete: false } });
  assert.equal((await owner('/api/home')).data.stories.find((s) => s.id === story.id).completedAt, null);
  assert.equal((await post(owner, main.id, { kind: 'ooc', body: 'we are back' })).status, 201);
});

test('character profiles: anyone reads, the writer (or an admin) edits; pronouns come from the profile', async () => {
  const w = await app.signUp('dossier_writer');
  const other = await app.signUp('dossier_reader');
  const c = (await w('/api/characters', { method: 'POST', body: { name: 'Shiloh Rockwell', color: '#8fa3c9' } })).data.character;
  const empty = await other(`/api/profiles/${c.id}`);
  assert.equal(empty.status, 200);
  assert.equal(empty.data.canEdit, false);
  assert.equal((await other(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier: { quote: 'nope' } } })).status, 404);
  const saved = await w(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier: {
    quote: 'bass first, questions later', traits: ['loyal', 'reckless'],
    facts: { age: '25', pronouns: 'he/him', occupation: 'bassist', bogus: 'x' },
    sections: { history: 'Born in **Portland**.' }, playlist: [{ title: 'Ditto', artist: 'NewJeans' }, { title: '' }],
  } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.dossier.facts.bogus, undefined);
  assert.equal(saved.data.dossier.playlist.length, 1);
  assert.equal(saved.data.character.pronouns, 'he/him');
  const list = (await other('/api/profiles')).data.profiles.find((p) => p.id === c.id);
  assert.equal(list.quote, 'bass first, questions later');
  assert.equal(list.occupation, 'bassist');
  assert.equal((await app.admin(`/api/profiles/${c.id}`)).data.canEdit, true);
});

test('episodes carry a picture, a season and a location; posts and social posts can tag a place', async () => {
  const w = await app.signUp('ep_maker');
  const { story } = await makeStory(w);
  const ch = (await w('/api/characters', { method: 'POST', body: { name: 'Mina', color: '#c97a96' } })).data.character;
  const made = await w(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'the rooftop', kind: 'thread', season: 2, location: 'Gangnam rooftop', banner: 'https://example.com/a.jpg' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.channel.season, 2);
  assert.equal(made.data.channel.location, 'Gangnam rooftop');
  assert.equal(made.data.channel.banner, 'https://example.com/a.jpg');
  assert.equal((await w(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'bad', season: 0 } })).status, 400);
  const p = await post(w, made.data.channel.id, { kind: 'ic', characterId: ch.id, body: 'She followed him downstairs.', location: 'The basement bar' });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  assert.equal(p.data.post.location, 'The basement bar');
  const sp = await w('/api/social', { method: 'POST', body: { characterId: ch.id, kind: 'text', body: 'coffee run', location: 'Seongsu' } });
  assert.equal(sp.data.post.location, 'Seongsu');
  const feed = (await w('/api/feed?filter=all')).data.items.find((i) => i.type === 'thread' && i.id === made.data.channel.id);
  assert.equal(feed.banner, 'https://example.com/a.jpg');
  assert.equal(feed.season, 2);
  const { locations } = (await w('/api/locations')).data;
  for (const l of ['Gangnam rooftop', 'The basement bar', 'Seongsu']) assert.ok(locations.includes(l), l);
});

test('username changes have a 3-hour cool-off, and About can be hidden', async () => {
  const u = await app.signUp('renamer');
  const first = await u('/api/me', { method: 'PUT', body: { username: 'renamed_once' } });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.user.username, 'renamed_once');
  const again = await u('/api/me', { method: 'PUT', body: { username: 'renamed_twice' } });
  assert.equal(again.status, 429);
  assert.match(again.data.error, /again in/);
  await app.signUp('taken_name');
  // Saving other things with the same username is fine.
  assert.equal((await u('/api/me', { method: 'PUT', body: { username: 'renamed_once', bio: 'hi there', showAbout: false } })).status, 200);
  const id = first.data.user.id;
  const seen = (await (await app.signUp('about_viewer'))(`/api/users/${id}`)).data.user;
  assert.equal(seen.showAbout, false);
  assert.equal(seen.bio, '');
});

test('crowd comments use the poster\'s pronouns and react to the post', async () => {
  const { sampleBuzz, pronounSet } = await import('../server/buzz.js');
  assert.equal(pronounSet('she/her').sub, 'she');
  assert.equal(pronounSet('he/him').obj, 'him');
  assert.equal(pronounSet('').sub, 'they');
  assert.equal(pronounSet('they/them').pos, 'their');
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const lines = sampleBuzz({ body: 'new fit tonight', kind: 'photo', location: 'Paris' }, { name: 'Mina Park', pronouns: 'she/her' }, 300, rand);
  assert.ok(!lines.some((l) => /\b(he|him|his)\b/i.test(l)), 'no wrong pronouns');
  assert.ok(lines.some((l) => /fit|jacket|shoes|stylist/i.test(l)), 'reacts to the outfit');
  assert.ok(lines.some((l) => /overrated|trying|unfollow|stylist|crime|didn't need|desperation|pr team|filter/i.test(l)), 'some critics too');
});

test('fan comments only say a tagged person is in the picture when the writer says so', async () => {
  const { sampleBuzz } = await import('../server/buzz.js');
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const inPic = /@yoon (looks so good here|in the pics|photobombing|in the background|is in it)|why is @yoon in this|is @yoon there too|and @yoon in one frame/;
  const post = { body: 'night out with @yoon', kind: 'photo' };
  const apart = sampleBuzz(post, { name: 'Mina Park' }, 400, rand, ['@yoon']);
  assert.ok(apart.some((l) => l.includes('@yoon')), 'still mentions them');
  assert.ok(!apart.some((l) => inPic.test(l)), 'never says they are in it');
  const together = sampleBuzz({ ...post, meta: JSON.stringify({ tagged: true }) }, { name: 'Mina Park' }, 400, rand, ['@yoon']);
  assert.ok(together.some((l) => inPic.test(l)), 'says so when they are');
});

test('THE : NU posts: musings, back-dating, numbers set when posting, liked-by, fresh comments after edits', async () => {
  const w = await app.signUp('nu_poster');
  const c = (await w('/api/characters', { method: 'POST', body: { name: 'Cha Yoonoh', color: '#8fa3c9' } })).data.character;
  const liker = (await w('/api/characters', { method: 'POST', body: { name: 'Mina Park', color: '#c97a96' } })).data.character;
  const made = await w('/api/social', { method: 'POST', body: { characterId: c.id, kind: 'text', body: 'studio all night #TrinityTour', category: 'musing',
    likesDisplay: '12,000', commentsDisplay: 400, postedAt: '2025-03-01T20:30:00.000Z' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const p = made.data.post;
  assert.equal(p.category, 'musing');
  assert.equal(p.createdAt, '2025-03-01 20:30:00');
  assert.equal(p.likes, 12000);
  const full = (await w(`/api/social/${p.id}`)).data.post;
  assert.ok(full.buzz.length >= 100, `a quarter of 400 comments written out (got ${full.buzz.length})`);
  assert.equal(new Set(full.buzz.map((b) => b.body.toLowerCase())).size, full.buzz.length, 'no repeated comments');
  // Musings have their own filter.
  const musings = (await w('/api/feed?filter=musing')).data.items;
  assert.ok(musings.some((i) => i.id === p.id));
  assert.ok(!(await w('/api/feed?filter=social')).data.items.some((i) => i.type === 'social' && i.id === p.id));
  // Liked by a character.
  await w(`/api/social/${p.id}/like`, { method: 'POST', body: { asCharacterId: liker.id } });
  assert.equal((await w(`/api/social/${p.id}`)).data.post.likers[0].id, liker.id);
  // Editing the caption brings new comments that fit it.
  const before = full.buzz.map((b) => b.body).join('|');
  const edited = await w(`/api/social/${p.id}`, { method: 'PUT', body: { body: 'beach day with the band 🌊' } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  const after = (await w(`/api/social/${p.id}`)).data.post.buzz;
  assert.ok(after.length >= 100);
  assert.notEqual(after.map((b) => b.body).join('|'), before);
  // "Write fresh fan comments" replaces every old one, even when nothing else changed.
  const again = await w(`/api/social/${p.id}`, { method: 'PUT', body: { freshComments: true, taggedIn: true } });
  assert.equal(again.data.post.meta.tagged, true);
  const old = new Set(after.map((b) => `${b.handle}|${b.body}`));
  const kept = again.data.post.buzz.filter((b) => old.has(`${b.handle}|${b.body}`)).length;
  assert.ok(again.data.post.buzz.length >= 100 && kept < 5, `old fan comments are gone (${kept} look the same)`);
});

test('group connections: several people can join, the writer edits it, and it locks when full', async () => {
  const a = await app.signUp('conn_writer');
  const b = await app.signUp('conn_one');
  const c = await app.signUp('conn_two');
  const d = await app.signUp('conn_three');
  const mk = async (who, name) => (await who('/api/characters', { method: 'POST', body: { name, color: '#8fa3c9' } })).data.character;
  const [ca, cb, cc, cd] = [await mk(a, 'Lead'), await mk(b, 'One'), await mk(c, 'Two'), await mk(d, 'Three')];
  const k = (await a('/api/connections', { method: 'POST', body: { characterId: ca.id, title: 'the band', slots: 2 } })).data.connection;
  assert.equal(k.slots, 2);
  assert.equal((await b(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: cb.id } })).data.connection.full, false);
  const full = (await c(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: cc.id } })).data.connection;
  assert.equal(full.full, true);
  assert.equal(full.takers.length, 2);
  assert.equal((await d(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: cd.id } })).status, 409);
  // The writer makes room for one more and renames it.
  assert.equal((await a(`/api/connections/${k.id}`, { method: 'PUT', body: { slots: 1 } })).status, 400);
  const edited = (await a(`/api/connections/${k.id}`, { method: 'PUT', body: { slots: 3, title: 'the whole band' } })).data.connection;
  assert.equal(edited.title, 'the whole band');
  assert.equal(edited.full, false);
  assert.equal((await b(`/api/connections/${k.id}`, { method: 'PUT', body: { title: 'mine now' } })).status, 403);
  assert.equal((await d(`/api/connections/${k.id}/take`, { method: 'POST', body: { characterId: cd.id } })).status, 200);
  // Someone leaves.
  const left = (await b(`/api/connections/${k.id}/release`, { method: 'POST', body: {} })).data.connection;
  assert.equal(left.takers.length, 2);
});

test('birthdays come from character profiles; only the site owner gets update notices', async () => {
  const { parseBirthday } = await import('../server/routes/profiles.js');
  assert.deepEqual(parseBirthday('March 3'), { month: 3, day: 3 });
  assert.deepEqual(parseBirthday('3rd of March'), { month: 3, day: 3 });
  assert.deepEqual(parseBirthday('1999-12-25'), { month: 12, day: 25 });
  assert.deepEqual(parseBirthday('10/31'), { month: 10, day: 31 });
  assert.equal(parseBirthday('someday'), null);
  const w = await app.signUp('bday_writer');
  const c = (await w('/api/characters', { method: 'POST', body: { name: 'Birthday Kid', color: '#8fa3c9' } })).data.character;
  await w(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier: { facts: { birthday: 'October 14' } } } });
  const b = (await w('/api/birthdays')).data.birthdays.find((x) => x.id === c.id);
  assert.deepEqual([b.month, b.day], [10, 14]);
  assert.equal((await app.admin('/api/home')).data.isOwner, true);
  assert.equal((await w('/api/home')).data.isOwner, false);
});

test('photo tags: tag people on photos, they hear about it, fan comments know they are in it, Tagged tab', async () => {
  const a = await app.signUp('ptag_a');
  const b = await app.signUp('ptag_b');
  const mk = async (who, name, extra = {}) => (await who('/api/characters', { method: 'POST', body: { name, ...extra } })).data.character;
  const mina = await mk(a, 'Mina Ptag');
  const ivy = await mk(b, 'Ivy Ptag');
  const leo = await mk(b, 'Leo Ptag');
  const pics = ['https://i.pinimg.com/originals/a/b/1.jpg', 'https://i.pinimg.com/originals/a/b/2.jpg'];
  // A tag off the photo, or on a photo that isn't there, isn't kept.
  assert.equal((await a('/api/social', { method: 'POST', body: { characterId: mina.id, kind: 'photo', media: pics, photoTags: [{ characterId: ivy.id, mediaIndex: 0, x: 1.5, y: 0.2 }] } })).status, 400);
  const res = await a('/api/social', { method: 'POST', body: { characterId: mina.id, kind: 'photo', body: 'pier day', media: pics,
    photoTags: [{ characterId: ivy.id, mediaIndex: 1, x: 0.25, y: 0.5 }, { characterId: leo.id, mediaIndex: 7, x: 0.5, y: 0.5 }] } });
  assert.equal(res.status, 201);
  const post = res.data.post;
  assert.deepEqual(post.photoTags.map((t) => [t.name, t.mediaIndex, t.x, t.y]), [['Ivy Ptag', 1, 0.25, 0.5]]);
  const note = (await b('/api/notifications')).data.notifications.find((n) => n.type === 'socialtag');
  assert.match(note.text, /Mina Ptag tagged Ivy Ptag in a photo/);
  assert.equal(note.from.name, 'Mina Ptag'); // the picture is the character who tagged
  // Fan comments treat photo-tagged people as in the picture.
  const meta = (await a(`/api/social/${post.id}`)).data.post.meta;
  assert.equal(meta.people[ivy.handle.toLowerCase()].in, true);
  // Ivy's Tagged tab has it (and @mentions too); Mina's own posts don't show on her own Tagged tab.
  await a('/api/social', { method: 'POST', body: { characterId: mina.id, kind: 'text', body: `coffee with @${leo.handle}!!` } });
  await a('/api/social', { method: 'POST', body: { characterId: mina.id, kind: 'text', body: `@${leo.handle}xyz is someone else` } });
  assert.deepEqual((await b(`/api/social?tagged=${ivy.id}`)).data.posts.map((p) => p.id), [post.id]);
  assert.deepEqual((await b(`/api/social?tagged=${leo.id}`)).data.posts.map((p) => p.body), [`coffee with @${leo.handle}!!`]);
  assert.equal((await a(`/api/social?tagged=${mina.id}`)).data.posts.length, 0);
  // Editing without photoTags keeps them; swapping a photo drops the tags on the old one; [] clears.
  const kept = (await a(`/api/social/${post.id}`, { method: 'PUT', body: { body: 'pier day 🌊' } })).data.post;
  assert.equal(kept.photoTags.length, 1);
  const swapped = (await a(`/api/social/${post.id}`, { method: 'PUT', body: { media: [pics[0], 'https://i.pinimg.com/originals/a/b/3.jpg'] } })).data.post;
  assert.equal(swapped.photoTags.length, 0);
  assert.equal((await a(`/api/social/${post.id}`)).data.post.meta.people, undefined);
  // Brand accounts.
  const shop = await mk(a, 'Velvet Café', { brand: true });
  assert.equal(shop.brand, true);
  const dir = (await b('/api/directory')).data.writers.flatMap((w) => w.characters);
  assert.equal(dir.find((c) => c.id === shop.id).brand, true);
  const bp = (await a('/api/social', { method: 'POST', body: { characterId: shop.id, kind: 'text', body: 'new matcha drop 🍵' } })).data.post;
  assert.equal(bp.character.brand, true);
  await a(`/api/characters/${shop.id}`, { method: 'PUT', body: { brand: false } });
  assert.equal((await a(`/api/characters/${shop.id}`)).data.character.brand, false);
});

test('stories on THE NU: post a photo or text story, it shows for 24 hours, seen rings, delete', async () => {
  const a = await app.signUp('sto_a');
  const b = await app.signUp('sto_b');
  const mina = (await a('/api/characters', { method: 'POST', body: { name: 'Mina Story' } })).data.character;
  const ivy = (await b('/api/characters', { method: 'POST', body: { name: 'Ivy Story' } })).data.character;
  assert.equal((await b('/api/social-stories', { method: 'POST', body: { characterId: mina.id, kind: 'text', body: 'hi' } })).status, 400); // not yours
  assert.equal((await a('/api/social-stories', { method: 'POST', body: { characterId: mina.id, kind: 'text', body: '  ' } })).status, 400);
  assert.equal((await a('/api/social-stories', { method: 'POST', body: { characterId: mina.id, kind: 'video', media: '/uploads/nope.mp4' } })).status, 400);
  const s1 = (await a('/api/social-stories', { method: 'POST', body: { characterId: mina.id, kind: 'photo', media: 'https://i.pinimg.com/originals/s/1.jpg' } })).data.story;
  const s2 = (await a('/api/social-stories', { method: 'POST', body: { characterId: mina.id, kind: 'text', body: 'pier at 9 🌊', bg: '#c93d72' } })).data.story;
  assert.equal(s2.bg, '#c93d72');
  await b('/api/social-stories', { method: 'POST', body: { characterId: ivy.id, kind: 'text', body: 'bored' } });
  let groups = (await b('/api/social-stories')).data.groups;
  const minaG = groups.find((g) => g.character.id === mina.id);
  assert.equal(groups[0].character.id, ivy.id); // your own first
  assert.deepEqual(minaG.stories.map((s) => s.id), [s1.id, s2.id]);
  assert.equal(minaG.allSeen, false);
  assert.equal(minaG.stories[0].views, undefined); // only the poster sees views
  await b(`/api/social-stories/${s1.id}/seen`, { method: 'POST', body: {} });
  await b(`/api/social-stories/${s2.id}/seen`, { method: 'POST', body: {} });
  groups = (await b('/api/social-stories')).data.groups;
  assert.equal(groups.find((g) => g.character.id === mina.id).allSeen, true);
  assert.equal((await a('/api/social-stories')).data.groups.find((g) => g.character.id === mina.id).stories[0].views, 1);
  // Older than 24 hours: gone from the strip.
  app.server.ctx.db.prepare("UPDATE social_stories SET created_at = datetime('now', '-25 hours') WHERE id = ?").run(s1.id);
  assert.deepEqual((await b('/api/social-stories')).data.groups.find((g) => g.character.id === mina.id).stories.map((s) => s.id), [s2.id]);
  assert.equal((await b(`/api/social-stories/${s2.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await a(`/api/social-stories/${s2.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await b('/api/social-stories')).data.groups.some((g) => g.character.id === mina.id), false);
});

test('Ardell City date: admins set a fixed date or a timer; new posts default to it', async () => {
  const admin = app.admin;
  const w = await app.signUp('clock_w');
  assert.equal((await w('/api/admin/clock', { method: 'PUT', body: { mode: 'fixed', date: '2025-03-01' } })).status, 403);
  assert.equal((await admin('/api/admin/clock', { method: 'PUT', body: { mode: 'fixed' } })).status, 400); // needs a date
  const fixed = (await admin('/api/admin/clock', { method: 'PUT', body: { mode: 'fixed', date: '2025-03-01' } })).data.clock;
  assert.equal(fixed.today, '2025-03-01');
  assert.equal((await w('/api/clock')).data.clock.today, '2025-03-01');
  const c = (await w('/api/characters', { method: 'POST', body: { name: 'Clock Kid' } })).data.character;
  const p = (await w('/api/social', { method: 'POST', body: { characterId: c.id, kind: 'text', body: 'morning' } })).data.post;
  assert.match(p.createdAt, /^2025-03-01 /);
  // A timer: one city day every 2 real days. Pretend it was set 5 real days ago.
  await admin('/api/admin/clock', { method: 'PUT', body: { mode: 'timer', date: '2025-03-01', every: 2 } });
  const row = app.server.ctx.db.prepare("SELECT value FROM settings WHERE key = 'clock'").get();
  const v = JSON.parse(row.value); v.anchor -= 5 * 86400000;
  app.server.ctx.db.prepare("UPDATE settings SET value = ? WHERE key = 'clock'").run(JSON.stringify(v));
  assert.equal((await w('/api/clock')).data.clock.today, '2025-03-03');
  await admin('/api/admin/clock', { method: 'PUT', body: { mode: 'real' } });
  assert.equal((await w('/api/clock')).data.clock.today, new Date().toISOString().slice(0, 10));
});

test('phone: texts and calls can be given a time; calls can be answered (with a length) or missed, voice or FaceTime', async () => {
  const a = await app.signUp('callt_a');
  const b = await app.signUp('callt_b');
  const x = (await a('/api/characters', { method: 'POST', body: { name: 'Caller X' } })).data.character;
  const y = (await b('/api/characters', { method: 'POST', body: { name: 'Callee Y' } })).data.character;
  const t = (await a(`/api/phone/${x.id}/threads`, { method: 'POST', body: { withId: y.id } })).data.thread;
  const later = (await a(`/api/phone/threads/${t.id}/messages`, { method: 'POST', body: { as: x.id, body: 'later', at: '2025-05-02T21:10:00.000Z' } })).data.message;
  assert.equal(later.createdAt, '2025-05-02 21:10:00');
  await a(`/api/phone/threads/${t.id}/messages`, { method: 'POST', body: { as: x.id, body: 'earlier', at: '2025-05-02T20:00:00.000Z' } });
  assert.equal((await a(`/api/phone/${x.id}`)).data.threads[0].last.text, 'later'); // the latest by time
  assert.equal((await a(`/api/phone/threads/${t.id}/messages`, { method: 'POST', body: { as: x.id, body: 'x', at: 'nope' } })).status, 400);
  const answered = (await a(`/api/phone/threads/${t.id}/call`, { method: 'POST', body: { as: x.id, answered: true, video: true, duration: 754, at: '2025-05-02T22:00:00.000Z' } })).data.message;
  assert.deepEqual(answered.call, { answered: true, video: true, duration: 754 });
  assert.equal((await b('/api/notifications')).data.notifications.some((n) => n.type === 'call'), false); // answered: no missed call
  assert.equal((await a(`/api/phone/${x.id}`)).data.threads[0].last.text, 'FaceTime · 13 min');
  const missed = (await a(`/api/phone/threads/${t.id}/call`, { method: 'POST', body: { as: x.id, answered: false, at: '2025-05-02T23:00:00.000Z' } })).data.message;
  assert.equal(missed.call.answered, false);
  assert.ok((await b('/api/notifications')).data.notifications.some((n) => n.type === 'call'));
  assert.equal((await a(`/api/phone/${x.id}`)).data.threads[0].last.text, 'Missed call');
});

test('private accounts: follow requests, approve or decline, and only followers see posts and stories', async () => {
  const a = await app.signUp('priv_a');
  const b = await app.signUp('priv_b');
  const star = (await a('/api/characters', { method: 'POST', body: { name: 'Private Star', private: true } })).data.character;
  assert.equal(star.private, true);
  const fan = (await b('/api/characters', { method: 'POST', body: { name: 'Fan One' } })).data.character;
  const fan2 = (await b('/api/characters', { method: 'POST', body: { name: 'Fan Two' } })).data.character;
  const post = (await a('/api/social', { method: 'POST', body: { characterId: star.id, kind: 'text', body: 'secret' } })).data.post;
  await a('/api/social-stories', { method: 'POST', body: { characterId: star.id, kind: 'text', body: 'secret story' } });
  // Locked for b.
  let prof = (await b(`/api/characters/${star.id}`)).data;
  assert.equal(prof.locked, true);
  assert.equal((await b(`/api/social?character=${star.id}`)).data.posts.length, 0);
  assert.equal((await b(`/api/social/${post.id}`)).status, 403);
  assert.equal((await b('/api/social-stories')).data.groups.some((g) => g.character.id === star.id), false);
  assert.equal((await a(`/api/social?character=${star.id}`)).data.posts.length, 1); // the writer still sees them
  // Follow = request.
  assert.equal((await b(`/api/characters/${star.id}/follow`, { method: 'POST', body: { asCharacterId: fan.id } })).data.requested, true);
  await b(`/api/characters/${star.id}/follow`, { method: 'POST', body: { asCharacterId: fan2.id } });
  prof = (await b(`/api/characters/${star.id}`)).data;
  assert.deepEqual(prof.requested.sort(), [fan.id, fan2.id].sort());
  assert.equal(prof.followedBy.length, 0);
  assert.equal((await b(`/api/characters/${star.id}/requests`)).status, 404); // not yours
  const reqs = (await a(`/api/characters/${star.id}/requests`)).data.requests;
  assert.equal(reqs.length, 2);
  assert.ok((await a('/api/notifications')).data.notifications.some((n) => n.type === 'followreq' && n.from.name === 'Fan One'));
  await a(`/api/characters/${star.id}/requests/${fan.id}`, { method: 'POST', body: { approve: true } });
  await a(`/api/characters/${star.id}/requests/${fan2.id}`, { method: 'POST', body: { approve: false } });
  prof = (await b(`/api/characters/${star.id}`)).data;
  assert.deepEqual(prof.followedBy, [fan.id]);
  assert.deepEqual(prof.requested, []);
  assert.equal(prof.locked, false);
  assert.equal((await b(`/api/social?character=${star.id}`)).data.posts.length, 1);
  assert.ok((await b('/api/social-stories')).data.groups.some((g) => g.character.id === star.id));
  assert.ok((await b('/api/notifications')).data.notifications.some((n) => /accepted Fan One's follow request/.test(n.text)));
  // Going public lets anyone still waiting in.
  await b(`/api/characters/${star.id}/follow`, { method: 'POST', body: { asCharacterId: fan2.id } });
  await a(`/api/characters/${star.id}`, { method: 'PUT', body: { private: false } });
  assert.equal((await b(`/api/characters/${star.id}`)).data.followedBy.length, 2);
});

test('ties, timelines, the Ardell Daily and polls', async () => {
  const a = await app.signUp('world_a');
  const b = await app.signUp('world_b');
  const mk = async (who, name, extra = {}) => (await who('/api/characters', { method: 'POST', body: { name, ...extra } })).data.character;
  const mina = await mk(a, 'Mina World');
  await a(`/api/profiles/${mina.id}`, { method: 'PUT', body: { dossier: { facts: { birthday: 'March 3' } } } });
  const ivy = await mk(b, 'Ivy World');
  // Ties: Mina calls Ivy her best friend; Ivy hasn't said back yet.
  assert.equal((await b(`/api/characters/${mina.id}/ties/${ivy.id}`, { method: 'PUT', body: { kind: 'friend' } })).status, 404); // not b's
  assert.equal((await a(`/api/characters/${mina.id}/ties/${ivy.id}`, { method: 'PUT', body: { kind: 'wizard' } })).status, 400);
  await a(`/api/characters/${mina.id}/ties/${ivy.id}`, { method: 'PUT', body: { kind: 'bestfriend', label: 'ride or die', note: 'since college', since: '2024-09-01' } });
  let ties = (await b(`/api/characters/${ivy.id}/ties`)).data;
  assert.equal(ties.ties.length, 0);
  assert.equal(ties.incoming[0].from.name, 'Mina World');
  assert.ok((await b('/api/notifications')).data.notifications.some((n) => n.type === 'tie' && n.from.name === 'Mina World'));
  await b(`/api/characters/${ivy.id}/ties/${mina.id}`, { method: 'PUT', body: { kind: 'bestfriend' } });
  ties = (await a(`/api/characters/${mina.id}/ties`)).data.ties;
  assert.deepEqual([ties[0].other.name, ties[0].label, ties[0].mutual.kind], ['Ivy World', 'ride or die', 'bestfriend']);
  // Names start with capitals however they're typed.
  assert.equal((await mk(a, 'jo de la cruz')).name, 'Jo De La Cruz');
  // Timeline: only the events the writer adds, oldest first. Only the writer can change it.
  const ev = (await a(`/api/characters/${mina.id}/timeline`, { method: 'POST', body: { date: '2021-09-01', title: 'Moved to Ardell', note: 'with two suitcases' } }));
  assert.equal(ev.status, 201);
  await a(`/api/characters/${mina.id}/timeline`, { method: 'POST', body: { date: '2019-05-20', title: 'Graduated' } });
  assert.equal((await a(`/api/characters/${mina.id}/timeline`, { method: 'POST', body: { date: 'someday', title: 'x' } })).status, 400);
  assert.equal((await b(`/api/characters/${mina.id}/timeline`, { method: 'POST', body: { date: '2020-01-01', title: 'nope' } })).status, 404);
  let tl = (await b(`/api/characters/${mina.id}/timeline`)).data;
  assert.deepEqual([tl.events.map((e) => e.title), tl.canEdit], [['Graduated', 'Moved to Ardell'], false]);
  await a(`/api/characters/${mina.id}/timeline/${ev.data.event.id}`, { method: 'PUT', body: { date: '2018-01-01', title: 'Moved to Ardell', note: '' } });
  tl = (await a(`/api/characters/${mina.id}/timeline`)).data;
  assert.deepEqual([tl.events[0].title, tl.events[0].date, tl.canEdit], ['Moved to Ardell', '2018-01-01', true]);
  await a(`/api/characters/${mina.id}/timeline/${ev.data.event.id}`, { method: 'DELETE' });
  assert.equal((await a(`/api/characters/${mina.id}/timeline`)).data.events.length, 1);
  // Family tree: Mina's mum, and the mum's own mother, sit on the rows above; a best friend isn't family.
  const mum = await mk(a, 'Ruth World');
  const gran = await mk(b, 'Esther World');
  await a(`/api/characters/${mina.id}/ties/${mum.id}`, { method: 'PUT', body: { kind: 'parent', label: 'mum' } });
  await b(`/api/characters/${gran.id}/ties/${mum.id}`, { method: 'PUT', body: { kind: 'child' } });
  const fam = (await b(`/api/characters/${mina.id}/family`)).data;
  const gens = Object.fromEntries(fam.members.map((m) => [m.character.name, m.gen]));
  assert.deepEqual(gens, { 'Mina World': 0, 'Ruth World': -1, 'Esther World': -2 });
  assert.equal(fam.members.find((m) => m.character.id === mum.id).relation.label, 'mum');
  assert.equal(fam.links.length, 2);
  // Polls: 2–4 choices; characters vote once each (again to change); fans can vote too.
  assert.equal((await a('/api/social', { method: 'POST', body: { characterId: mina.id, kind: 'text', body: 'q', poll: { question: 'q?', options: ['only one'] } } })).status, 400);
  const p = (await a('/api/social', { method: 'POST', body: { characterId: mina.id, kind: 'text', body: 'which bag?', likesDisplay: 100, poll: { question: 'Which bag?', options: ['Black', 'Red', 'Both'], crowd: true } } })).data.post;
  assert.equal(p.poll.options.length, 3);
  assert.equal(p.poll.total, 40); // 4 in 10 of the likes vote
  let poll = (await b(`/api/social/${p.id}/vote`, { method: 'POST', body: { characterId: ivy.id, choice: 1 } })).data.poll;
  assert.equal(poll.total, 41);
  assert.equal(poll.mine[ivy.id], 1);
  poll = (await b(`/api/social/${p.id}/vote`, { method: 'POST', body: { characterId: ivy.id, choice: 2 } })).data.poll;
  assert.equal(poll.total, 41);
  assert.equal(poll.mine[ivy.id], 2);
  poll = (await b(`/api/social/${p.id}/vote`, { method: 'POST', body: { characterId: ivy.id, choice: 2 } })).data.poll;
  assert.equal(poll.total, 40); // same choice again takes the vote back
  assert.equal((await b(`/api/social/${p.id}/vote`, { method: 'POST', body: { characterId: ivy.id, choice: 7 } })).status, 400);
  // Removing a tie.
  await a(`/api/characters/${mina.id}/ties/${ivy.id}`, { method: 'DELETE' });
  assert.equal((await a(`/api/characters/${mina.id}/ties`)).data.ties.map((t) => t.other.name).join(), 'Ruth World');
});

test('notifications: opening the tab clears the badge; answering clears the highlight', async () => {
  const a = await app.signUp('note_a');
  const b = await app.signUp('note_b');
  const mia = (await a('/api/characters', { method: 'POST', body: { name: 'Mia Note' } })).data.character;
  const kai = (await b('/api/characters', { method: 'POST', body: { name: 'Kai Note' } })).data.character;
  const post = (await a('/api/social', { method: 'POST', body: { characterId: mia.id, kind: 'text', body: 'hello' } })).data.post;
  await b(`/api/social/${post.id}/comments`, { method: 'POST', body: { characterId: kai.id, body: 'hi back' } });
  await b(`/api/characters/${kai.id}/ties/${mia.id}`, { method: 'PUT', body: { kind: 'friend' } });
  const badge = async () => (await a('/api/home')).data.notificationsUnread;
  const unread = async () => (await a('/api/notifications')).data.notifications.filter((n) => !n.read).map((n) => n.type).sort();
  assert.equal(await badge(), 2);
  await a('/api/notifications/seen', { method: 'POST', body: {} });
  assert.equal(await badge(), 0);
  assert.deepEqual(await unread(), ['comment', 'tie']); // still highlighted in the tab
  await a(`/api/social/${post.id}`); // opening the post answers the comment
  await a(`/api/characters/${mia.id}/ties/${kai.id}`, { method: 'PUT', body: { kind: 'friend' } }); // adding them back answers the tie
  assert.deepEqual(await unread(), []);
});

test('profile headlines rotate through lines with the same energy', async () => {
  const a = await app.signUp('head_a');
  const c = (await a('/api/characters', { method: 'POST', body: { name: 'Aedan Head' } })).data.character;
  let d = (await a(`/api/profiles/${c.id}`)).data.dossier;
  assert.equal(d.headlines[0], "IT'S"); // nothing set yet: plain lines
  await a(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier: { ...d, headline: "ohh shit it's" } } });
  d = (await a(`/api/profiles/${c.id}`)).data.dossier;
  assert.equal(d.headlines[0], "OHH SHIT IT'S");
  assert.ok(d.headlines.includes('AYO IT\'S') && d.headlines.length >= 8); // hyped stays hyped
  await a(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier: { ...d, headline: 'look who it is' } } });
  d = (await a(`/api/profiles/${c.id}`)).data.dossier;
  assert.ok(d.headlines.includes('WELL WELL WELL IT\'S') && !d.headlines.includes('AYO IT\'S')); // smug stays smug
});

test('profile song: share links and embed codes from every service', async () => {
  const a = await app.signUp('song_a');
  const c = (await a('/api/characters', { method: 'POST', body: { name: 'Song Head' } })).data.character;
  const put = async (song) => a(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier: { song } } });
  const got = async () => (await a(`/api/profiles/${c.id}`)).data.dossier.song;
  await put('https://open.spotify.com/track/2Kerz9H9IejzeIpjhDJoYG?si=abc');
  assert.deepEqual([(await got()).service, (await got()).embed], ['spotify', 'https://open.spotify.com/embed/track/2Kerz9H9IejzeIpjhDJoYG']);
  await put('<iframe style="border-radius:12px" src="https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3?utm_source=generator" width="100%" height="352" frameBorder="0"></iframe>');
  assert.equal((await got()).embed, 'https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3');
  await put('<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=x" title="YouTube video player"></iframe>');
  assert.equal((await got()).embed, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  await put('<iframe width="100%" height="166" src="https://w.soundcloud.com/player/?url=https%3A//soundcloud.com/artist/track-name&amp;color=%23ff5500"></iframe>');
  assert.equal((await got()).service, 'soundcloud');
  await put('https://music.apple.com/us/album/bleach/1234567890?i=1234567891');
  assert.equal((await got()).service, 'apple');
  assert.equal((await put('https://example.com/song')).status, 400);
  await put(null);
  assert.equal(await got(), null);
});
