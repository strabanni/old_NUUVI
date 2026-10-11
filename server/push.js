// Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291),
// implemented with node:crypto so NUUVI needs no third-party packages.
// Payloads are end-to-end encrypted: Apple/Google's push services can't read them.
import {
  createECDH, createPrivateKey, createPublicKey, generateKeyPairSync,
  sign, hkdfSync, randomBytes, createCipheriv,
} from 'node:crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function generateVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: rawPublicKey(publicKey), privateKey: jwk.d };
}

function rawPublicKey(keyObject) {
  const jwk = keyObject.export({ format: 'jwk' });
  return b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
}

function vapidKeyObject({ publicKey, privateKey }) {
  const raw = Buffer.from(publicKey, 'base64url');
  return createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: privateKey, x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) },
  });
}

function vapidHeader(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: vapidKeyObject(vapid), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${vapid.publicKey}`;
}

// Encrypts a payload for one subscription (single record, aes128gcm).
export function encryptPayload(payload, { p256dh, auth }) {
  const uaPublic = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

export function validateSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  try {
    if (Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) return null;
    createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(Buffer.from(keys.p256dh, 'base64url').subarray(1, 33)), y: b64u(Buffer.from(keys.p256dh, 'base64url').subarray(33)) } });
  } catch {
    return null;
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export function createPusher({ db, vapid, subject, fetchImpl = fetch }) {
  async function sendOne(sub, payload) {
    try {
      const res = await fetchImpl(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidHeader(sub.endpoint, vapid, subject),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: 'normal',
        },
        body: encryptPayload(JSON.stringify(payload), sub),
      });
      // Gone / not found: the browser unsubscribed, so forget it.
      if (res.status === 404 || res.status === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
      }
    } catch (err) {
      console.warn('push failed:', err.message);
    }
  }

  return {
    publicKey: vapid.publicKey,
    send(userId, payload) {
      const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
      return Promise.all(subs.map((s) => sendOne(s, payload)));
    },
  };
}

// Loads VAPID keys from env, or creates and stores them in the database once.
export function loadVapidKeys(db) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const row = db.prepare("SELECT value FROM settings WHERE key = 'vapid'").get();
  if (row) return JSON.parse(row.value);
  const keys = generateVapidKeys();
  db.prepare("INSERT INTO settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return keys;
}
