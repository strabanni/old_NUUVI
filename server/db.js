import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  tagline    TEXT NOT NULL DEFAULT '',
  bio        TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#7c5cff',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stories (
  id          INTEGER PRIMARY KEY,
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  genre       TEXT NOT NULL DEFAULT '',
  rating      TEXT NOT NULL DEFAULT 'T' CHECK (rating IN ('G', 'T', 'M')),
  visibility  TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  invite_code TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS story_members (
  story_id  INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'writer' CHECK (role IN ('owner', 'writer')),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (story_id, user_id)
);

CREATE TABLE IF NOT EXISTS posts (
  id           INTEGER PRIMARY KEY,
  story_id     INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL DEFAULT 'ic' CHECK (kind IN ('ic', 'ooc', 'narration')),
  body         TEXT NOT NULL,
  word_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  edited_at    TEXT
);

CREATE INDEX IF NOT EXISTS posts_story_idx ON posts(story_id, id);
CREATE INDEX IF NOT EXISTS characters_user_idx ON characters(user_id);
CREATE INDEX IF NOT EXISTS members_user_idx ON story_members(user_id);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
