import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Principal } from '../src/auth.js';
import { todayInGombe } from '../src/care.js';
import { migrate, openDatabase } from '../src/db.js';
import { generateSeedSecrets, seedDatabase } from '../src/seed.js';
import { listReminderOutbox, queueReminder, ReminderError } from '../src/reminders.js';

const db = openDatabase(':memory:');
const credentials = generateSeedSecrets();
const worker: Principal = {
  id: 2, type: 'staff', role: 'health_worker', name: 'Demo worker', facilityId: 1,
  facilityName: 'Demo health centre', version: 0,
};
const worker2: Principal = { ...worker, id: 4, facilityId: 2 };
const admin: Principal = { ...worker, id: 1, role: 'admin', facilityId: 3 };
const provider: Principal = { ...worker, id: 3, role: 'provider', facilityId: 3 };
const mother: Principal = { ...worker, id: 1, role: 'mother', type: 'mother' };
const idA = 'MC-7KQ4XM';
const idB = 'MC-8RZ5TN';
const idC = 'MC-6VP9KD';
const today = todayInGombe();
const tomorrow = todayInGombe(new Date(Date.now() + 86400000));
const yesterday = todayInGombe(new Date(Date.now() - 86400000));

before(async () => { migrate(db); await seedDatabase(db, credentials); });
after(() => db.close());

function appointment(motherId: number, date: string | null, facilityId = 1) {
  db.prepare('INSERT INTO visits(mother_id, facility_id, visit_date, next_appointment, recorded_by) VALUES (?, ?, ?, ?, ?)')
    .run(motherId, facilityId, today, date, facilityId === 1 ? 2 : 4);
}
function error(code: ReminderError['code'], status: number) {
  return (caught: unknown) => caught instanceof ReminderError && caught.code === code && caught.status === status;
}

test('reminders use the stored language and a neutral date-only message; retries create one outbox entry', () => {
  appointment(1, tomorrow);
  appointment(2, today);
  const key = randomUUID();
  const first = queueReminder(db, worker, ' mc-7kq4xm ', key);
  const retry = queueReminder(db, worker, idA, key.toUpperCase());
  const english = queueReminder(db, worker, idB, randomUUID());
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.entry, first.entry);
  assert.equal(first.entry.language, 'ha');
  assert.equal(first.entry.appointmentDate, tomorrow);
  assert.equal(english.entry.language, 'en');
  assert.notEqual(first.entry.message, english.entry.message);
  assert.equal(first.entry.status, 'simulation');
  for (const row of [first.entry, english.entry]) {
    assert.ok(!row.message.includes(row.maternalId));
    assert.ok(!row.message.includes(row.motherName));
    assert.ok(!row.message.includes(row.facilityName!));
    assert.doesNotMatch(row.message, /pregnan|antenatal|ciki/i);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sms_outbox WHERE request_key = ?').get(key)!.n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE mother_id = 1').get()!.n, 2);
});

test('only a current health worker at the registering clinic can queue a reminder', () => {
  for (const user of [worker2, admin, provider, mother, { ...worker, version: 1 }]) {
    const expected = user === worker2 ? error('unavailable', 404) : error('forbidden', 403);
    assert.throws(() => queueReminder(db, user, idA, randomUUID()), expected);
  }
  assert.throws(() => queueReminder(db, worker, idA, ''), error('invalidRequest', 422));
  assert.throws(() => queueReminder(db, worker, 'MC-ZZZZZZ', randomUUID()), error('unavailable', 404));
  for (const user of [provider, mother, { ...worker, version: 1 }]) {
    assert.throws(() => listReminderOutbox(db, user), error('forbidden', 403));
  }
});

test('the latest visit controls reminder eligibility and a retry preserves its original contents', () => {
  const key = randomUUID();
  const original = queueReminder(db, worker, idA, key);
  appointment(1, null);
  assert.throws(() => queueReminder(db, worker, idA, randomUUID()), error('noAppointment', 422));
  assert.deepEqual(queueReminder(db, worker, idA, key).entry, original.entry);
  assert.throws(() => queueReminder(db, worker, idB, key), error('conflict', 409));
  appointment(1, yesterday);
  assert.throws(() => queueReminder(db, worker, idA, randomUUID()), error('pastAppointment', 422));
  appointment(1, today);
  assert.equal(queueReminder(db, worker, idA, randomUUID()).entry.appointmentDate, today);
});

test('an audit failure rolls back the simulated message', () => {
  const key = randomUUID();
  db.exec("CREATE TRIGGER fail_reminder_audit BEFORE INSERT ON access_logs BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;");
  try {
    assert.throws(() => queueReminder(db, worker, idA, key), /audit unavailable/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sms_outbox WHERE request_key = ?').get(key)!.n, 0);
  } finally { db.exec('DROP TRIGGER fail_reminder_audit'); }
});

test('workers see only their clinic outbox while administrators can page through all entries', () => {
  appointment(3, tomorrow, 2);
  const remote = queueReminder(db, worker2, idC, randomUUID());
  for (let i = 0; i < 26; i++) queueReminder(db, worker, idB, randomUUID());
  const local = listReminderOutbox(db, worker);
  const other = listReminderOutbox(db, worker2);
  const first = listReminderOutbox(db, admin);
  const last = listReminderOutbox(db, admin, 1000);
  assert.equal(other.entries.length, 1);
  assert.equal(other.entries[0]!.id, remote.entry.id);
  assert.ok(local.entries.every(entry => entry.maternalId !== idC));
  assert.equal(local.hasNext, true);
  assert.ok(first.entries[0]!.id > last.entries[0]!.id);
  assert.equal(first.entries.length + last.entries.length, first.total);
  assert.equal(first.total, local.total + other.total);
});

test('upgrading preserves legacy outbox content and keeps unknown sending-clinic provenance admin-only', async () => {
  const legacy = openDatabase(':memory:');
  try {
    for (const migration of ['001_initial', '002_rename_demo_staff', '003_care_forms', '004_access_logs', '005_lookup_outcomes']) {
      legacy.exec(readFileSync('migrations/' + migration + '.sql', 'utf8'));
    }
    await seedDatabase(legacy, credentials);
    legacy.prepare('INSERT INTO sms_outbox(id, mother_id, message_text, created_at) VALUES (17, 1, ?, ?)')
      .run('Fictional existing reminder', '2026-11-01T10:00:00.000Z');
    migrate(legacy);
    migrate(legacy);
    assert.equal(listReminderOutbox(legacy, worker).entries.length, 0);
    const entry = listReminderOutbox(legacy, admin).entries[0]!;
    assert.equal(entry.id, 17);
    assert.equal(entry.message, 'Fictional existing reminder');
    assert.equal(entry.createdAt, '2026-11-01T10:00:00.000Z');
    assert.equal(entry.staffName, null);
    assert.equal(entry.facilityName, null);
    assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { legacy.close(); }
});
