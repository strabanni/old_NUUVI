// Username rules: any letters, numbers, symbols or emoji, no length rule beyond a technical cap,
// just no spaces (they'd break @mentions) and nothing inappropriate.
import { fail } from './http.js';

export const MAX_USERNAME = 100;

// Matched anywhere inside a name once it's lowercased, de-accented and de-leetspeaked.
const BLOCKED_ANYWHERE = [
  'nigger',
  'nigga',
  'faggot',
  'tranny',
  'wetback',
  'raghead',
  'towelhead',
  'whore',
  'molest',
  'hentai',
  'hitler',
  'kkk',
  'cocksuck',
  'motherfuck',
  'fuck',
  'bitch',
  'pussy',
  'blowjob',
  'handjob',
  'dildo',
  'jizz',
];
// Matched only as a whole word, so ordinary names that happen to contain them are fine
// ("Ashitaka", "Cassandra", "Semenov", "therapist").
const BLOCKED_WORDS = [
  'cunt',
  'slut',
  'dick',
  'cock',
  'cum',
  'ass',
  'spic',
  'coon',
  'dyke',
  'fag',
  'sex',
  'rape',
  'rapist',
  'tits',
  'anal',
  'hoe',
  'shit',
  'retard',
  'kike',
  'chink',
  'beaner',
  'pedo',
  'paedo',
  'porn',
  'nazi',
  'nude',
  'naked',
  'penis',
  'vagina',
  'semen',
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i' };
const simplify = (s) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[013457 8@$!|]/g, (c) => LEET[c] ?? c);

export function isInappropriate(name) {
  const plain = simplify(name);
  const squashed = plain.replace(/[^a-z]/g, '');
  if (BLOCKED_ANYWHERE.some((w) => squashed.includes(w))) return true;
  const words = plain.split(/[^a-z]+/).filter(Boolean);
  return words.some((w) => BLOCKED_WORDS.includes(w)) || BLOCKED_WORDS.includes(squashed);
}

// Usernames compare the same regardless of case or look-alike forms ("Ｒｏｓｅ" = "rose").
export const nameKey = (s) => s.normalize('NFKC').toLowerCase();

export function validUsername(value) {
  if (typeof value !== 'string') fail(400, 'Username is required');
  const name = value.normalize('NFC').trim();
  if (!name) fail(400, 'Username is required');
  if ([...name].length > MAX_USERNAME) fail(400, `Username must be at most ${MAX_USERNAME} characters`);
  if (/[\s\p{C}]/u.test(name)) fail(400, 'Usernames can’t have spaces. Your display name can');
  if (isInappropriate(name)) fail(400, 'Please pick a different username');
  return name;
}

export function validDisplayName(name) {
  if (name && isInappropriate(name)) fail(400, 'Please pick a different display name');
  return name;
}

// Character @handles: letters, numbers and special characters (♡ ˚ ★ ~ - ø é 💋 …) are all fine.
// Only what would break things is left out: spaces, @ and # (mentions and hashtags), and < > & " ' ` / \.
export const HANDLE_CHAR = '[^\\s\\p{C}@#<>&"\'`/\\\\]';
const HANDLE_RE = new RegExp(`^${HANDLE_CHAR}{1,30}$`, 'u');
export const MAX_HANDLE = 30;

export function validHandle(value) {
  const handle = String(value ?? '')
    .normalize('NFC')
    .trim()
    .replace(/^@/, '');
  if (!handle) fail(400, 'Add a username');
  if ([...handle].length > MAX_HANDLE) fail(400, `Usernames can be up to ${MAX_HANDLE} characters`);
  if (!HANDLE_RE.test(handle) && !new RegExp(`^${HANDLE_CHAR}+$`, 'u').test(handle))
    fail(400, 'Usernames can’t have spaces, @, # or < > & " \' ` / \\');
  if (isInappropriate(handle)) fail(400, 'Please pick a different username');
  return handle;
}

// The @words in some text, as typed (may carry punctuation after them: "@mina♡!!").
export const mentionTokens = (text) =>
  [...String(text || '').matchAll(new RegExp(`@(${HANDLE_CHAR}{1,60})`, 'gu'))].map((m) => m[1]);

// Which handle an @word means: the whole thing if it's a handle, else with the punctuation or emoji
// on the end dropped one at a time ("@mina!!" → mina, "@mina♡" stays mina♡ when that's the handle).
export function resolveMention(token, find) {
  let t = [...token];
  while (t.length) {
    const hit = find(t.join(''));
    if (hit) return hit;
    if (/[\p{L}\p{N}]/u.test(t.at(-1))) return null;
    t = t.slice(0, -1);
  }
  return null;
}
