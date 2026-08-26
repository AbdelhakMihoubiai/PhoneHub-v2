import Database from "libsql";
import fs from "node:fs";
import path from "node:path";

/**
 * Database connection — dual mode:
 *
 *  - Turso (cloud): set TURSO_DATABASE_URL (libsql://…) and TURSO_AUTH_TOKEN.
 *    Used for hosting (Vercel etc.) — data persists in the cloud.
 *  - Local file: no env vars → data/phones.db (development).
 *
 * `libsql` is a drop-in replacement for better-sqlite3, so the rest of the
 * app (synchronous prepare/run/all/get calls) works identically in both modes.
 */

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

let db: Database.Database;

if (TURSO_URL) {
  // libsql accepts authToken at runtime; its TS types (copied from
  // better-sqlite3) don't declare it — hence the cast.
  db = new Database(TURSO_URL, { authToken: TURSO_TOKEN } as Database.Options);
} else {
  const DATA_DIR = path.join(process.cwd(), "data");
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(path.join(DATA_DIR, "phones.db"));
  db.pragma("journal_mode = WAL");
}

db.exec(`
CREATE TABLE IF NOT EXISTS phones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  image_url TEXT,
  release_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Requirement #15: universal flexible spec storage (EAV with JSON values)
CREATE TABLE IF NOT EXISTS fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
  field_path TEXT NOT NULL,
  value TEXT,                -- JSON encoded
  unit TEXT,
  status TEXT NOT NULL,      -- confidence enum
  source TEXT,
  source_url TEXT,
  retrieved_at TEXT NOT NULL,
  note TEXT,
  UNIQUE(phone_id, field_path)
);
CREATE INDEX IF NOT EXISTS idx_fields_phone ON fields(phone_id);

CREATE TABLE IF NOT EXISTS variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
  ram_gb INTEGER,
  storage_gb INTEGER,
  colors TEXT,               -- JSON array
  model_number TEXT,
  region TEXT
);

CREATE TABLE IF NOT EXISTS benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT,
  score REAL,
  config_json TEXT,
  test_date TEXT,
  status TEXT NOT NULL,
  source TEXT,
  source_url TEXT,
  retrieved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gaming_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
  game TEXT NOT NULL,
  avg_fps REAL,
  min_fps REAL,
  max_fps REAL,
  settings TEXT,
  resolution TEXT,
  temperature_c REAL,
  battery_drain TEXT,
  duration_min REAL,
  status TEXT NOT NULL,
  source TEXT,
  source_url TEXT,
  retrieved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
  variant TEXT,
  price REAL,
  currency TEXT,
  country TEXT,
  retailer TEXT,
  url TEXT,
  status TEXT NOT NULL,
  retrieved_at TEXT NOT NULL
);

-- Related media: news mentions, reviews, gallery images (requirement #3)
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,        -- news | review | gallery | model3d
  title TEXT NOT NULL,
  url TEXT,
  image_url TEXT,
  retrieved_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_phone ON media(phone_id);

-- Requirement #6: update history for refreshes
CREATE TABLE IF NOT EXISTS update_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,      -- field | benchmark | gaming | price
  key TEXT NOT NULL,         -- field path / benchmark name / etc.
  old_value TEXT,
  new_value TEXT,
  source TEXT,
  retrieved_at TEXT NOT NULL
);

-- Requirement #17: admin provider management
CREATE TABLE IF NOT EXISTS providers (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 100,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 20,
  api_key_env TEXT,          -- env var name only; secrets never stored in DB
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key TEXT NOT NULL,
  query TEXT,
  ok INTEGER NOT NULL,
  error TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_id INTEGER NOT NULL REFERENCES phones(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  key TEXT NOT NULL,
  value_a TEXT, source_a TEXT,
  value_b TEXT, source_b TEXT,
  resolved_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export default db;
