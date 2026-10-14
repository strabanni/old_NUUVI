// "Buzz": comments from the crowd on a character's social post (made-up accounts, not characters).
// They're meant to read like a real comment section:
// - they react to what's actually in the post: the caption's words and topics, who's @mentioned,
//   what the pictures look like (colour, light, how many), and the kind of post;
// - they use the poster's pronouns;
// - not everyone's a fan: jokes, questions, lukewarm takes, side-eye and the odd hater;
// - the place and the song only come up now and then (about 6% of comments each);
// - no line is used twice on a post, and each comment is put together from a reaction plus the
//   little things people add (a "wait", an emoji, a tag), so a big comment section doesn't repeat.
// Counts that grow with fame (likes on posts and comments) are worked out here too.

import { mentionTokens, resolveMention } from './names.js';

// A repeatable 0–1 number from a seed, so a post's numbers don't jump around between page loads.
export function seeded(seed) {
  let x = (Number(seed) * 2654435761) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 2246822507) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489909) >>> 0; x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
// A stream of repeatable random numbers.
export function rng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; s ^= s >>> 13; s = Math.imul(s, 3266489909) >>> 0; return ((s ^ (s >>> 16)) >>> 0) / 4294967296; };
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
    return { sub: 'she', obj: 'her', pos: 'her', is: "she's", title: 'queen', kid: 'girl', mom: 'mother' };
  }
  if (/\bhe\b|\bhim\b/.test(p) && !/\bshe\b|\bher\b|\bthey\b/.test(p)) {
    return { sub: 'he', obj: 'him', pos: 'his', is: "he's", title: 'king', kid: 'boy', mom: 'father' };
  }
  return { sub: 'they', obj: 'them', pos: 'their', is: "they're", title: 'icon', kid: 'bestie', mom: 'parent' };
}

// ---------- What the post is about ----------
const TOPICS = [
  ['food', /\b(food|eat|ate|eating|dinner|lunch|brunch|breakfast|coffee|latte|matcha|cake|ramen|sushi|pasta|cook(ing)?|chef|restaurant|snack|dessert|pizza|tteokbokki|boba|wine|cocktail)\b/i],
  ['fit', /\b(fit|outfit|ootd|dress|wearing|wore|style|fashion|shoes|heels|jacket|runway|vogue|lewk|drip|suit|tux|gown)\b/i],
  ['music', /\b(song|music|album|single|track|studio|record(ing)?|stage|concert|tour|perform(ance)?|mv|demo|lyrics|comeback|setlist|rehearsal|bass|guitar|drums|mic|band|show)\b/i],
  ['night', /\b(party|club|night|drinks|shots|afters|after-party|dance|dj|rave|bar|wasted|3am|2am|4am|lounge)\b/i],
  ['travel', /\b(travel|trip|flight|airport|vacation|holiday|paris|tokyo|seoul|london|nyc|hotel|abroad|passport|road trip)\b/i],
  ['beach', /\b(beach|ocean|sea|pool|swim|sun|summer|tan|island)\b/i],
  ['love', /\b(love|bf|gf|boyfriend|girlfriend|date|dating|kiss|crush|babe|anniversary|my person|soulmate|wife|husband)\b|❤|🩷|💕|💗/i],
  ['sad', /\b(sad|cry|crying|tired|exhausted|over it|miss(ing)? (you|him|her)|lonely|hurt|alone|rough day|bad day|heartbreak)\b|😭|💔|🥲/i],
  ['gym', /\b(gym|workout|run|running|pilates|yoga|lift(ing)?|training|sweat|pr|marathon)\b/i],
  ['work', /\b(work|office|meeting|deadline|shift|boss|ceo|job|interview|launch|deal|contract|business|grind|hustle)\b/i],
  ['book', /\b(book|read(ing)?|writ(e|ing)|novel|chapter|author|publish|manuscript|poem|poetry)\b/i],
  ['selfie', /\b(selfie|mirror|face|hair|makeup|new hair|haircut|nails|glow|skincare)\b/i],
  ['pet', /\b(dog|puppy|cat|kitten|pet)\b|🐶|🐱/i],
  ['shade', /\b(fake|snake|liars?|haters?|talk(ing)? about me|receipts|drama|beef|petty|blocked|karma|exposed)\b/i],
  ['car', /\b(car|drive|driving|ride|bike|motorcycle|porsche|ferrari)\b/i],
  ['art', /\b(art|paint(ing)?|gallery|museum|film|movie|shoot|photoshoot|editorial|campaign|magazine|cover)\b/i],
  ['birthday', /\b(birthday|bday|b-day|turning \d+|another year)\b|🎂|🥳/i],
  ['home', /\b(home|bed|sunday|lazy|chill|couch|rain|cozy|night in)\b/i],
];

// A word from the caption a person might pick up on (a hashtag, or a long real word).
function keywords(text) {
  // Only hashtags: picking random caption words reads like a bot.
  return [...new Set([...text.matchAll(/#([\p{L}\p{N}_]{3,24})/gu)].map((m) => `#${m[1]}`))];
}

// ---------- The lines ----------
// Each line is a function of the post's details (x). Moods: love (fans), fun (jokes and chaos),
// ask (questions), meh (lukewarm), shade (critics and the odd hater).
const T = {
  love: {
    any: [
      (x) => `ok ${x.first} you can stop posting now we get it`, (x) => `${x.is} so fine it's actually unfair`, () => 'this made my whole day idk why',
      (x) => `not me saving this the second ${x.sub} posted it`, (x) => `${x.first} never misses. ever.`, () => 'the way i screamed when this popped up',
      (x) => `protect ${x.obj} at all costs`, () => 'genuinely obsessed with everything about this', (x) => `${x.title} behavior honestly`,
      () => 'okay this might be my favorite post of yours', (x) => `${x.first} posting = my day is fixed`, () => 'how are you this pretty in every single pic',
      () => 'the main character energy is unreal', () => 'i\'ve been waiting for this post', () => 'this is the content i signed up for',
      (x) => `never letting ${x.obj} log off again`, () => 'you look so happy here and it makes me happy', () => 'this is art and i won\'t be taking questions',
      () => 'every time i think you can\'t top it', () => 'needed this on my feed today, thank u', () => 'a whole moment', () => 'you\'re glowing??',
      (x) => `the ${x.kid} is DOING IT`, () => 'i\'m framing this', () => 'commenting before this blows up',
    ],
    photo: [() => 'the lighting is insane', (x) => `whoever's taking ${x.pos} pictures deserves a raise`, () => 'every single photo ate', () => 'this angle is criminal',
      () => 'setting this as my wallpaper sorry not sorry', () => 'the composition??'],
    multi: [() => 'pic 2 is my favorite and i\'m not explaining', () => 'the last slide >>>', () => 'swipe 3 is THE one', () => 'photo dump ate, no notes', () => 'every slide better than the last'],
    video: [() => 'watched this like 9 times already', () => 'i can\'t stop replaying this', (x) => `${x.pos} energy in this video >>>`, () => 'the ending got me', () => 'sound on was the right call'],
    voice: [(x) => `${x.pos} voice is so calming wtf`, () => 'needed to hear this today honestly', () => 'putting this on loop'],
    stream: [() => 'omw!!', () => 'hii from the uk 🇬🇧', () => 'first time catching one live, i\'m shaking', () => 'chat is moving so fast'],
    text: [() => 'say it louder for the people in the back', () => 'this is so real', (x) => `${x.first} said what needed to be said`, () => 'printing this out', () => 'needed to read this today'],
    food: [() => 'that looks so good i could cry', () => 'ok now i\'m starving thanks', () => 'the plating is gorgeous', () => 'i can taste it through the screen'],
    fit: [() => 'the fit is SO good', () => 'need the jacket immediately', (x) => `${x.sub} really just woke up and chose fashion`, () => 'styled to perfection', () => 'this outfit should be illegal'],
    music: [() => 'the vocals on this?? come on', () => 'been on repeat all day', () => 'the bridge is going to ruin me', () => 'album of the year already', () => 'the talent is actually unfair'],
    night: [() => 'looks like the best night ever', () => 'the vibes look insane', () => 'this is giving unforgettable night'],
    travel: [() => 'take me with you next time', () => 'the view is unreal', () => 'living vicariously through you rn'],
    beach: [() => 'the water is so blue??', () => 'summer looks good on you', () => 'beach day done right'],
    love: [() => 'i KNEW it', () => 'the way they look at each other 🥹', () => 'protect this love at all costs', () => 'couple goals and it\'s not close'],
    sad: [() => 'sending you the biggest hug', (x) => `hope ${x.is} okay fr`, () => 'take care of yourself ok 🤍', () => 'we\'re here for you'],
    gym: [() => 'the discipline is scary', () => 'gym arc going crazy', () => 'the dedication!!'],
    work: [() => 'boss moves only', () => 'proud of you fr', () => 'big things coming i can feel it', () => 'deserved, every bit of it'],
    book: [() => 'adding this to my list rn', () => 'need a signed copy', () => 'your words always hit'],
    selfie: [(x) => `${x.first} woke up like this?? be serious`, () => 'the hair!!!', () => 'skin is glowing'],
    pet: [() => 'the baby!!!', () => 'i would die for this baby honestly', () => 'more of the baby pls'],
    car: [() => 'the car is a whole dream', () => 'take me for a ride'],
    art: [() => 'this belongs in a magazine', () => 'editorial ready', () => 'the creative direction is so good'],
    birthday: [(x) => `happy birthday ${x.first}!! 🎂`, () => 'happy birthday to the main character', () => 'hope your day is perfect 🥳'],
    home: [() => 'this is so cozy i want to be there', () => 'soft day energy'],
  },
  fun: {
    any: [
      () => 'not me seeing this at 3am', (x) => `${x.first} posts once in a blue moon and it's this`, () => 'the caption is doing a LOT of heavy lifting lol',
      (x) => `someone check on ${x.obj}`, () => 'i\'m screenshotting this for evidence', () => 'commenting so the algorithm knows i was here',
      (x) => `me pretending i'm not refreshing ${x.pos} page every hour`, () => 'lmaooo why is this so funny to me', () => 'my roommate just asked why i gasped',
      () => 'the audacity to look this good on a tuesday', () => 'liking this from my work computer, wish me luck', () => 'nobody tell my mom i\'m on here instead of studying',
      () => 'who allowed this', () => 'i\'m not okay after this post', () => 'this post has me acting unwise',
    ],
    shade: [() => 'oh this is about someone specific', () => 'who hurt you 😭', () => 'the subtweet energy is immaculate', () => 'names. we want names.', () => 'grabbing popcorn'],
    night: [() => 'the afters must have been chaos', () => 'tell me everything tomorrow', () => 'why wasn\'t i invited 😤'],
    love: [() => 'the single people in the comments rn:', () => 'ugh go away (i\'m happy for you)'],
    gym: [() => 'me watching this from my bed'],
    food: [() => 'invite me next time or i\'m unfollowing (jk)'],
    multi: [() => 'the last pic was a jump scare lmao'],
  },
  ask: {
    any: [() => 'wait what happened??', (x) => `is ${x.sub} okay`, () => 'context please i\'m begging', () => 'when was this??', (x) => `${x.first} who took this`,
      () => 'is there a part 2', () => 'wait is this new??', () => 'what am i looking at (respectfully)'],
    fit: [() => 'where is the jacket from??', () => 'link the shoes pls', () => 'who made the dress??'],
    food: [() => 'where is this??', () => 'is it actually good or just pretty', () => 'recipe??'],
    travel: [() => 'how long are you there for?', () => 'what hotel is this'],
    music: [() => 'is this on spotify yet?', () => 'when does it come out', () => 'tour dates??'],
    selfie: [() => 'what lipstick is that', () => 'who does your hair'],
    art: [() => 'who shot this?', () => 'what camera??'],
    love: [() => 'soft launch??', () => 'hard launch when'],
  },
  meh: {
    any: [() => 'ok', () => 'hm', () => 'interesting choice', () => 'this is fine i guess', () => 'not your best but still cute', () => 'i liked the last one more ngl',
      (x) => `${x.is} been posting a lot lately huh`, () => 'it\'s giving… something', () => 'cute', () => 'the caption doesn\'t match the pic but ok'],
    photo: [() => 'the first pic is giving, the rest not so much', () => 'filter is a bit much', () => 'a little blurry no?'],
    fit: [() => 'the shoes don\'t go but ok', () => 'it\'s giving… costume'],
    music: [() => 'the old stuff was better', () => 'it\'s growing on me slowly'],
    food: [() => 'that\'s a lot of money for that portion'],
    multi: [() => 'too many pics tbh, pick a favorite'],
  },
  shade: {
    any: [() => 'the desperation for attention is crazy', (x) => `${x.first} posts like nobody remembers last week`, () => 'unfollowing in 3, 2…', () => 'overrated tbh',
      (x) => `${x.is} trying way too hard`, () => 'we\'re just not gonna talk about what happened? ok', (x) => `funny how ${x.sub} only posts when there's drama`,
      () => 'this didn\'t need to be posted', () => 'pr team working overtime i see', () => 'the fans will defend anything lol', () => 'not the flex you think it is'],
    fit: [() => 'stylist should be fired', () => 'the fit is a crime'],
    music: [() => 'autotune doing all the work', () => 'mid. sorry.'],
    love: [() => 'give it three months', () => 'this won\'t last'],
    selfie: [() => 'facetune is crazy on this one', () => 'the filter can\'t hide everything'],
    sad: [() => 'the pity party again lol'],
    work: [() => 'nepo energy honestly'],
    photo: [() => 'the editing is so obvious'],
  },
};

// About the pictures themselves (worked out in the browser when they're posted: colour, light, how many).
const LOOK = {
  love: {
    dark: [() => 'the dark moody tones are so good', () => 'giving night drive', () => 'the shadows in this ate'],
    bright: [() => 'so bright and happy i love it', () => 'the sunlight in this!!', () => 'golden hour hit right'],
    soft: [() => 'the colors are so soft', () => 'dreamy, all of it'],
    bw: [() => 'black and white was the right call', () => 'feels like an old film still'],
    color: [(x) => `the ${x.look.color} in this 😮‍💨`, (x) => `${x.look.color} is your color fr`, (x) => `obsessed with all the ${x.look.color}`],
  },
  meh: { dark: [() => 'a bit too dark to see anything lol'], bright: [() => 'kinda overexposed?'] },
  shade: { color: [(x) => `the ${x.look.color} filter isn't it`] },
};

// When other characters are @mentioned in the caption. These never say the person is in the picture…
const MENTION = {
  love: [(x, m) => `you and ${m}?? i need the story`, (x, m) => `the ${x.first} and ${m} friendship >>>`, (x, m) => `${m} come see this`],
  fun: [(x, m) => `${m} got tagged and we all saw it 👀`, (x, m) => `the ${m} shoutout 👀`, (x, m) => `${m} come get your friend`],
  ask: [(x, m) => `since when are you and ${m} close??`, (x, m) => `why is ${m} tagged, what did i miss`],
  shade: [(x, m) => `${m} again? ok`, (x, m) => `the tag on ${m} is doing a lot`],
};
// …and these do, so they're only used when the writer says the tagged people are in the picture.
const MENTION_IN = {
  love: [(x, m) => `${m} looks so good here too`, (x, m) => `${m} in the pics is a bonus`, (x, m) => `${x.first} and ${m} in one frame, i'm unwell`],
  fun: [(x, m) => `why is ${m} in this… explain`, (x, m) => `${m} photobombing as usual`],
  ask: [(x, m) => `wait is ${m} there too?`, (x, m) => `who took the pic if ${m} is in it??`],
  shade: [(x, m) => `${m} in the background like that 😐`],
};

// What a tagged person is to the poster (picked per person in the post window).
export const RELATIONSHIPS = ['friend', 'bestie', 'partner', 'crush', 'situationship', 'ex', 'family', 'sibling', 'coworker', 'groupmate', 'rival', 'enemy'];
// Lines for a tagged person, by what they are to the poster. "in" lines say they're in the picture,
// so they're only used when the writer says that person is.
const REL = {
  friend: { out: [(x, m) => `${m} is such a good friend for this`, (x, m) => `the ${x.first} and ${m} friendship >>>`, (x, m) => `${m} come see this`],
    in: [(x, m) => `you and ${m} together is always a good time`, (x, m) => `${m} looking good too!!`] },
  bestie: { out: [(x, m) => `${m} better be commenting first`, (x, m) => `best friend tag, ${m} you're on`, (x, m) => `${m} is the bestie of all time`],
    in: [(x, m) => `the besties in one frame 🥹`, (x, m) => `${x.first} and ${m} never miss`, (x, m) => `${m} matching your energy as always`] },
  partner: { out: [(x, m) => `${m} is a lucky one`, (x, m) => `the way you tagged ${m} 🥹`, (x, m) => `${m} you better be hyping this up`],
    in: [(x, m) => `you and ${m} are so cute it's unfair`, (x, m) => `${m} looking at you like that 😭`, (x, m) => `couple goals, ${m} included`, (x, m) => `the ${m} soft launch is over, this is a hard launch`] },
  crush: { out: [(x, m) => `the ${m} tag is doing a LOT 👀`, (x, m) => `${m} please notice`, (x, m) => `we all see the ${m} tag`],
    in: [(x, m) => `the way you're standing next to ${m} 👀`, (x, m) => `${m} in the pic?? i see what's happening`] },
  situationship: { out: [(x, m) => `so what are you and ${m}?`, (x, m) => `${m} tag with no label?? ok`],
    in: [(x, m) => `you and ${m} again… just date already`, (x, m) => `${m} in the pics but "just friends" sure`] },
  ex: { out: [(x, m) => `tagging ${m} after everything??`, (x, m) => `${m}?? i thought that was over`, (x, m) => `not ${m} being tagged 😭`],
    in: [(x, m) => `you and ${m} in the same pic again?? explain`, (x, m) => `${m} is back?? what did i miss`] },
  family: { out: [(x, m) => `the ${m} family love`, (x, m) => `${m} raised you right`],
    in: [(x, m) => `family pics with ${m} are the best`, (x, m) => `you and ${m} look so alike here`] },
  sibling: { out: [(x, m) => `${m} is going to roast you for this`, (x, m) => `the sibling tag lol ${m}`],
    in: [(x, m) => `sibling pics with ${m} 🥹`, (x, m) => `you and ${m} have the same face, it's crazy`] },
  coworker: { out: [(x, m) => `${m} the work friend we all need`, (x, m) => `${m} better be on this project too`],
    in: [(x, m) => `you and ${m} at work like this lol`, (x, m) => `the ${m} work duo`] },
  groupmate: { out: [(x, m) => `${m} come see your member`, (x, m) => `the members tagging each other 🥹`],
    in: [(x, m) => `you and ${m} together, the duo we needed`, (x, m) => `${m} and ${x.first} unit when`] },
  rival: { out: [(x, m) => `tagging ${m}?? the rivalry continues`, (x, m) => `${m} is not going to like this lol`],
    in: [(x, m) => `you and ${m} in one pic?? peace treaty?`, (x, m) => `the tension between you and ${m} here 😭`] },
  enemy: { out: [(x, m) => `why would you tag ${m} 💀`, (x, m) => `${m}?? after everything?`],
    in: [(x, m) => `you and ${m} in one frame is not something i expected`, (x, m) => `${m} standing there like nothing happened`] },
};

// The place and the song (only now and then).
const PLACE = [(x) => `${x.loc} looks so good on you`, (x) => `wait i'm literally near ${x.loc} rn`, (x) => `is ${x.loc} worth going to?`, (x) => `${x.loc} again? you live there now lol`];
const SONG = [(x) => `putting "${x.song}" on this was a choice and i respect it`, (x) => `"${x.song}"?? you have taste`, (x) => `"${x.song}" fits this way too well`];
// A caption word picked up.
const WORD = [(x, w) => `the ${w} in the caption 😭`, (x, w) => `${w} is so real`, (x, w) => `${w} trending by tonight`, (x, w) => `saw ${w} and came running`];

// Moods: mostly fans, then jokes and questions, then lukewarm and critics.
const MOODS = [['love', 0.5], ['fun', 0.16], ['ask', 0.12], ['meh', 0.1], ['shade', 0.12]];
function pickMood(rand) {
  let r = rand();
  for (const [m, w] of MOODS) { if (r < w) return m; r -= w; }
  return 'love';
}
const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

// Little things people add around what they're saying.
const OPENERS = ['', '', '', '', '', 'ok but ', 'wait ', 'honestly ', 'ngl ', 'lowkey ', 'not gonna lie ', 'be so serious, ', 'omg ', 'stop ', 'girl ', 'bro ', 'okay '];
const CLOSERS = ['', '', '', '', '', ' fr', ' lol', ' istg', ' ngl', ' 😭', ' 🔥', ' ✨', ' 🥹', ' 💀', ' 👀', '!!', ' omg', ' 🫶', ' 😩', ' tbh'];

// The things a comment can react to, for this post.
function postContext(post, character, mentions = []) {
  let meta = {};
  try { meta = JSON.parse(post.meta || '{}'); } catch { /* none */ }
  const text = `${post.body || ''} ${post.title || ''}`;
  // The writer's "what's happening" note helps pick topics (it's never quoted).
  const about = `${text} ${meta.context || ''}`;
  let media = [];
  try { media = JSON.parse(post.media || '[]'); } catch { /* none */ }
  const name = String(character?.name || '').trim();
  return {
    ...pronounSet(character?.pronouns),
    first: (name.split(/\s+/)[0] || 'you').toLowerCase(),
    handle: character?.handle || '',
    loc: post.location || '',
    song: meta.music?.title || '',
    look: meta.look || null,
    words: keywords(text),
    mentions,
    together: meta.tagged === true,
    people: meta.people && typeof meta.people === 'object' ? meta.people : null,
    topics: TOPICS.filter(([, re]) => re.test(about)).map(([t]) => t),
    kind: post.kind,
    multi: media.length > 1,
  };
}

// One reaction (the "core" of a comment) and a key for it, so each core is used once per post.
function core(x, mood, rand) {
  const r = rand();
  if (x.loc && r < 0.06) { const i = Math.floor(rand() * PLACE.length); return [`place${i}`, PLACE[i](x)]; }
  if (x.song && r >= 0.06 && r < 0.12) { const i = Math.floor(rand() * SONG.length); return [`song${i}`, SONG[i](x)]; }
  const r2 = rand();
  if (x.mentions.length && r2 < 0.18 && MENTION[mood]) {
    const m = pick(x.mentions, rand);
    // Tagged people with their own settings: lines that fit what they are to the poster.
    if (x.people) {
      const who = x.people[m.slice(1).toLowerCase()];
      const inPic = !!who?.in;
      const rel = who?.rel && REL[who.rel];
      if (rel && rand() < 0.75) {
        const side = inPic && rand() < 0.6 ? 'in' : 'out';
        const j = Math.floor(rand() * rel[side].length);
        return [`r${who.rel}${side}${j}${m}`, rel[side][j](x, m)];
      }
      const lines = inPic && MENTION_IN[mood] && rand() < 0.5 ? MENTION_IN[mood] : MENTION[mood];
      const i = Math.floor(rand() * lines.length);
      return [`m${lines === MENTION_IN[mood] ? 'in' : ''}${mood}${i}${m}`, lines[i](x, m)];
    }
    const lines = x.together && MENTION_IN[mood] && rand() < 0.5 ? MENTION_IN[mood] : MENTION[mood];
    const i = Math.floor(rand() * lines.length);
    return [`m${lines === MENTION_IN[mood] ? 'in' : ''}${mood}${i}${m}`, lines[i](x, m)];
  }
  const lk = x.look && LOOK[mood];
  if (lk && r2 < 0.32) {
    const keys = [x.look.tone, x.look.bw ? 'bw' : null, x.look.color ? 'color' : null].filter((k) => k && lk[k]);
    if (keys.length) { const k = pick(keys, rand); const i = Math.floor(rand() * lk[k].length); return [`l${mood}${k}${i}`, lk[k][i](x)]; }
  }
  if (x.words.length && r2 > 0.9 && mood !== 'shade') {
    const w = pick(x.words, rand); const i = Math.floor(rand() * WORD.length);
    return [`w${i}`, WORD[i](x, w)];
  }
  const bank = T[mood];
  const pools = [];
  for (const t of x.topics) if (bank[t]) pools.push([t, bank[t]], [t, bank[t]]);
  if (x.multi && bank.multi) pools.push(['multi', bank.multi]);
  if (bank[x.kind]) pools.push([x.kind, bank[x.kind]]);
  pools.push(['any', bank.any], ['any', bank.any]);
  const [name, pool] = pick(pools, rand);
  const i = Math.floor(rand() * pool.length);
  return [`${mood}${name}${i}`, pool[i](x)];
}

// Real people don't all type the same.
function dress(line, mood, rand, x) {
  let s = line;
  const kind = mood === 'shade' || mood === 'meh' ? 'cool' : 'warm';
  if (kind === 'warm' && !/^(wait|ok|honestly|ngl|okay|omg|stop)\b/i.test(s)) s = pick(OPENERS, rand) + s;
  const ended = /(\p{Extended_Pictographic}|\blol|\btbh|\bngl|\bfr|[!?.…:])$/u.test(s);
  if (!ended && kind === 'warm') s += pick(CLOSERS, rand);
  else if (!ended && kind === 'cool' && rand() < 0.2) s += pick([' lol', ' tbh', ' ngl', ''], rand);
  const r = rand();
  if (mood === 'love' && r < 0.08) s = s.toUpperCase();
  else if (r < 0.18) s = s.charAt(0).toUpperCase() + s.slice(1);
  if (rand() < 0.1) s = s.replace(/\bso\b/, 'sooo').replace(/\byou\b/, 'u');
  if (rand() < 0.07 && x.handle && s === s.toLowerCase()) s = `@${x.handle} ${s}`;
  return s.replace(/\s+/g, ' ').trim();
}

// Ardell City is a melting pot, so its fans come from everywhere.
const NAME_A = [
  'marcus', 'devon', 'tasha', 'keisha', 'jamal', 'malik', 'aaliyah', 'imani', 'nia', 'xavier', 'jaylen', 'destiny', 'tre', 'kiara',
  'sofia', 'mateo', 'diego', 'valentina', 'carlos', 'lucia', 'santiago', 'marisol', 'gabi', 'rosa', 'javi', 'yesenia', 'luis', 'camila',
  'priya', 'ravi', 'anjali', 'arjun', 'omar', 'yusuf', 'leila', 'fatima', 'amir', 'layla', 'nadia', 'yara', 'zain', 'hassan',
  'kofi', 'ade', 'chidi', 'ngozi', 'kwame', 'amara', 'tunde', 'zola', 'liam', 'connor', 'siobhan', 'aoife', 'olivia', 'ethan',
  'maddie', 'tyler', 'jordan', 'brianna', 'chloe', 'isaac', 'theo', 'quinn', 'remy', 'jules', 'ivan', 'katya', 'sasha', 'tomas',
  'luca', 'giulia', 'enzo', 'mei', 'kenji', 'aya', 'minh', 'thu', 'paolo', 'rina', 'dani', 'zara', 'bella', 'nova', 'rue',
  'luv', 'soft', 'mini', 'cherry', 'moon', 'koko', 'pixie', 'ziggy', 'lulu', 'evie', 'ardell', 'harbor', 'kingsward', 'northridge', 'nyc'];
const NAME_B = ['archive', 'xo', 'files', 'stan', 'lover', 'diaries', 'core', 'world', 'era', 'club', 'mood', 'daily', 'vault', 'tv', 'pics', 'notes', 'sz', '', '', '', '', 'official', 'irl', 'og', 'fan', 'updates'];
function fanHandle(rand) {
  const a = pick(NAME_A, rand);
  const b = pick(NAME_B, rand);
  const joiner = b ? pick(['', '.', '_', 'x'], rand) : '';
  const n = rand() < 0.45 ? String(Math.floor(rand() * 99) + 1) : rand() < 0.2 ? String(1990 + Math.floor(rand() * 16)) : '';
  return `${a}${joiner}${b}${n}`;
}

// Writes `count` comments for a post: unique, varied and fitting. Returns [{ handle, body, mood }].
export function makeComments(post, character, count, { mentions = [], seed = post.id, avoid = [] } = {}) {
  const x = postContext(post, character, mentions);
  const rand = rng(seed * 7919 + count);
  const usedCores = new Set();
  const usedText = new Set(avoid.map((b) => b.toLowerCase()));
  const out = [];
  for (let i = 0; i < count; i++) {
    let body = '';
    let mood = 'love';
    for (let tries = 0; tries < 30; tries++) {
      mood = pickMood(rand);
      const [key, line] = core(x, mood, rand);
      // Each reaction once per post (while there are fresh ones left); every comment's text is unique.
      if (usedCores.has(key) && tries < 24) continue;
      const dressed = dress(line, mood, rand, x);
      if (usedText.has(dressed.toLowerCase())) continue;
      usedCores.add(key);
      body = dressed;
      break;
    }
    if (!body) continue;
    usedText.add(body.toLowerCase());
    out.push({ handle: fanHandle(rand), body, mood });
  }
  return out;
}

// Characters @mentioned in a caption, by their handles (shown as @handle in comments).
export function mentionedHandles(db, post) {
  const tokens = mentionTokens(post.body);
  if (!tokens.length) return [];
  const known = db.prepare('SELECT handle FROM characters WHERE handle = ? COLLATE NOCASE');
  return [...new Set(tokens.map((t) => resolveMention(t, (h) => known.get(h)?.handle)).filter(Boolean))].map((h) => `@${h}`);
}

// Replaces a post's crowd comments with `count` fresh ones that fit what the post says now.
export function setBuzz(db, post, count, { followers = 0, random = Math.random } = {}) {
  db.prepare('DELETE FROM social_buzz WHERE post_id = ?').run(post.id);
  addBuzz(db, post, count, { followers, random });
}

// Adds `count` crowd comments to a post (on top of any it has), a little after it went up.
export function addBuzz(db, post, count, { random = Math.random, followers = 0 } = {}) {
  if (count <= 0) return;
  const character = db.prepare('SELECT name, handle, pronouns FROM characters WHERE id = ?').get(post.character_id);
  const have = db.prepare('SELECT body FROM social_buzz WHERE post_id = ?').all(post.id).map((r) => r.body);
  const seed = post.id + have.length * 101 + Math.floor(random() * 1000);
  const comments = makeComments(post, character, count, { mentions: mentionedHandles(db, post), seed, avoid: have });
  insertBuzz(db, post, comments, { random, followers });
}

// Saves crowd comments ({ handle, body, mood }) under a post, spread out over the hours after it went up.
export function insertBuzz(db, post, comments, { random = Math.random, followers = 0 } = {}) {
  const ins = db.prepare(`INSERT INTO social_buzz (post_id, handle, body, likes, created_at)
    VALUES (?, ?, ?, ?, datetime(?, '+' || ? || ' seconds'))`);
  const base = followers > 0 ? followers * 0.0008 : 3;
  comments.forEach((c, i) => {
    // Critics get fewer likes than fans (usually).
    const likes = Math.round(base * random() * (c.mood === 'shade' ? 1.2 : c.mood === 'love' ? 3 : 1.6));
    const after = 30 + Math.floor(random() * 3600 * Math.min(48, 1 + i / 4));
    ins.run(post.id, c.handle, c.body, likes, post.created_at, String(after));
  });
}

// A sample of comments for a post (for tests and previews).
export function sampleBuzz(post, character, n = 10, rand = Math.random, mentions = []) {
  return makeComments(post, character, n, { mentions, seed: Math.floor(rand() * 1e9) }).map((c) => c.body);
}

// How many crowd comments a new post gets: more for more famous characters (0–8).
export const buzzForFollowers = (followers, random = Math.random) => Math.min(8, Math.round(Math.log10(followers + 1) * 1.6 + random() * 2));
// With a comment number set on the post, at least a quarter of it is written out (up to 400).
export const buzzTarget = (commentsShown, followers, random = Math.random) => (commentsShown
  ? Math.min(400, Math.max(Math.ceil(commentsShown * 0.25), buzzForFollowers(followers, random)))
  : buzzForFollowers(followers, random));
