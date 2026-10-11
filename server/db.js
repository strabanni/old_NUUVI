import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 3;

export const SCHEMA = `
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  avatar        TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  banned_at     TEXT,
  ban_reason    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Site-wide registration invites (the site is invite-only).
CREATE TABLE site_invites (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note       TEXT NOT NULL DEFAULT '',
  max_uses   INTEGER NOT NULL DEFAULT 1,
  uses       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE password_resets (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE uploads (
  name       TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  size       INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE characters (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  tagline    TEXT NOT NULL DEFAULT '',
  bio        TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#7c5cff',
  avatar     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stories (
  id               INTEGER PRIMARY KEY,
  owner_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  summary          TEXT NOT NULL DEFAULT '',
  genre            TEXT NOT NULL DEFAULT '',
  rating           TEXT NOT NULL DEFAULT 'T' CHECK (rating IN ('G', 'T', 'M')),
  content_warnings TEXT NOT NULL DEFAULT '',
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  color            TEXT NOT NULL DEFAULT '#7c5cff',
  icon             TEXT,
  invite_code      TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE story_members (
  story_id  INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'writer' CHECK (role IN ('owner', 'writer')),
  notify    TEXT NOT NULL DEFAULT 'all' CHECK (notify IN ('all', 'mentions', 'none')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (story_id, user_id)
);

-- Users removed from a story by its owner; they cannot rejoin.
CREATE TABLE story_bans (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (story_id, user_id)
);

-- Scenes / channels inside a story.
CREATE TABLE channels (
  id            INTEGER PRIMARY KEY,
  story_id      INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  topic         TEXT NOT NULL DEFAULT '',
  position      INTEGER NOT NULL DEFAULT 0,
  turns_enabled INTEGER NOT NULL DEFAULT 0,
  turn_order    TEXT NOT NULL DEFAULT '[]',
  turn_index    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE posts (
  id           INTEGER PRIMARY KEY,
  story_id     INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'ic' CHECK (kind IN ('ic', 'ooc', 'narration', 'roll')),
  body         TEXT NOT NULL,
  cw           TEXT NOT NULL DEFAULT '',
  roll         TEXT,
  word_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at    TEXT
);

CREATE TABLE channel_reads (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('post', 'mention', 'turn', 'report')),
  actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
  story_id   INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
  post_id    INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  text       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at    TEXT
);

CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE reports (
  id          INTEGER PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  post_id     INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  target_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  story_id    INTEGER REFERENCES stories(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  snapshot    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mod_log (
  id         INTEGER PRIMARY KEY,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX posts_channel_idx ON posts(channel_id, id);
CREATE INDEX posts_story_idx ON posts(story_id, id);
CREATE INDEX channels_story_idx ON channels(story_id, position);
CREATE INDEX characters_user_idx ON characters(user_id);
CREATE INDEX members_user_idx ON story_members(user_id);
CREATE INDEX notifications_user_idx ON notifications(user_id, id);
CREATE INDEX reports_status_idx ON reports(status, id);
`;

// Upgrades for databases created by earlier versions. Index i upgrades version i+1 → i+2.
const MIGRATIONS = [
  // v2: roleplay profile fields, banners, character details and portraits.
  `ALTER TABLE users ADD COLUMN profile TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE users ADD COLUMN banner TEXT;
   ALTER TABLE characters ADD COLUMN details TEXT NOT NULL DEFAULT '[]';
   ALTER TABLE characters ADD COLUMN portrait TEXT;
   ALTER TABLE stories ADD COLUMN banner TEXT;`,
  // v3: channels become typed threads (thread / comms / event / ooc), character follows,
  // tagged thread participants, and more notification types.
  `ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'thread';
   ALTER TABLE channels ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
   ALTER TABLE channels ADD COLUMN summary TEXT NOT NULL DEFAULT '';
   ALTER TABLE channels ADD COLUMN tags TEXT NOT NULL DEFAULT '';
   ALTER TABLE channels ADD COLUMN event_at TEXT;
   ALTER TABLE channels ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
   ALTER TABLE channels ADD COLUMN starter_character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL;
   ALTER TABLE channels ADD COLUMN last_post_at TEXT;
   UPDATE channels SET kind = 'ooc' WHERE name LIKE '%ooc%';
   UPDATE channels SET last_post_at = (SELECT MAX(created_at) FROM posts p WHERE p.channel_id = channels.id);
   UPDATE channels SET created_by = (SELECT owner_id FROM stories s WHERE s.id = channels.story_id);

   CREATE TABLE channel_characters (
     channel_id   INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
     character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
     PRIMARY KEY (channel_id, character_id)
   );
   INSERT OR IGNORE INTO channel_characters (channel_id, character_id)
     SELECT DISTINCT channel_id, character_id FROM posts WHERE character_id IS NOT NULL;

   CREATE TABLE character_follows (
     follower_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
     followed_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
     created_at  TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (follower_id, followed_id)
   );
   CREATE INDEX follows_followed_idx ON character_follows(followed_id);

   CREATE TABLE notifications_v3 (
     id         INTEGER PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     type       TEXT NOT NULL CHECK (type IN ('post', 'mention', 'turn', 'report', 'follow', 'tag')),
     actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
     story_id   INTEGER REFERENCES stories(id) ON DELETE CASCADE,
     channel_id INTEGER REFERENCES channels(id) ON DELETE CASCADE,
     post_id    INTEGER REFERENCES posts(id) ON DELETE SET NULL,
     character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
     count      INTEGER NOT NULL DEFAULT 1,
     text       TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     read_at    TEXT
   );
   INSERT INTO notifications_v3 (id, user_id, type, actor_id, story_id, channel_id, post_id, count, text, created_at, read_at)
     SELECT id, user_id, type, actor_id, story_id, channel_id, post_id, count, text, created_at, read_at FROM notifications;
   DROP TABLE notifications;
   ALTER TABLE notifications_v3 RENAME TO notifications;
   CREATE INDEX notifications_user_idx ON notifications(user_id, id);`,
];

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 0) {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'users'").get()) {
      throw new Error(`${path} was created by an early preview build of NUUVI. Delete it and restart to create a fresh database.`);
    }
    db.exec('BEGIN');
    db.exec(SCHEMA);
    for (const m of MIGRATIONS) db.exec(m);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } else if (version < SCHEMA_VERSION) {
    db.exec('BEGIN');
    for (let v = version; v < SCHEMA_VERSION; v++) db.exec(MIGRATIONS[v - 1]);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } else if (version > SCHEMA_VERSION) {
    throw new Error(`${path} was created by a newer version of NUUVI.`);
  }
  return db;
}

// Runs fn inside a transaction, rolling back on error.
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
