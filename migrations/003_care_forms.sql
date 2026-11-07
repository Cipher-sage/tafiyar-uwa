ALTER TABLE mothers ADD COLUMN registered_by INTEGER REFERENCES users(id);
ALTER TABLE mothers ADD COLUMN request_key TEXT;
ALTER TABLE mothers ADD COLUMN registration_digest TEXT;
CREATE UNIQUE INDEX idx_mothers_registration_request ON mothers(registered_by, request_key);

ALTER TABLE visits ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX idx_visits_request ON visits(recorded_by, request_key);

PRAGMA user_version = 3;
