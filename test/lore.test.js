// Lore saved before MOSSETA, NOER, OKINE and MONO existed gets them added once, in the right places.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startApp } from './helpers.js';
import { LORE_PRESET } from '../public/js/lore-preset.js';

test('saved lore gets the new companies once, after their parent company', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'nuuvi-lore-')), 'n.db');
  let app = await startApp({ dbPath });
  const admin = await app.signUp('lore_admin');
  // An edited lore from before: no new companies, the old INTRÉPIDE wording, and an admin's own edit.
  const old = { ...LORE_PRESET, tagline: 'our own tagline', orgs: LORE_PRESET.orgs.filter((o) => !['MOSSETA', 'NOER', 'OKINE', 'MONO'].includes(o.name))
    .map((o) => (o.name.startsWith('INTR') ? { ...o, body: o.body.replace('minimal authority intervention.', 'minimal interference.') } : o)) };
  assert.equal((await admin('/api/lore', { method: 'PUT', body: old })).status, 200);
  app.close();
  const db = new DatabaseSync(dbPath);
  db.exec("DELETE FROM settings WHERE key = 'lore_v2'"); // as if it was saved before this update
  db.close();

  app = await startApp({ dbPath });
  const w = await app.client();
  await w('/api/auth/login', { method: 'POST', body: { username: 'lore_admin', password: 'correct horse' } });
  const lore = (await w('/api/lore')).data.overview;
  const names = lore.orgs.map((o) => o.name);
  assert.equal(lore.tagline, 'our own tagline', 'admin edits stay');
  assert.deepEqual(names.slice(0, 5), ['FOYAEN INC.', 'AUURA', 'MOSSETA', 'NOER', 'OKINE']);
  assert.ok(names.indexOf('MONO') === names.indexOf('INTRÉPIDE (ent.)') + 1, names.join(', '));
  assert.match(lore.orgs.find((o) => o.name.startsWith('INTR')).body, /minimal authority intervention\.$/);
  app.close();
});
