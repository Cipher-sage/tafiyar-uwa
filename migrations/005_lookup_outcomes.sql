-- A well-formed lookup can be denied even when no mother has that ID.
CREATE TABLE access_logs_new (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  mother_id INTEGER REFERENCES mothers(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 3),
  accessed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'offline')),
  event_id TEXT UNIQUE,
  received_at TEXT,
  attempted_maternal_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'opened' CHECK (outcome IN ('opened', 'denied')),
  staff_role TEXT,
  staff_facility_id INTEGER REFERENCES facilities(id),
  provider_version INTEGER,
  original_lookup_id INTEGER REFERENCES access_logs_new(id),
  CHECK (mother_id IS NOT NULL OR (outcome = 'denied' AND attempted_maternal_id IS NOT NULL))
);

INSERT INTO access_logs_new
  (id, user_id, mother_id, reason, accessed_at, source, event_id, received_at, staff_role, staff_facility_id)
SELECT l.id, l.user_id, l.mother_id, l.reason, l.accessed_at, l.source, l.event_id, l.received_at, u.role, u.facility_id
FROM access_logs l JOIN users u ON u.id = l.user_id;
DROP TABLE access_logs;
ALTER TABLE access_logs_new RENAME TO access_logs;
CREATE INDEX idx_access_logs_mother_time ON access_logs(mother_id, accessed_at);

PRAGMA user_version = 5;
