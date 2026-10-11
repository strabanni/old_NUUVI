import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

// Starts an app on a random port and returns helpers for simulated users.
export async function startApp(options = {}) {
  const pushes = [];
  const server = createApp({
    dbPath: ':memory:',
    authRateLimit: 10000,
    pushFetch: async (url, init) => { pushes.push({ url, init }); return new Response(null, { status: 201 }); },
    ...options,
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  function client() {
    let cookie = '';
    const call = async (path, { method = 'GET', body, headers = {}, raw } = {}) => {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
      return { status: res.status, data, headers: res.headers };
    };
    call.cookie = () => cookie;
    return call;
  }

  let admin;
  async function signUp(username, { invite } = {}) {
    const c = client();
    let code = invite;
    if (code === undefined && admin) code = (await admin('/api/admin/invites', { method: 'POST', body: {} })).data.code;
    const r = await c('/api/auth/register', { method: 'POST', body: { username, password: 'correct horse', displayName: username, invite: code } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    c.user = r.data.user;
    if (!admin) admin = c;
    return c;
  }

  return {
    server, base, client, signUp, pushes,
    get admin() { return admin; },
    close() { server.closeAllConnections(); server.close(); },
  };
}

// Reads Server-Sent Events from a fetch response until `count` events of interest arrive.
export function sseReader(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async function next(wanted) {
    for (;;) {
      const idx = buffer.indexOf('\n\n');
      if (idx >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = chunk.match(/^event: (.+)$/m)?.[1];
        const data = chunk.match(/^data: (.+)$/m)?.[1];
        if (event && (!wanted || wanted === event)) return { event, data: JSON.parse(data) };
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
}
