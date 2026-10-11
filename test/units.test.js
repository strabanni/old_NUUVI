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
