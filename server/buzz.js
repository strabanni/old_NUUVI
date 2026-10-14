// "Buzz": comments from the crowd on a character's social post (made-up accounts, not characters).
// They're written to sound like real people in a comment section: they react to what the post
// actually says (its words, its place, its song, the kind of post), they use the poster's pronouns,
// and not everyone is a fan: there are jokes, questions, side-eye and the odd hater.
// Counts that grow with fame (likes on posts and comments) are worked out here too.

// A repeatable 0–1 number from a seed, so a post's numbers don't jump around between page loads.
export function seeded(seed) {
  let x = (Number(seed) * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822507) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489909) >>> 0; x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Likes a post would get from a following this size: roughly 4–16% of followers.
export const autoLikes = (followers, seed) => (followers > 0 ? Math.round(followers * (0.04 + seeded(seed) * 0.12)) : 0);
// Likes a comment would get from its writer's following: far fewer.
export const autoCommentLikes = (followers, seed) => (followers > 0 ? Math.round(followers * (0.0005 + seeded(seed) * 0.006)) : Math.floor(seeded(seed) * 4));

// ---------- Who posted: pronouns ----------
// he/him, she/her, they/them (anything else, or nothing set, reads as they/them).
export function pronounSet(pronouns = '') {
  const p = String(pronouns).toLowerCase();
  if (/\bshe\b|\bher\b/.test(p) && !/\bhe\b|\bhim\b|\bthey\b/.test(p)) {
    return { sub: 'she', obj: 'her', pos: 'her', is: "she's", title: 'queen', kid: 'girl', pal: 'sis', mom: 'mother' };
  }
  if (/\bhe\b|\bhim\b/.test(p) && !/\bshe\b|\bher\b|\bthey\b/.test(p)) {
    return { sub: 'he', obj: 'him', pos: 'his', is: "he's", title: 'king', kid: 'boy', pal: 'bro', mom: 'father' };
  }
  return { sub: 'they', obj: 'them', pos: 'their', is: "they're", title: 'icon', kid: 'bestie', pal: 'bestie', mom: 'parent' };
}

// ---------- What the post is about ----------
const TOPICS = [
  ['food', /\b(food|eat|ate|eating|dinner|lunch|brunch|breakfast|coffee|latte|matcha|cake|ramen|sushi|pasta|cook|cooking|chef|restaurant|snack|dessert|pizza|tteokbokki|boba)\b/i],
  ['fit', /\b(fit|outfit|ootd|dress|wearing|wore|style|fashion|shoes|heels|jacket|catchye|runway|vogue|lewk|drip)\b/i],
  ['music', /\b(song|music|album|single|track|studio|record|recording|stage|concert|tour|perform|mv|demo|lyrics|comeback|setlist|rehearsal)\b/i],
  ['night', /\b(party|club|night|drinks|shots|afters|after-party|dance|dj|rave|bar|wasted|3am|2am|4am)\b/i],
  ['travel', /\b(travel|trip|flight|airport|beach|vacation|holiday|paris|tokyo|seoul|london|nyc|hotel|abroad|passport)\b/i],
  ['love', /\b(love|bf|gf|boyfriend|girlfriend|date|dating|kiss|crush|babe|anniversary|my person)\b|❤|🩷|💕|💗/i],
  ['sad', /\b(sad|cry|crying|tired|exhausted|over it|miss|lonely|hurt|alone|rough day|bad day)\b|😭|💔|🥲/i],
  ['gym', /\b(gym|workout|run|running|pilates|yoga|lift|lifting|training|sweat|pr)\b/i],
  ['work', /\b(work|office|meeting|deadline|shift|boss|ceo|job|interview|launch|deal|contract|business|grind)\b/i],
  ['book', /\b(book|read|reading|writing|novel|chapter|author|publish|manuscript)\b/i],
  ['selfie', /\b(selfie|me|mirror|face|hair|makeup|new hair|haircut|nails)\b/i],
  ['pet', /\b(dog|puppy|cat|kitten|pet)\b|🐶|🐱/i],
  ['shade', /\b(fake|snake|liars?|haters?|talk(ing)? about me|receipts|drama|beef|petty|blocked)\b/i],
];

// A word from the caption that a person might pick up on (a hashtag, or the longest real word).
const STOP = new Set('about after again could their there these those which while would should really thing things just with this that from have been were what when where your youre into over only some than then them they very much also even still like love know make made dont cant wont its'.split(' '));
function keyword(text) {
  const tag = text.match(/#([\p{L}\p{N}_]{3,24})/u);
  if (tag) return `#${tag[1]}`;
  const words = (text.toLowerCase().match(/[\p{L}']{5,16}/gu) || []).filter((w) => !STOP.has(w.replace(/'/g, '')));
  return words.sort((a, b) => b.length - a.length)[0] || '';
}

// ---------- The lines ----------
// Each line is a function of the post's details, so it can use the poster's name, pronouns, the
// place, the song, or a word from the caption. Moods: love (fans), fun (jokes / chaotic), ask
// (questions), meh (neutral / lukewarm), shade (critics and the odd hater).
const L = {
  love: {
    any: [
      (x) => `ok ${x.first} you can stop posting now we get it`,
      (x) => `${x.is} so fine it's actually unfair`,
      () => 'this made my whole day idk why',
      (x) => `not me saving this the second ${x.sub} posted it`,
      (x) => `${x.first} never misses. ever.`,
      () => 'the way i screamed when this popped up',
      (x) => `protect ${x.obj} at all costs`,
      () => 'genuinely obsessed with everything about this',
      (x) => `${x.title} behavior honestly`,
      () => 'okay this is my favorite post of yours',
    ],
    photo: [() => 'the lighting in the second one??', (x) => `who's taking ${x.pos} pictures i need their number`, () => 'swipe 3 is my lockscreen now sorry', () => 'every single photo ate'],
    video: [() => 'watched this like 9 times already', () => "i can't stop replaying this", (x) => `${x.pos} energy in this video >>>`],
    voice: [(x) => `${x.pos} voice is so calming wtf`, () => 'needed to hear this today honestly'],
    stream: [() => 'omw!!', () => 'hii from the uk 🇬🇧', () => "first time catching one live, i'm shaking"],
    text: [() => 'say it louder for the people in the back', () => 'this is so real', (x) => `${x.first} said what needed to be said`],
    food: [() => 'that looks so good i could cry', () => 'drop the place pls', () => 'ok now i\'m starving thanks'],
    fit: [() => 'the fit is SO good', () => 'need the jacket immediately', (x) => `${x.sub} really just woke up and chose fashion`],
    music: [() => 'the vocals on this?? come on', () => 'been on repeat all day', () => 'tour dates when 😭'],
    night: [() => 'why wasn\'t i invited', () => 'looks like the best night ever', () => 'the vibes look insane'],
    travel: [() => 'take me with you next time', () => 'the view is unreal', () => 'okay where is this exactly'],
    love: [() => 'i KNEW it', () => 'soft launch??', () => 'the way they look at each other 🥹', () => 'hard launch when'],
    sad: [() => 'sending you the biggest hug', (x) => `hope ${x.is} okay fr`, () => 'take care of yourself ok 🤍'],
    gym: [() => 'the discipline is scary', () => 'gym arc going crazy'],
    work: [() => 'boss moves only', () => 'proud of you fr', () => 'big things coming i can feel it'],
    book: [() => 'adding this to my list rn', () => 'need a signed copy'],
    selfie: [(x) => `${x.first} woke up like this?? be serious`, () => 'the hair!!!'],
    pet: [() => 'the baby!!!', () => 'i would die for this baby honestly'],
    place: [(x) => `${x.loc} looks so good on you`, (x) => `wait i'm literally near ${x.loc} rn`],
    song: [(x) => `putting "${x.song}" on this post is a choice and i respect it`, (x) => `"${x.song}"?? you have taste`],
    kw: [(x) => `the ${x.kw} part got me`, (x) => `"${x.kw}" is so real`],
  },
  fun: {
    any: [
      () => 'not me seeing this at 3am',
      (x) => `${x.first} posts once in a blue moon and it's this`,
      () => 'the caption is doing a LOT of heavy lifting lol',
      (x) => `someone check on ${x.obj}`,
      () => 'i\'m screenshotting this for evidence',
      () => 'commenting so the algorithm knows i was here',
      (x) => `me pretending i'm not refreshing ${x.pos} page every hour`,
      () => 'lmaooo why is this so funny to me',
    ],
    shade: [() => 'oh this is about someone specific', () => 'who hurt you 😭', () => 'the subtweet energy is immaculate', () => 'names. we want names.'],
    night: [() => 'the afters must have been chaos', () => 'tell me everything tomorrow'],
    love: [() => 'the single people in the comments rn:', () => 'ugh go away (i\'m happy for you)'],
    kw: [(x) => `the way you said ${x.kw} 😭`],
  },
  ask: {
    any: [
      () => 'wait what happened??',
      (x) => `is ${x.sub} okay`,
      () => 'context please i\'m begging',
      () => 'when was this??',
      (x) => `${x.first} who took this`,
    ],
    fit: [() => 'where is the jacket from??', () => 'link the shoes pls'],
    food: [() => 'where is this??', () => 'is it actually good or just pretty'],
    travel: [() => 'how long are you there for?', () => 'what hotel is this'],
    music: [() => 'is this on spotify yet?', () => 'when does it come out'],
    place: [(x) => `is ${x.loc} worth going to?`, (x) => `wait you're in ${x.loc}??`],
    song: [(x) => `is this the "${x.song}" remix or the original`],
  },
  meh: {
    any: [
      () => 'ok', () => 'hm', () => 'interesting choice', () => 'this is fine i guess',
      () => 'not your best but still cute', () => 'i liked the last one more ngl',
      (x) => `${x.is} been posting a lot lately huh`,
    ],
    photo: [() => 'the first pic is giving, the rest not so much', () => 'filter is a bit much'],
    fit: [() => 'the shoes don\'t go but ok', () => 'it\'s giving… something'],
    music: [() => 'the old stuff was better', () => 'it\'s growing on me slowly'],
    food: [() => 'that\'s a lot of money for that portion'],
  },
  shade: {
    any: [
      () => 'the desperation for attention is crazy',
      (x) => `${x.first} posts like nobody remembers last week`,
      () => 'unfollowing in 3, 2…',
      () => 'overrated tbh',
      (x) => `${x.is} trying way too hard`,
      () => 'we\'re just not gonna talk about what happened? ok',
      (x) => `funny how ${x.sub} only posts when there's drama`,
      () => 'this didn\'t need to be posted',
      () => 'pr team working overtime i see',
    ],
    fit: [() => 'stylist should be fired', () => 'the fit is a crime'],
    music: [() => 'autotune doing all the work', () => 'mid. sorry.'],
    love: [() => 'give it three months', () => 'this won\'t last'],
    selfie: [() => 'facetune is crazy on this one', () => 'the filter can\'t hide everything'],
    sad: [() => 'the pity party again lol'],
    work: [() => 'nepo energy honestly'],
  },
};

// How often each mood comes up: mostly fans, then jokes and questions, then lukewarm and critics.
const MOODS = [['love', 0.5], ['fun', 0.16], ['ask', 0.13], ['meh', 0.1], ['shade', 0.11]];

// The things a comment can react to, for this post.
function postContext(post, character) {
  const text = `${post.body || ''} ${post.title || ''}`;
  const p = pronounSet(character?.pronouns);
  let meta = {};
  try { meta = JSON.parse(post.meta || '{}'); } catch { /* none */ }
  const topics = TOPICS.filter(([, re]) => re.test(text)).map(([t]) => t);
  const name = String(character?.name || '').trim();
  return {
    ...p,
    first: (name.split(/\s+/)[0] || 'you').toLowerCase(),
    handle: character?.handle || '',
    loc: post.location || '',
    song: meta.music?.title || '',
    kw: keyword(text),
    topics,
    kind: post.kind,
  };
}

// Picks a mood (mostly fans, then jokes and questions, then lukewarm and critics).
function pickMood(rand) {
  let r = rand();
  for (const [m, w] of MOODS) { if (r < w) return m; r -= w; }
  return 'love';
}

// Real people don't all type the same: some shout, some trail off, a few add an emoji or tag the poster.
const EMOJI = ['😭', '🥹', '💀', '🔥', '✨', '🙏', '👀', '😩', '🫶', '😮‍💨'];
function humanize(line, x, rand, mood) {
  let s = line;
  const r = rand();
  if (mood === 'love' && r < 0.12) s = s.toUpperCase();
  else if (r < 0.2) s = s.charAt(0).toUpperCase() + s.slice(1);
  const hasEmoji = /\p{Extended_Pictographic}/u.test(s);
  if (mood !== 'shade' && mood !== 'meh' && !hasEmoji && rand() < 0.3) s += ` ${EMOJI[Math.floor(rand() * EMOJI.length)]}`;
  if (rand() < 0.12 && x.handle) s = `@${x.handle} ${s}`;
  if (rand() < 0.1) s = s.replace(/\byou\b/, 'u').replace(/\bare\b/, 'r');
  if (rand() < 0.08 && /[\p{L}]$/u.test(s)) s += '!!';
  return s;
}

const NAME_A = ['luv', 'soft', 'mini', 'yuna', 'jae', 'lily', 'cherry', 'moon', 'dae', 'hyun', 'mina', 'koko', 'yuri', 'roro', 'jiwoo', 'cassie', 'nana', 'ari', 'evie', 'lulu', 'seo', 'minji', 'haru', 'kai', 'ziggy', 'pixie', 'rue', 'jules', 'nova', 'maddy',
  'marcus', 'devon', 'tasha', 'kenji', 'leila', 'omar', 'priya', 'sofia', 'dani', 'theo', 'brianna', 'isaac', 'zara', 'mateo', 'chloe', 'yusuf'];
const NAME_B = ['archive', 'xo', 'files', 'stan', 'lover', 'diaries', 'core', 'world', 'era', 'club', 'mood', 'daily', 'vault', 'tv', 'pics', 'notes', 'sz', '', '', '', 'official', 'irl', 'og'];

function fanHandle(rand) {
  const a = NAME_A[Math.floor(rand() * NAME_A.length)];
  const b = NAME_B[Math.floor(rand() * NAME_B.length)];
  const joiner = b ? ['', '.', '_', 'x'][Math.floor(rand() * 4)] : '';
  const n = rand() < 0.45 ? String(Math.floor(rand() * 99) + 1) : rand() < 0.2 ? String(1990 + Math.floor(rand() * 16)) : '';
  return `${a}${joiner}${b}${n}`;
}

// Adds `count` crowd comments to a post, a little after it went up.
export function addBuzz(db, post, count, { random = Math.random, followers = 0 } = {}) {
  if (count <= 0) return;
  const character = db.prepare('SELECT name, handle, pronouns FROM characters WHERE id = ?').get(post.character_id);
  const x = postContext(post, character);
  const used = new Set(db.prepare('SELECT body FROM social_buzz WHERE post_id = ?').all(post.id).map((r) => r.body.toLowerCase()));
  const ins = db.prepare(`INSERT INTO social_buzz (post_id, handle, body, likes, created_at)
    VALUES (?, ?, ?, ?, datetime(?, '+' || ? || ' seconds'))`);
  for (let i = 0; i < count; i++) {
    let body = '';
    let mood = 'love';
    for (let tries = 0; tries < 10 && (!body || used.has(body.toLowerCase())); tries++) {
      mood = pickMood(random);
      body = humanize(pickLineFor(mood, x, random), x, random, mood);
    }
    used.add(body.toLowerCase());
    // Critics get fewer likes than fans (usually).
    const base = followers > 0 ? followers * 0.0008 : 3;
    const likes = Math.round(base * random() * (mood === 'shade' ? 1.2 : mood === 'love' ? 3 : 1.6));
    ins.run(post.id, fanHandle(random), body, likes, post.created_at, String(30 + Math.floor(random() * 3600 * (i + 1))));
  }
}
// One line in a given mood that fits the post: its topics, place, song, a caption word or its kind.
function pickLineFor(mood, x, rand) {
  const bank = L[mood];
  const pools = [];
  for (const t of x.topics) if (bank[t]) pools.push(bank[t], bank[t]);
  if (x.loc && bank.place) pools.push(bank.place);
  if (x.song && bank.song) pools.push(bank.song);
  if (x.kw && bank.kw && rand() < 0.5) pools.push(bank.kw);
  if (bank[x.kind]) pools.push(bank[x.kind]);
  pools.push(bank.any, bank.any);
  const pool = pools[Math.floor(rand() * pools.length)];
  return pool[Math.floor(rand() * pool.length)](x);
}

// A sample of comments for a post (for tests and previews).
export function sampleBuzz(post, character, n = 10, rand = Math.random) {
  const x = postContext(post, character);
  return Array.from({ length: n }, () => { const m = pickMood(rand); return humanize(pickLineFor(m, x, rand), x, rand, m); });
}

// How many crowd comments a new post gets: more for more famous characters (0–8).
export const buzzForFollowers = (followers, random = Math.random) => Math.min(8, Math.round(Math.log10(followers + 1) * 1.6 + random() * 2));
