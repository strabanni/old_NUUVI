import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, SCHEMA, MIGRATIONS } from '../server/db.js';

test('a version 1 database is upgraded through every migration in place and keeps its data', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'nuuvi-mig-')), 'old.db');
  const old = new DatabaseSync(path);
  old.exec(SCHEMA);
  old.exec('PRAGMA user_version = 1');
  old.prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('old', 'Old', 'x')").run();
  old.prepare("INSERT INTO stories (owner_id, title, invite_code) VALUES (1, 'S', 'c')").run();
  old.prepare("INSERT INTO channels (story_id, name) VALUES (1, 'ooc-chat')").run();
  old.prepare("INSERT INTO notifications (user_id, type) VALUES (1, 'post')").run();
  old.close();

  const db = openDb(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 28);
  const row = db.prepare("SELECT * FROM users WHERE username = 'old'").get();
  assert.equal(row.profile, '{}');
  assert.equal(row.banner, null);
  assert.equal(db.prepare('SELECT kind FROM channels').get().kind, 'ooc');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 1);
  db.prepare("INSERT INTO notifications (user_id, type) VALUES (1, 'follow')").run();
  db.close();
});

test('upgrading to v24 keeps every text, read marker and contact when the phone conversations are rebuilt', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'nuuvi-mig-')), 'v23.db');
  const old = new DatabaseSync(path);
  old.exec('PRAGMA foreign_keys = ON');
  old.exec(SCHEMA);
  for (const m of MIGRATIONS.slice(0, 22)) old.exec(m);
  old.exec('PRAGMA user_version = 23');
  old.prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('w', 'W', 'x')").run();
  for (const name of ['Ann', 'Bo', 'Cy']) old.prepare("INSERT INTO characters (user_id, name, handle) VALUES (1, ?, lower(?))").run(name, name);
  old.prepare('INSERT INTO phone_threads (a_id, b_id) VALUES (1, 2)').run();
  old.prepare('INSERT INTO phone_threads (a_id, b_id) VALUES (2, 3)').run();
  old.prepare("INSERT INTO phone_messages (thread_id, character_id, user_id, body) VALUES (1, 1, 1, 'hi')").run();
  old.prepare("INSERT INTO phone_messages (thread_id, character_id, user_id, body, reply_to) VALUES (1, 2, 1, 'hey', 1)").run();
  old.prepare("INSERT INTO phone_messages (thread_id, character_id, user_id, body) VALUES (2, 3, 1, 'yo')").run();
  old.prepare('INSERT INTO phone_reads (character_id, thread_id, last_read_id) VALUES (2, 1, 2)').run();
  old.prepare('INSERT INTO phone_contacts (character_id, contact_id) VALUES (1, 2)').run();
  old.close();

  const db = openDb(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 28);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.deepEqual(db.prepare('SELECT thread_id, body, reply_to, kind FROM phone_messages ORDER BY id').all().map((r) => ({ ...r })),
    [{ thread_id: 1, body: 'hi', reply_to: null, kind: 'text' }, { thread_id: 1, body: 'hey', reply_to: 1, kind: 'text' }, { thread_id: 2, body: 'yo', reply_to: null, kind: 'text' }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM phone_reads').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM phone_contacts').get().n, 1);
  assert.deepEqual(db.prepare('SELECT thread_id, character_id FROM phone_members ORDER BY thread_id, character_id').all().map((r) => [r.thread_id, r.character_id]), [[1, 1], [1, 2], [2, 2], [2, 3]]);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  // Pairs stay unique; groups don't need a pair; deleting a conversation still removes its texts.
  assert.throws(() => db.prepare('INSERT INTO phone_threads (a_id, b_id) VALUES (1, 2)').run());
  db.prepare("INSERT INTO phone_threads (is_group, title) VALUES (1, 'crew')").run();
  db.prepare("INSERT INTO phone_threads (is_group, title) VALUES (1, 'crew 2')").run();
  db.prepare('DELETE FROM phone_threads WHERE id = 2').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM phone_messages').get().n, 2);
  db.close();
});
