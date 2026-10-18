import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const makeStory = async (c, title) =>
  (await c('/api/stories', { method: 'POST', body: { title, visibility: 'public' } })).data.story;

test('NPCs: badges, automatic comments and posts, and the anonymous gossip account', async () => {
  // Bots act immediately and always (random() = 0) so the test is deterministic.
  const app = await startApp({ bots: { random: () => 0, delay: (fn) => fn() } });
  try {
    const admin = await app.signUp('npc_admin');
    const writer = await app.signUp('npc_writer');
    const reader = await app.signUp('npc_reader');

    // Only NPCs can be automatic; only admins run the gossip account.
    assert.equal((await writer('/api/characters', { method: 'POST', body: { name: 'Not NPC', bot: 'bot' } })).status, 400);
    assert.equal(
      (await writer('/api/characters', { method: 'POST', body: { name: 'Sneaky', npc: true, bot: 'gossip' } })).status,
      403,
    );
    const fan = (
      await writer('/api/characters', {
        method: 'POST',
        body: {
          name: 'Barista Kim',
          npc: true,
          bot: 'bot',
          botLines: { comments: ['{name} ate this', 'okay {handle}!!'], posts: ['latte art day ☕ ft. {someone}'] },
        },
      })
    ).data.character;
    assert.equal(fan.npc, true);
    assert.equal(fan.bot, 'bot');
    const gossip = (
      await admin('/api/characters', {
        method: 'POST',
        body: {
          name: 'Whisper',
          npc: true,
          bot: 'gossip',
          botLines: {
            tips: ['👀 spotted: {a} and {b} at {thread}'],
            finished: ['so THAT is how {thread} ended'],
            posts: ['I see everything.'],
          },
        },
      })
    ).data.character;

    // A post gets an automatic NPC comment (and its writer a notification).
    const star = (await reader('/api/characters', { method: 'POST', body: { name: 'Cha Yoonoh' } })).data.character;
    const p = (await reader('/api/social', { method: 'POST', body: { characterId: star.id, body: 'board meeting again' } })).data
      .post;
    const full = (await reader(`/api/social/${p.id}`)).data.post;
    assert.equal(full.comments.length, 1);
    assert.equal(full.comments[0].character.name, 'Barista Kim');
    assert.equal(full.comments[0].body, 'Cha Yoonoh ate this');
    assert.ok((await reader('/api/notifications')).data.notifications.some((n) => n.type === 'comment'));

    // A public thread with characters: the gossip account posts a tip; private threads are left alone.
    const story = await makeStory(reader, 'Trinity');
    const other = (await reader('/api/characters', { method: 'POST', body: { name: 'Bang Daehyun' } })).data.character;
    await reader(`/api/stories/${story.id}/channels`, {
      method: 'POST',
      body: { name: 'secret meeting', kind: 'thread', status: 'closed', characterId: star.id, tagged: [other.id] },
    });
    const open = (
      await reader(`/api/stories/${story.id}/channels`, {
        method: 'POST',
        body: { name: 'the gala', kind: 'thread', characterId: star.id, tagged: [other.id] },
      })
    ).data.channel;
    let gossipPosts = (await reader(`/api/social?character=${gossip.id}`)).data.posts;
    assert.equal(gossipPosts.length, 1);
    assert.match(gossipPosts[0].body, /^👀 spotted: (Cha Yoonoh|Bang Daehyun) and (Cha Yoonoh|Bang Daehyun) at the gala$/);
    await reader(`/api/channels/${open.id}`, { method: 'PUT', body: { status: 'complete' } });
    gossipPosts = (await reader(`/api/social?character=${gossip.id}`)).data.posts;
    assert.equal(gossipPosts[0].body, 'so THAT is how the gala ended');

    // The gossip account is anonymous to everyone but whoever runs it.
    assert.equal((await reader(`/api/characters/${gossip.id}`)).data.character.owner, null);
    assert.equal((await admin(`/api/characters/${gossip.id}`)).data.character.owner.username, 'npc_admin');
    const dir = (await reader('/api/directory')).data;
    assert.ok(!dir.writers.find((w) => w.username === 'npc_admin').characters.some((c) => c.id === gossip.id));
    assert.deepEqual(
      dir.anonymous.map((c) => c.name),
      ['Whisper'],
    );

    // Settings and "post now".
    assert.equal((await writer('/api/admin/bots')).status, 403);
    const listed = (await admin('/api/admin/bots')).data;
    assert.deepEqual(listed.characters.map((c) => c.name).sort(), ['Barista Kim', 'Whisper']);
    assert.equal(
      (await admin('/api/admin/bots/run', { method: 'POST', body: { characterId: fan.id, what: 'post' } })).status,
      200,
    );
    assert.match((await reader(`/api/social?character=${fan.id}`)).data.posts[0].body, /^latte art day ☕ ft\. /);
    await admin('/api/admin/bots', { method: 'PUT', body: { enabled: false } });
    const p2 = (await reader('/api/social', { method: 'POST', body: { characterId: star.id, body: 'quiet day' } })).data.post;
    assert.equal((await reader(`/api/social/${p2.id}`)).data.post.comments.length, 0);
  } finally {
    app.close();
  }
});
