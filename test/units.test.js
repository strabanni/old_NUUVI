import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, hkdfSync, createDecipheriv } from 'node:crypto';
import { encryptPayload, generateVapidKeys } from '../server/push.js';

// Decrypts as the browser would (RFC 8291) to prove the encryption is correct.
test('push: aes128gcm payload decrypts with the subscriber keys', () => {
  const ua = createECDH('prime256v1');
  const uaPublic = ua.generateKeys();
  const auth = randomBytes(16);
  const message = JSON.stringify({ title: 'Hi', body: 'Your turn!' });
  const enc = encryptPayload(message, { p256dh: uaPublic.toString('base64url'), auth: auth.toString('base64url') });

  const salt = enc.subarray(0, 16);
  assert.equal(enc.readUInt32BE(16), 4096);
  const idlen = enc[20];
  const asPublic = enc.subarray(21, 21 + idlen);
  const ciphertext = enc.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2); // last-record padding delimiter
  assert.equal(plain.subarray(0, -1).toString(), message);
});

test('push: VAPID keys are a 65-byte public key and 32-byte private key', () => {
  const { publicKey, privateKey } = generateVapidKeys();
  assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
  assert.equal(Buffer.from(privateKey, 'base64url').length, 32);
});

test('usernames: anything goes except spaces and inappropriate words', async () => {
  const { validUsername, isInappropriate, nameKey } = await import('../server/names.js');
  for (const ok of ['r', 'rosé', 'ᴿᴼˢᴱ', '✿yoonoh✿', 'x'.repeat(100), '로즈', 'a.b-c!?', 'Ashitaka', 'Cassandra', 'Dickens', 'Semenov', 'therapist']) {
    assert.equal(validUsername(ok), ok.normalize('NFC'), ok);
  }
  for (const bad of ['two words', 'x'.repeat(101), '', '   ', 'tab\there', 'n1gg3r', 'FuckYou', 'big_dick', 'xX_sh1t_Xx']) {
    assert.throws(() => validUsername(bad), undefined, bad);
  }
  assert.equal(isInappropriate('Ｂｉｔｃｈ'), true);
  assert.equal(nameKey('ＲＯＳÉ'), nameKey('rosé'));
});

test('formatting: Discord and forum codes, and nothing unsafe gets through', async () => {
  const { formatPost } = await import('../public/js/lib.js');
  const f = (s) => String(formatPost(s).v ?? formatPost(s));
  assert.equal(f('# Big\n-# small'), '<div class="fx-h1">Big</div><div class="fx-sub">small</div>');
  assert.equal(f('- a\n- b'), '<ul class="fx-list"><li>a</li><li>b</li></ul>');
  assert.match(f('```\n**raw** <b>\n```'), /<pre class="fx-code"><code>\*\*raw\*\* &lt;b&gt;<\/code><\/pre>/);
  assert.match(f('[quote=Rose]hi[/quote]'), /<blockquote class="fx-quote"><cite>Rose<\/cite><p>hi<\/p><\/blockquote>/);
  assert.match(f('[link](https://example.com)'), /<a href="https:\/\/example.com"[^>]*>link<\/a>/);
  assert.match(f('https://media.tenor.com/x/y.gif'), /<img class="fx-img" src="https:\/\/media.tenor.com\/x\/y.gif"/);
  assert.match(f('https://giphy.com/gifs/cat-JIX9t2j0ZTN9S'), /src="https:\/\/media.giphy.com\/media\/JIX9t2j0ZTN9S\/giphy.gif"/);
  assert.match(f('"see https://x.com/a." ok'), /<a href="https:\/\/x.com\/a"[^>]*>https:\/\/x.com\/a<\/a>\.&quot;/);
  // Nothing escapes: tags stay text, javascript: links and quote-breaking links are refused.
  const evil = f('<img src=x onerror=1> [url=javascript:alert(1)]x[/url] [link](javascript:alert(1)) https://x.com/a"onmouseover=1 [font=x" onclick="1]t[/font] [color=red;x]c[/color]');
  assert.doesNotMatch(evil, /<img|href="javascript|onmouseover="|onclick=/);
});

test('extra spaces are kept as typed, in posts and AKA lines', async () => {
  const { formatPost, akaHtml } = await import('../public/js/lib.js');
  const f = (s) => String(formatPost(s).v ?? formatPost(s));
  assert.match(f('word    word'), /word    word/);
  assert.match(f('**bold  words**'), /<strong>bold  words<\/strong>/);
  assert.match(f('one\n  indented'), /<br>  indented/);
  assert.doesNotMatch(f('one two'), / /);
  assert.match(f('a [url=https://example.com]link  text[/url]'), /href="https:\/\/example\.com"/);
  assert.equal(akaHtml('genius  ..  **oh little miss**'), 'genius  ..  <b class="accent">oh little miss</b>');
});

test('<b> and <hl> work in posts and AKA lines', async () => {
  const { formatPost, akaHtml } = await import('../public/js/lib.js');
  const f = (s) => String(formatPost(s).v ?? formatPost(s));
  assert.match(f('He <b>hated</b> it'), /<strong>hated<\/strong>/);
  assert.match(f('The <hl>hollow</hl> of his eye'), /<mark class="fx-chip">hollow<\/mark>/);
  assert.match(f('[hl]soft[/hl]'), /<mark class="fx-chip">soft<\/mark>/);
  assert.doesNotMatch(f('<hl onclick="x">a</hl>'), /onclick/);
  assert.equal(akaHtml('<b>genius</b> <hl>by rayvn</hl>'), '<b class="accent">genius</b> <mark class="fx-chip">by rayvn</mark>');
  assert.doesNotMatch(akaHtml('<script>x</script>'), /<script>/);
});
