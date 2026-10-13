// "Buzz": comments from the crowd on a character's social post (made-up fan accounts, not
// characters). They read the caption and the kind of post, so they mostly fit what was posted.
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

const TOPICS = [
  ['food', /\b(food|eat|ate|dinner|lunch|brunch|breakfast|coffee|latte|matcha|cake|ramen|sushi|pasta|cook|chef|restaurant|snack|dessert)\b/i],
  ['fit', /\b(fit|outfit|ootd|dress|wearing|wore|style|look|fashion|shoes|heels|jacket|catchye|runway|vogue)\b/i],
  ['music', /\b(song|music|album|single|track|studio|record|stage|concert|tour|perform|mv|demo|lyrics|auura|intr[eé]pide)\b/i],
  ['night', /\b(party|club|night|drinks|shots|afters|after-party|dance|dj|rave|bar|wasted|3am|2am)\b/i],
  ['travel', /\b(travel|trip|flight|airport|beach|vacation|holiday|paris|tokyo|seoul|london|nyc|hotel|abroad)\b/i],
  ['love', /\b(love|bf|gf|boyfriend|girlfriend|date|dating|kiss|crush|babe|baby|anniversary|him|her|us)\b|❤|🩷|💕/i],
  ['sad', /\b(sad|cry|crying|tired|done|over it|miss|lonely|hurt|alone|why)\b|😭|💔/i],
  ['gym', /\b(gym|workout|run|running|pilates|yoga|lift|training|sweat)\b/i],
  ['work', /\b(work|office|meeting|deadline|shift|boss|ceo|job|interview|launch|deal|contract|business)\b/i],
  ['book', /\b(book|read|reading|write|writing|novel|chapter|author|seraphine|publish)\b/i],
];

const LINES = {
  any: ['obsessed 😭', 'the way i screamed', 'MOTHER', 'not you posting at this hour 💀', 'this is so you', 'ok but who took this', 'iconic behavior', "i'm sat", 'praying for whoever has to compete with this', 'you never miss', "the internet isn't ready", 'bestie ate', 'okay main character', 'no thoughts just this post', 'the vibes are immaculate', "screenshotted. don't ask why.", 'this better be on my fyp tomorrow', 'living for this', 'why is this so real', 'a moment, honestly'],
  photo: ['the lighting??', 'frame this', 'photo dump queen/king', 'swipe 3 >>>', 'camera loves you fr', 'the angles are criminal', 'my lockscreen now sorry'],
  video: ['watched this 40 times', 'the ending 😭', 'sound on was a mistake (good mistake)', 'replaying until i die'],
  voice: ['your voice is so calming', 'asmr when', 'i needed this today'],
  stream: ['first!!', 'LIVE?? omw', 'chat is moving so fast', 'hi from brazil 🇧🇷', 'say hi to me pls'],
  text: ['say it louder', 'whew. okay.', 'the subtweet energy', 'receipts or it didn\'t happen', 'who is this about 👀', 'printing this and putting it on my wall'],
  food: ['where is this from??', 'i can taste it through the screen', 'drop the location', 'chef kiss 🤌'],
  fit: ['the FIT', 'need every piece of this outfit', 'link the jacket pls', 'styled by god', 'the shoes are doing the most (good)'],
  music: ['THE VOCALS', 'streaming on repeat', 'the bridge??? genius', 'album of the year already', 'tour dates WHEN', 'the producer deserves a raise'],
  night: ['wait where was this party', 'why wasn\'t i invited 😤', 'the afters must have been insane', 'tell me everything tomorrow', 'chaotic night i see'],
  travel: ['take me with you', 'the view 😍', 'jealous is an understatement', 'where is this exactly??', 'souvenir for me or no'],
  love: ['i KNEW it', 'soft launch??', 'the way they look at each other', 'couple of the year', 'protect this at all costs 🥹', 'hard launch when'],
  sad: ['sending hugs 🫂', 'whoever did this to you, we ride at dawn', 'take care of yourself ok', 'feel better 🤍'],
  gym: ['the discipline 😤', 'gym arc is real', 'i felt that one', 'motivation unlocked'],
  work: ['ceo behavior', 'boss moves only', 'hire me', 'the hustle is unmatched', 'big things coming'],
  book: ['adding to my tbr', 'i need this book NOW', 'the writing??', 'signed copy when'],
  famous: ['@{h} notice me 🥺', 'the most famous person i follow', 'this is going viral watch', 'how is this real', '@{h} you saved my whole week'],
  mention: ['@{h} PLEASE 😭', '@{h} ok but why is this so good', '@{h} marry me', '@{h} stop i\'m crying'],
};

const NAME_A = ['luv', 'soft', 'mini', 'yuna', 'jae', 'lily', 'cherry', 'moon', 'dae', 'hyun', 'mina', 'koko', 'yuri', 'roro', 'jiwoo', 'cassie', 'nana', 'ari', 'evie', 'lulu', 'seo', 'minji', 'haru', 'kai', 'ziggy', 'pixie', 'rue', 'jules', 'nova', 'maddy'];
const NAME_B = ['archive', 'xo', 'files', 'bby', 'stan', 'lover', 'diaries', 'core', 'world', 'era', 'club', 'mood', 'daily', 'fan', 'vault', 'tv', 'pics', 'ish', 'notes', 'sz'];

function fanHandle(rand) {
  const a = NAME_A[Math.floor(rand() * NAME_A.length)];
  const b = NAME_B[Math.floor(rand() * NAME_B.length)];
  const joiner = ['', '.', '_', 'x'][Math.floor(rand() * 4)];
  const n = rand() < 0.45 ? String(Math.floor(rand() * 99) + 1) : '';
  return `${a}${joiner}${b}${n}`;
}

// Comment lines that fit this post: its topics first, then its kind, then general hype.
export function buzzLines(post, handle, followers = 0) {
  const text = `${post.body || ''} ${post.title || ''}`;
  const pools = [];
  for (const [topic, re] of TOPICS) if (re.test(text)) pools.push(LINES[topic], LINES[topic]);
  if (LINES[post.kind]) pools.push(LINES[post.kind]);
  if (followers > 50000) pools.push(LINES.famous);
  pools.push(LINES.mention, LINES.any, LINES.any);
  return pools.map((pool) => pool.map((l) => l.replaceAll('{h}', handle || 'you')));
}

// Adds `count` crowd comments to a post, a little after it went up.
export function addBuzz(db, post, count, { random = Math.random, handle = '', followers = 0 } = {}) {
  if (count <= 0) return;
  const pools = buzzLines(post, handle, followers);
  const used = new Set(db.prepare('SELECT body FROM social_buzz WHERE post_id = ?').all(post.id).map((r) => r.body));
  const ins = db.prepare(`INSERT INTO social_buzz (post_id, handle, body, likes, created_at)
    VALUES (?, ?, ?, ?, datetime(?, '+' || ? || ' seconds'))`);
  for (let i = 0; i < count; i++) {
    let body = '';
    for (let tries = 0; tries < 8 && (!body || used.has(body)); tries++) {
      const pool = pools[Math.floor(random() * pools.length)];
      body = pool[Math.floor(random() * pool.length)];
    }
    used.add(body);
    const likes = Math.round((followers > 0 ? followers * 0.0008 : 3) * random() * 3);
    ins.run(post.id, fanHandle(random), body, likes, post.created_at, String(30 + Math.floor(random() * 3600 * (i + 1))));
  }
}

// How many crowd comments a new post gets: more for more famous characters (0–8).
export const buzzForFollowers = (followers, random = Math.random) => Math.min(8, Math.round(Math.log10(followers + 1) * 1.6 + random() * 2));
