import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDb, SCHEMA } from '../server/db.js';

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
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 12);
  const row = db.prepare("SELECT * FROM users WHERE username = 'old'").get();
  assert.equal(row.profile, '{}');
  assert.equal(row.banner, null);
  assert.equal(db.prepare('SELECT kind FROM channels').get().kind, 'ooc');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 1);
  db.prepare("INSERT INTO notifications (user_id, type) VALUES (1, 'follow')").run();
  db.close();
});
