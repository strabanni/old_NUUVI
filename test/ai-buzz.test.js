// Fan comments written by Claude (with a pretend Claude here, so no real API calls are made).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const requests = [];
let failNext = false;
let calls = 0;
const fakeClient = {
  beta: {
    messages: {
      async create(req) {
        requests.push(req);
        if (failNext) {
          failNext = false;
          throw new Error('overloaded');
        }
        const n = Number(req.messages[0].content.at(-1).text.match(/exactly (\d+)/)[1]);
        const batch = ++calls;
        const comments = Array.from({ length: n }, (_, i) => ({
          handle: `fan_${batch}_${i}`,
          text: `that red jacket is everything ${batch}-${i}`,
          mood: 'love',
        }));
        return {
          stop_reason: 'end_turn',
          content: [
            { type: 'text', text: JSON.stringify({ scene: 'A woman in a red jacket on a rooftop at night.', comments }) },
          ],
        };
      },
    },
  },
};

let app;
before(async () => {
  app = await startApp({ ai: { client: fakeClient } });
});
after(() => app.close());

async function settled(c, id) {
  for (let i = 0; i < 100; i++) {
    const { post } = (await c(`/api/social/${id}`)).data;
    if (!post.buzzPending) return post;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('comments never arrived');
}

test('Claude looks at the pictures, and edits replace every old fan comment', async () => {
  const w = await app.signUp('ai_poster');
  const c = (await w('/api/characters', { method: 'POST', body: { name: 'Mina Park', color: '#c97a96' } })).data.character;
  const other = (await w('/api/characters', { method: 'POST', body: { name: 'Cha Yoonoh', color: '#8fa3c9' } })).data.character;
  await w(`/api/characters/${other.id}`, { method: 'PUT', body: { handle: 'chayoonoh' } });
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const pic = (await w('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'image/png' }, raw: png })).data.url;

  const made = await w('/api/social', {
    method: 'POST',
    body: { characterId: c.id, kind: 'photo', media: [pic], body: 'rooftop with @chayoonoh', commentsDisplay: 240 },
  });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.post.id;
  const post = await settled(w, id);

  // The first request carries the picture and says the tagged person isn't in it.
  const first = requests[0];
  assert.equal(first.model, 'claude-opus-5-5');
  assert.equal(first.messages[0].content[0].type, 'image');
  assert.equal(first.messages[0].content[0].source.media_type, 'image/png');
  assert.match(first.messages[0].content[1].text, /NOT in the picture/);
  // A quarter of 240 = 60 comments, in two batches; the second works from the first one's note.
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[0].content[1].text, /red jacket on a rooftop/);
  assert.equal(post.buzz.length, 60);
  assert.ok(post.buzz.every((b) => /red jacket/.test(b.body)));

  // Editing deletes every old comment and writes new ones.
  const before = new Set(post.buzz.map((b) => b.body));
  requests.length = 0;
  const edited = await w(`/api/social/${id}`, {
    method: 'PUT',
    body: { body: 'rooftop with @chayoonoh', taggedIn: true, freshComments: true },
  });
  assert.equal(edited.data.post.buzzPending, true);
  assert.equal(edited.data.post.buzz.length, 0, 'old comments gone straight away');
  const after = await settled(w, id);
  assert.equal(after.buzz.length, 60);
  assert.ok(!after.buzz.some((b) => before.has(b.body)));
  assert.match(requests[0].messages[0].content[1].text, /ARE in the picture/);
});

test("if Claude can't be reached, the built-in writer fills in", async () => {
  const w = await app.signUp('ai_fallback');
  const c = (await w('/api/characters', { method: 'POST', body: { name: 'Jun', color: '#8fa3c9' } })).data.character;
  failNext = true;
  const made = await w('/api/social', {
    method: 'POST',
    body: { characterId: c.id, kind: 'text', body: 'late night ramen', commentsDisplay: 40 },
  });
  const post = await settled(w, made.data.post.id);
  assert.equal(post.buzz.length, 10);
});
