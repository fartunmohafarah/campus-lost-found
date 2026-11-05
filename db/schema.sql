PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student','officer','admin')),
  department    TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  category_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  category_name TEXT NOT NULL UNIQUE,
  description   TEXT
);

CREATE TABLE IF NOT EXISTS locations (
  location_id INTEGER PRIMARY KEY AUTOINCREMENT,
  building    TEXT NOT NULL,
  floor       TEXT,
  area_name   TEXT NOT NULL,
  UNIQUE (building, floor, area_name)
);

CREATE TABLE IF NOT EXISTS items (
  item_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  reference    TEXT NOT NULL UNIQUE,
  report_type  TEXT NOT NULL CHECK (report_type IN ('lost','found')),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  category_id  INTEGER NOT NULL REFERENCES categories(category_id),
  location_id  INTEGER NOT NULL REFERENCES locations(location_id),
  report_date  TEXT NOT NULL,
  custody      TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claim_pending','returned','closed')),
  created_by   INTEGER NOT NULL REFERENCES users(user_id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_filter ON items (report_type, status, category_id, location_id, report_date);

CREATE TABLE IF NOT EXISTS item_images (
  image_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id      INTEGER NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  storage_key  TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
  claim_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id            INTEGER NOT NULL REFERENCES items(item_id),
  claimant_id        INTEGER NOT NULL REFERENCES users(user_id),
  claim_description  TEXT NOT NULL,
  evidence_reference TEXT,
  evidence_mime      TEXT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','more_info','approved','rejected','completed')),
  officer_note       TEXT,
  reviewed_by        INTEGER REFERENCES users(user_id),
  reviewed_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS handover_records (
  handover_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id        INTEGER NOT NULL REFERENCES items(item_id),
  claim_id       INTEGER NOT NULL REFERENCES claims(claim_id),
  handed_over_by INTEGER NOT NULL REFERENCES users(user_id),
  received_by    TEXT NOT NULL,
  handover_time  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(user_id),
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   INTEGER,
  detail      TEXT,
  timestamp   TEXT NOT NULL
);
