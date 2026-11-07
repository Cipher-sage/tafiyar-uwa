-- Only the original demo identifiers belong to this rename. A conflicting
-- custom account keeps its address and the original account keeps its old one.
WITH demo(id, old_email, new_email) AS (
  VALUES (1, 'admin@nextkind.test', 'admin@tafiyaruwa.test'),
         (2, 'worker@nextkind.test', 'worker@tafiyaruwa.test'),
         (3, 'provider@nextkind.test', 'provider@tafiyaruwa.test'),
         (4, 'worker2@nextkind.test', 'worker2@tafiyaruwa.test')
)
UPDATE OR IGNORE users SET email = demo.new_email
FROM demo WHERE users.id = demo.id AND users.email = demo.old_email;

PRAGMA user_version = 2;
