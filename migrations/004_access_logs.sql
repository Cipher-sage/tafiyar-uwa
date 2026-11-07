ALTER TABLE access_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'online'
  CHECK (source IN ('online', 'offline'));
ALTER TABLE access_logs ADD COLUMN event_id TEXT;
ALTER TABLE access_logs ADD COLUMN received_at TEXT;
CREATE UNIQUE INDEX idx_access_logs_event ON access_logs(event_id);
CREATE INDEX idx_access_logs_received ON access_logs(id DESC);

PRAGMA user_version = 4;
