import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, hkdfSync, createDecipheriv } from 'node:crypto';
import { rollDice } from '../server/dice.js';
import { encryptPayload, generateVapidKeys } from '../server/push.js';

test('dice: parses and stays in range', () => {
  for (let i = 0; i < 200; i++) {
    const r = rollDice('2d6 + 1d4 - 1');
    assert.ok(r.total >= 2 && r.total <= 15);
    assert.equal(r.terms.length, 3);
  }
  assert.equal(rollDice('d20').terms[0].dice, '1d20');
  for (const bad of ['', '5', 'd1', '1000d6', '2d6++1', 'abc', '1d20 lol', '1d1001']) {
    assert.throws(() => rollDice(bad), { status: 400 }, bad);
  }
});

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
