import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbFilePath = path.resolve(process.cwd(), 'tmp', 'block-coding-puzzles.db');
fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

const db = new Database(dbFilePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  puzzle_id TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (puzzle_id) REFERENCES puzzles(id)
);

CREATE TABLE IF NOT EXISTS puzzles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  concept TEXT,
  story TEXT,
  goal TEXT,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  puzzle_id TEXT NOT NULL,
  success INTEGER,
  failure_reason TEXT,
  code TEXT,
  speed TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (puzzle_id) REFERENCES puzzles(id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER,
  session_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL,
  session_id INTEGER NOT NULL,
  step_index INTEGER NOT NULL,
  tile_index INTEGER,
  x REAL,
  y REAL,
  action TEXT,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS puzzle_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  puzzle_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked',
  completed_at TEXT,
  UNIQUE (user_id, puzzle_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (puzzle_id) REFERENCES puzzles(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_session ON attempts(session_id);
CREATE INDEX IF NOT EXISTS idx_events_attempt ON events(attempt_id);
CREATE INDEX IF NOT EXISTS idx_movements_attempt ON movements(attempt_id);
CREATE INDEX IF NOT EXISTS idx_puzzle_progress_user ON puzzle_progress(user_id);
`);

export type SQLiteDatabase = Database.Database;

export const connection = db;

export const prepare = (sql: string) => db.prepare(sql);
