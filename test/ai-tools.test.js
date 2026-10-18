// Writing tools by Claude: check my writing, translations, episode recaps and NPCs writing their own
// lines. A pretend Claude answers here, so no real API calls are made.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const asked = [];
const fakeClient = {
  beta: {
    messages: {
      async create(req) {
        asked.push(req);
        const text = typeof req.messages[0].content === 'string' ? req.messages[0].content : '';
        const answer = /proofreader/.test(req.system)
          ? { text: text.replace('teh', 'the'), changes: ['teh → the'] }
          : /translate/.test(req.system)
            ? { language: 'Korean', text: 'you look amazing' }
            : /Previously on/.test(req.system)
              ? { recap: 'Mina and Yoonoh meet at the gala.\n\nThings get tense.' }
              : { text: 'claude wrote this npc line' };
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
      },
    },
  },
};

let app;
let off;
before(async () => {
  app = await startApp({ ai: { client: fakeClient }, bots: { random: () => 0, delay: (fn) => fn() } });
  off = await startApp();
});
after(() => {
  app.close();
  off.close();
});

const settle = () => new Promise((r) => setTimeout(r, 30));

test('the writing tools are off without a key', async () => {
  const w = await off.signUp('no_ai');
  assert.equal((await w('/api/ai/status')).data.enabled, false);
  assert.equal((await w('/api/ai/check', { method: 'POST', body: { text: 'teh end' } })).status, 503);
});

test('check my writing fixes typos; translations come back in English', async () => {
  const w = await app.signUp('ai_writer');
  assert.equal((await w('/api/ai/status')).data.enabled, true);
  const checked = (await w('/api/ai/check', { method: 'POST', body: { text: 'teh end **bold**' } })).data;
  assert.equal(checked.text, 'the end **bold**');
  assert.equal(checked.changed, true);
  assert.deepEqual(checked.changes, ['teh → the']);
  const tr = (await w('/api/ai/translate', { method: 'POST', body: { text: '너무 멋있어' } })).data;
  assert.equal(tr.text, 'you look amazing');
  assert.equal(tr.language, 'Korean');
  assert.equal((await app.client()('/api/ai/check', { method: 'POST', body: { text: 'x' } })).status, 401);
});

test('episode recaps: only for people who can read it, and kept until someone posts again', async () => {
  const w = await app.signUp('recap_writer');
  const ch = (await w('/api/characters', { method: 'POST', body: { name: 'Mina Park' } })).data.character;
  const story = (await w('/api/stories', { method: 'POST', body: { title: 'Gala', visibility: 'private' } })).data;
  const channel = story.channels[0];
  const say = (body) => w(`/api/channels/${channel.id}/posts`, { method: 'POST', body: { body, characterId: ch.id } });
  await say('she walks in');
  assert.equal((await w(`/api/channels/${channel.id}/recap`, { method: 'POST', body: {} })).status, 400, 'too short');
  for (let i = 0; i < 8; i++) await say(`<b>line ${i}</b> of the gala`);
  asked.length = 0;
  const first = await w(`/api/channels/${channel.id}/recap`, { method: 'POST', body: {} });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.match(first.data.recap, /gala/);
  assert.equal(asked.length, 1);
  assert.match(asked[0].messages[0].content, /Mina Park: line 7 of the gala/, 'plain text, with who wrote it');
  // Reading it again is free; a new post makes a fresh one.
  await w(`/api/channels/${channel.id}/recap`, { method: 'POST', body: {} });
  assert.equal(asked.length, 1);
  await say('one more');
  await w(`/api/channels/${channel.id}/recap`, { method: 'POST', body: {} });
  assert.equal(asked.length, 2);
  // Someone outside the private story can't get it.
  const stranger = await app.signUp('recap_stranger');
  assert.notEqual((await stranger(`/api/channels/${channel.id}/recap`, { method: 'POST', body: {} })).status, 200);
});

test("NPCs write their own lines with Claude, in their writer's voice", async () => {
  const writer = await app.signUp('npc_ai_writer');
  const fan = (
    await writer('/api/characters', {
      method: 'POST',
      body: {
        name: 'Barista Kim',
        npc: true,
        bot: 'bot',
        botLines: { comments: ['{name} ate this'], posts: ['latte art day ☕'] },
      },
    })
  ).data.character;
  const star = (await writer('/api/characters', { method: 'POST', body: { name: 'Cha Yoonoh' } })).data.character;
  asked.length = 0;
  const p = (await writer('/api/social', { method: 'POST', body: { characterId: star.id, body: 'board meeting again' } })).data
    .post;
  await settle();
  const full = (await writer(`/api/social/${p.id}`)).data.post;
  const npcComment = full.comments.find((c) => c.character.id === fan.id);
  assert.equal(npcComment.body, 'claude wrote this npc line');
  const npcAsk = asked.find((r) => /NPC/.test(r.system));
  assert.match(npcAsk.messages[0].content, /Cha Yoonoh ate this|\{name\} ate this/);
  assert.match(npcAsk.messages[0].content, /board meeting again/);
});
