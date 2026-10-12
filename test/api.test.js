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
  return { story: r.data.story, main: r.data.channels[0], ooc: r.data.channels[1] };
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
  // The feed shows open threads, self paras, events and social posts — not comms or complete threads.
  const para = (await a(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'alone at last', kind: 'para', characterId: yoonoh.id } })).data.channel;
  const feed = (await b('/api/feed')).data.items;
  assert.ok(feed.some((i) => i.type === 'thread' && i.id === para.id));
  assert.ok(!feed.some((i) => i.type === 'thread' && i.id === comms.id));
  assert.ok(!feed.some((i) => i.type === 'thread' && i.id === thread.id)); // complete
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

  const liked = await b(`/api/social/${p1.data.post.id}/like`, { method: 'POST', body: { asCharacterId: fan.id } });
  assert.equal(liked.data.post.likes, 1);
  assert.deepEqual(liked.data.post.likedBy, [fan.id]);
  const commented = await b(`/api/social/${p1.data.post.id}/comments`, { method: 'POST', body: { characterId: fan.id, body: 'omg!!' } });
  assert.equal(commented.data.post.comments[0].body, 'omg!!');
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
  assert.ok((await b('/api/notifications')).data.notifications.some((n) => n.type === 'dm' && n.url === `#/phone/${daehyun.id}`));

  await a(`/api/phone/threads/${thread.id}/read`, { method: 'POST', body: { as: yoonoh.id, lastId: pic.data.message.id } });
  assert.equal((await a(`/api/phone/${yoonoh.id}`)).data.threads[0].unread, 0);

  // Blocking ends it.
  await b('/api/blocks', { method: 'POST', body: { userId: (await a('/api/me')).data.user.id } });
  assert.equal((await a(`/api/phone/threads/${thread.id}/messages`, { method: 'POST', body: { as: yoonoh.id, body: 'hello?' } })).status, 403);
  assert.equal((await a(`/api/phone/${yoonoh.id}`)).data.threads.length, 0);
});
