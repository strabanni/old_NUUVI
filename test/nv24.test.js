// NV-24: thread pictures, tag and comment notifications, dated comments, pinned posts, profile order,
// the full "liked by" list, your own characters following each other, and the Locations directory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const mk = async (who, name, extra = {}) => (await who('/api/characters', { method: 'POST', body: { name, color: '#8fa3c9', ...extra } })).data.character;

test('a character can have a separate picture for thread posts', async () => {
  const w = await app.signUp('thread_pic');
  const pic = (await w('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, raw: png })).data.url;
  const c = await mk(w, 'Mina');
  const saved = (await w(`/api/characters/${c.id}`, { method: 'PUT', body: { threadAvatar: pic } })).data.character;
  assert.equal(saved.threadAvatar, pic);
  const story = (await w('/api/stories', { method: 'POST', body: { title: 'S', visibility: 'public' } })).data;
  const post = (await w(`/api/channels/${story.channels[0].id}/posts`, { method: 'POST', body: { body: 'hi', characterId: c.id } })).data.post;
  assert.equal(post.character.threadAvatar, pic);
  // Clearing it goes back to the avatar.
  assert.equal((await w(`/api/characters/${c.id}`, { method: 'PUT', body: { threadAvatar: '' } })).data.character.threadAvatar, null);
});

test('tags and comments notify the writer with who did what', async () => {
  const a = await app.signUp('tagger');
  const b = await app.signUp('tagged');
  const ca = await mk(a, 'Mina Park');
  const cb = await mk(b, 'Cha Yoonoh');
  await b(`/api/characters/${cb.id}`, { method: 'PUT', body: { handle: 'chayoonoh' } });
  const p = (await a('/api/social', { method: 'POST', body: { characterId: ca.id, body: 'dinner with @chayoonoh' } })).data.post;
  let notes = (await b('/api/notifications')).data.notifications;
  assert.ok(notes.some((n) => n.type === 'socialtag' && n.text.startsWith('Mina Park tagged Cha Yoonoh in a post')), JSON.stringify(notes));
  // Editing without a new tag doesn't notify again.
  await a(`/api/social/${p.id}`, { method: 'PUT', body: { body: 'dinner with @chayoonoh!!' } });
  notes = (await b('/api/notifications')).data.notifications;
  assert.equal(notes.filter((n) => n.type === 'socialtag').length, 1);
  // A comment: "{a} commented on {b}'s post: …"
  const theirs = (await b('/api/social', { method: 'POST', body: { characterId: cb.id, body: 'gym' } })).data.post;
  await a(`/api/social/${theirs.id}/comments`, { method: 'POST', body: { characterId: ca.id, body: 'looking strong' } });
  notes = (await b('/api/notifications')).data.notifications;
  assert.ok(notes.some((n) => n.type === 'comment' && n.text === "Mina Park commented on Cha Yoonoh's post: looking strong"));
});

test('comments can be dated; posts can be pinned; profiles go by date; everyone who liked is listed', async () => {
  const w = await app.signUp('profile_order');
  const c = await mk(w, 'Jun');
  const other = await mk(w, 'Hana');
  const old = (await w('/api/social', { method: 'POST', body: { characterId: c.id, body: 'from 2024', postedAt: '2024-05-01T12:00:00.000Z' } })).data.post;
  const recent = (await w('/api/social', { method: 'POST', body: { characterId: c.id, body: 'today' } })).data.post;
  const older = (await w('/api/social', { method: 'POST', body: { characterId: c.id, body: 'from 2025', postedAt: '2025-01-01T12:00:00.000Z' } })).data.post;
  let list = (await w(`/api/social?character=${c.id}`)).data.posts.map((p) => p.id);
  assert.deepEqual(list, [recent.id, older.id, old.id], 'newest date first, not newest made');
  // Pin the oldest: it goes first on the profile.
  const pinned = await w(`/api/social/${old.id}/pin`, { method: 'POST', body: { pinned: true } });
  assert.equal(pinned.data.post.pinned, true);
  list = (await w(`/api/social?character=${c.id}`)).data.posts.map((p) => p.id);
  assert.deepEqual(list, [old.id, recent.id, older.id]);
  await w(`/api/social/${recent.id}/pin`, { method: 'POST', body: {} });
  await w(`/api/social/${older.id}/pin`, { method: 'POST', body: {} });
  const fourth = (await w('/api/social', { method: 'POST', body: { characterId: c.id, body: 'four' } })).data.post;
  assert.equal((await w(`/api/social/${fourth.id}/pin`, { method: 'POST', body: {} })).status, 400, 'up to 3 pinned');
  await w(`/api/social/${old.id}/pin`, { method: 'POST', body: { pinned: false } });
  // A comment dated to match an old post.
  const cm = await w(`/api/social/${old.id}/comments`, { method: 'POST', body: { characterId: other.id, body: 'throwback', postedAt: '2024-05-01T13:00:00.000Z' } });
  assert.equal(cm.data.post.comments.find((x) => x.body === 'throwback').createdAt, '2024-05-01 13:00:00');
  // Your own characters can like and follow each other; the likers list has everyone.
  await w(`/api/social/${recent.id}/like`, { method: 'POST', body: { asCharacterId: other.id } });
  await w(`/api/social/${recent.id}/like`, { method: 'POST', body: { asCharacterId: c.id } });
  const likers = (await w(`/api/social/${recent.id}/likers`)).data.characters.map((x) => x.name).sort();
  assert.deepEqual(likers, ['Hana', 'Jun']);
  assert.equal((await w(`/api/characters/${c.id}/follow`, { method: 'POST', body: { asCharacterId: other.id } })).status, 200);
});

test('Locations: anyone adds places; only whoever added one (or an admin) changes it', async () => {
  const a = await app.signUp('place_maker');
  const b = await app.signUp('place_visitor');
  const made = await a('/api/places', { method: 'POST', body: { name: 'The Velvet Room', borough: 'Midtown', venue: 'Bar', description: 'Low lights.' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const place = made.data.place;
  assert.equal((await b('/api/places', { method: 'POST', body: { name: 'the velvet room' } })).status, 409);
  await b('/api/places', { method: 'POST', body: { name: 'Harbor Café', borough: 'Eastside', venue: 'Café' } });
  const all = (await b('/api/places')).data;
  assert.deepEqual(all.boroughs, ['Eastside', 'Midtown']);
  assert.deepEqual(all.venues, ['Bar', 'Café']);
  assert.equal((await b(`/api/places/${place.id}`, { method: 'PUT', body: { name: 'Mine now' } })).status, 403);
  assert.equal((await a(`/api/places/${place.id}`, { method: 'PUT', body: { venue: 'Club' } })).data.place.venue, 'Club');
  // Listed places come first in the location suggestions.
  assert.equal((await b('/api/locations')).data.locations[0], 'Harbor Café');
  assert.equal((await b(`/api/places/${place.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await app.admin(`/api/places/${place.id}`, { method: 'DELETE' })).status, 200);
});

test('the city map: pins, and characters show where their open episode is set', async () => {
  const w = await app.signUp('map_writer');
  const c = await mk(w, 'Mina Park');
  const place = (await w('/api/places', { method: 'POST', body: { name: 'Lumen Rooftop', borough: 'Midtown', venue: 'Bar', lat: 40.7549, lng: -73.9840 } })).data.place;
  assert.deepEqual([place.lat, place.lng], [40.7549, -73.984]);
  // Pins stay in the city.
  assert.equal((await w('/api/places', { method: 'POST', body: { name: 'Paris', lat: 48.85, lng: 2.35 } })).status, 400);
  const story = (await w('/api/stories', { method: 'POST', body: { title: 'Map story', visibility: 'public' } })).data.story;
  const ep = (await w(`/api/stories/${story.id}/channels`, { method: 'POST', body: { name: 'drinks', kind: 'thread', characterId: c.id, location: 'lumen rooftop' } })).data.channel;
  let p = (await w('/api/places')).data.places.find((x) => x.id === place.id);
  assert.deepEqual(p.here.map((x) => [x.name, x.episode.id]), [['Mina Park', ep.id]]);
  // Moving the scene somewhere else moves her; ending the episode takes her off the map.
  await w(`/api/channels/${ep.id}/posts`, { method: 'POST', body: { body: 'leaving', characterId: c.id, location: 'Somewhere else' } });
  assert.equal((await w('/api/places')).data.places.find((x) => x.id === place.id).here.length, 0);
  await w(`/api/channels/${ep.id}/posts`, { method: 'POST', body: { body: 'back', characterId: c.id, location: 'Lumen Rooftop' } });
  assert.equal((await w('/api/places')).data.places.find((x) => x.id === place.id).here.length, 1);
  await w(`/api/channels/${ep.id}`, { method: 'PUT', body: { status: 'complete' } });
  p = (await w('/api/places')).data.places.find((x) => x.id === place.id);
  assert.equal(p.here.length, 0);
  // Moving the pin; taking it off the map.
  assert.equal((await w(`/api/places/${place.id}`, { method: 'PUT', body: { lat: 40.76, lng: -73.98 } })).data.place.lat, 40.76);
  assert.equal((await w(`/api/places/${place.id}`, { method: 'PUT', body: { lat: null, lng: null } })).data.place.lat, null);
});

test('editing a post can change its type', async () => {
  const w = await app.signUp('kind_changer');
  const c = await mk(w, 'Mina');
  const pic = (await w('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, raw: png })).data.url;
  const p = (await w('/api/social', { method: 'POST', body: { characterId: c.id, kind: 'text', body: 'thinking about it', music: { title: 'Ditto', artist: 'NewJeans' } } })).data.post;
  // Text → photo (needs a photo), keeping the song.
  assert.equal((await w(`/api/social/${p.id}`, { method: 'PUT', body: { kind: 'photo', media: [] } })).status, 400);
  const photo = (await w(`/api/social/${p.id}`, { method: 'PUT', body: { kind: 'photo', media: [pic], body: 'here it is' } })).data.post;
  assert.equal(photo.kind, 'photo');
  assert.deepEqual(photo.media, [pic]);
  assert.equal(photo.meta.music.title, 'Ditto');
  // Photo → stream (needs a title); → back to text drops the media.
  assert.equal((await w(`/api/social/${p.id}`, { method: 'PUT', body: { kind: 'stream', media: [] } })).status, 400);
  const stream = (await w(`/api/social/${p.id}`, { method: 'PUT', body: { kind: 'stream', title: 'late night q&a', media: [], meta: { viewers: 1200, live: true } } })).data.post;
  assert.equal(stream.kind, 'stream');
  assert.equal(stream.meta.viewers, 1200);
  const text = (await w(`/api/social/${p.id}`, { method: 'PUT', body: { kind: 'text', media: [], body: 'never mind' } })).data.post;
  assert.equal(text.kind, 'text');
  assert.deepEqual(text.media, []);
});
