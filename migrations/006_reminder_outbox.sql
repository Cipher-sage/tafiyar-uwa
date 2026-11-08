ALTER TABLE sms_outbox ADD COLUMN facility_id INTEGER REFERENCES facilities(id);
ALTER TABLE sms_outbox ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE sms_outbox ADD COLUMN visit_id INTEGER REFERENCES visits(id);
ALTER TABLE sms_outbox ADD COLUMN request_key TEXT;
ALTER TABLE sms_outbox ADD COLUMN language TEXT CHECK (language IN ('en', 'ha'));
ALTER TABLE sms_outbox ADD COLUMN appointment_date TEXT;

CREATE UNIQUE INDEX idx_sms_outbox_request ON sms_outbox(user_id, request_key);
CREATE INDEX idx_sms_outbox_facility ON sms_outbox(facility_id, id);

PRAGMA user_version = 6;
