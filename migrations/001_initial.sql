PRAGMA foreign_keys = ON;

CREATE TABLE facilities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'health_worker', 'provider')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  session_version INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mothers (
  id INTEGER PRIMARY KEY,
  maternal_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age BETWEEN 0 AND 120),
  phone TEXT,
  pin_hash TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'ha')),
  expected_delivery_date TEXT,
  registered_facility_id INTEGER NOT NULL REFERENCES facilities(id),
  consent_to_share INTEGER NOT NULL DEFAULT 0 CHECK (consent_to_share IN (0, 1)),
  session_version INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES mothers(id),
  facility_id INTEGER NOT NULL REFERENCES facilities(id),
  visit_date TEXT NOT NULL,
  weeks_pregnant REAL CHECK (weeks_pregnant >= 0),
  blood_pressure TEXT,
  weight REAL CHECK (weight > 0),
  notes TEXT NOT NULL DEFAULT '',
  next_appointment TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id)
);

CREATE TABLE access_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  mother_id INTEGER NOT NULL REFERENCES mothers(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  accessed_at TEXT NOT NULL
);

CREATE TABLE sms_outbox (
  id INTEGER PRIMARY KEY,
  mother_id INTEGER NOT NULL REFERENCES mothers(id),
  message_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_users_facility ON users(facility_id);
CREATE INDEX idx_mothers_facility ON mothers(registered_facility_id);
CREATE INDEX idx_visits_mother_date ON visits(mother_id, visit_date);
CREATE INDEX idx_access_logs_mother_time ON access_logs(mother_id, accessed_at);
CREATE INDEX idx_sms_outbox_mother ON sms_outbox(mother_id);

PRAGMA user_version = 1;
