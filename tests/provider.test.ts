import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Principal } from '../src/auth.js';
import { migrate, openDatabase } from '../src/db.js';
import { generateSeedSecrets, seedDatabase } from '../src/seed.js';
import { listAccessLogs, lookupProviderRecord, ProviderError, recordOfflineAccess, type OfflineAuditGrant } from '../src/provider.js';

const db = openDatabase(':memory:');
const provider: Principal = { id: 3, type: 'staff', role: 'provider', facilityId: 3, version: 0, name: 'Doctor', facilityName: 'Hospital' };
const admin: Principal = { ...provider, id: 1, role: 'admin' };
const maternalId = 'MC-7KQ4XM';
const reason = 'Review at referral hospital';

before(async () => {
  migrate(db);
  await seedDatabase(db, generateSeedSecrets());
  db.prepare('INSERT INTO visits(mother_id, facility_id, visit_date, notes, recorded_by) VALUES (1, 1, ?, ?, 2)')
    .run('2026-01-10', 'Fictional visit');
});
after(() => db.close());

function hasError(code: ProviderError['code'], status: number) {
  return (error: unknown) => error instanceof ProviderError && error.code === code && error.status === status;
}

test('provider opens a consented cross-facility record and every read is audited', () => {
  const first = lookupProviderRecord(db, provider, ' mc-7kq4xm ', ' ' + reason + ' ');
  const second = lookupProviderRecord(db, provider, maternalId, reason);
  assert.equal(first.mother.maternalId, maternalId);
  assert.equal(first.mother.registeredFacilityId, 1);
  assert.equal(first.visits[0]?.notes, 'Fictional visit');
  assert.equal(first.reason, reason);
  assert.notEqual(first.logId, second.logId);
  assert.ok(!JSON.stringify(first).includes('pin_hash'));
  const [entry] = listAccessLogs(db, admin).entries;
  assert.equal(entry!.id, second.logId);
  assert.equal(entry!.staffId, provider.id);
  assert.equal(entry!.motherName, first.mother.name);
  assert.equal(entry!.source, 'online');
  assert.equal(entry!.outcome, 'opened');
  assert.equal(entry!.accessedAt, second.openedAt);
  assert.equal(entry!.receivedAt, second.openedAt);
  assert.ok(!JSON.stringify(entry).includes('Fictional visit'));
});

test('denial does not disclose existence and both denied attempts reach the admin log', () => {
  for (const id of ['MC-3HW7SC', 'MC-AAAAAA']) {
    assert.throws(() => lookupProviderRecord(db, provider, id, reason), hasError('unavailable', 404));
  }
  const entries = listAccessLogs(db, admin).entries.slice(0, 2);
  assert.deepEqual(entries.map(e => [e.maternalId, e.outcome]), [['MC-AAAAAA', 'denied'], ['MC-3HW7SC', 'denied']]);
  assert.equal(entries[0]!.motherName, null);
});

test('invalid form inputs and unauthorized or stale principals cannot open records', () => {
  const beforeCount = listAccessLogs(db, admin).total;
  assert.throws(() => lookupProviderRecord(db, provider, 'MC-101O00', ' '), (error: unknown) => {
    assert.ok(error instanceof ProviderError);
    assert.deepEqual(error.fields, { maternalId: 'invalidMaternalId', reason: 'invalidReason' });
    return true;
  });
  assert.throws(() => lookupProviderRecord(db, provider, maternalId, 'x'.repeat(501)), hasError('validation', 422));
  for (const principal of [admin, { ...provider, type: 'mother' as const }, { ...provider, version: 1 }, { ...provider, facilityId: 1 }]) {
    assert.throws(() => lookupProviderRecord(db, principal, maternalId, reason), hasError('forbidden', 403));
  }
  assert.throws(() => listAccessLogs(db, provider), hasError('forbidden', 403));
  assert.throws(() => listAccessLogs(db, { ...admin, version: 1 }), hasError('forbidden', 403));
  assert.equal(listAccessLogs(db, admin).total, beforeCount);
});

test('a record cannot be returned when the audit write fails', () => {
  db.exec("CREATE TRIGGER reject_access BEFORE INSERT ON access_logs BEGIN SELECT RAISE(ABORT, 'audit failed'); END;");
  try {
    assert.throws(() => lookupProviderRecord(db, provider, maternalId, reason), /audit failed/);
  } finally { db.exec('DROP TRIGGER reject_access'); }
});

test('late offline receipt survives logout and consent changes, binds the original grant, and deduplicates retries', () => {
  const record = lookupProviderRecord(db, provider, maternalId, reason);
  const time = Date.now() - 7200000;
  const openedAt = new Date(time).toISOString();
  const viewedAt = new Date(time + 1000).toISOString();
  const expiresAt = new Date(time + 60000).toISOString();
  db.prepare('UPDATE access_logs SET accessed_at = ? WHERE id = ?').run(openedAt, record.logId);
  db.exec('UPDATE users SET session_version = 1, facility_id = 1 WHERE id = 3; UPDATE mothers SET consent_to_share = 0 WHERE id = 1');
  const grant: OfflineAuditGrant = { logId: record.logId, motherId: record.mother.id, providerId: 3, providerVersion: 0, facilityId: 3, reason, openedAt, expiresAt };
  try {
    const eventId = randomUUID();
    assert.equal(recordOfflineAccess(db, grant, eventId, viewedAt), true);
    assert.equal(recordOfflineAccess(db, grant, eventId.toUpperCase(), viewedAt), false);
    assert.throws(() => recordOfflineAccess(db, grant, eventId, openedAt), hasError('conflict', 409));
    for (const change of [{ providerVersion: 1 }, { providerId: 2 }, { facilityId: 2 }, { motherId: 2 }, { reason: 'Different reason' }, { logId: -1 }]) {
      assert.throws(() => recordOfflineAccess(db, { ...grant, ...change }, randomUUID(), viewedAt), hasError('invalidEvent', 422));
    }
    for (const invalidTime of [expiresAt, new Date(time - 1).toISOString(), 'invalid', null]) {
      assert.throws(() => recordOfflineAccess(db, grant, randomUUID(), invalidTime), hasError('invalidEvent', 422));
    }
    const later = { ...grant, expiresAt: new Date(Date.now() + 60000).toISOString() };
    assert.throws(() => recordOfflineAccess(db, later, randomUUID(), new Date(Date.now() + 10000).toISOString()), hasError('invalidEvent', 422));
    assert.throws(() => recordOfflineAccess(db, grant, 'bad-event', viewedAt), hasError('invalidEvent', 422));
    const [entry] = listAccessLogs(db, admin).entries;
    assert.equal(entry!.source, 'offline');
    assert.equal(entry!.outcome, 'opened');
    assert.equal(entry!.accessedAt, viewedAt);
    assert.ok(entry!.receivedAt > expiresAt);
    assert.match(entry!.facilityName, /Referral Hospital/);
  } finally {
    db.exec('UPDATE users SET session_version = 0, facility_id = 3 WHERE id = 3; UPDATE mothers SET consent_to_share = 1 WHERE id = 1');
  }
});

test('admin pages include historical staff access in descending receipt order', () => {
  const insert = db.prepare("INSERT INTO access_logs(user_id, mother_id, reason, accessed_at) VALUES (2, 1, 'Review registration', ?)");
  for (let i = 0; i < 50; i++) insert.run(new Date().toISOString());
  const first = listAccessLogs(db, admin, 'invalid');
  const last = listAccessLogs(db, admin, '900');
  assert.equal(first.entries.length, first.pageSize);
  assert.ok(first.hasNext && !first.hasPrevious);
  assert.equal(first.entries[0]!.staffRole, 'health_worker');
  assert.equal(first.entries[0]!.outcome, 'opened');
  assert.equal(last.page, 2);
  assert.ok(last.hasPrevious && !last.hasNext);
  assert.equal(first.entries.length + last.entries.length, first.total);
  assert.ok(first.entries.at(-1)!.id > last.entries[0]!.id);
});

test('upgrade preserves pre-existing online and offline audit timestamps and event IDs', async () => {
  const old = openDatabase(':memory:');
  try {
    for (const name of ['001_initial', '002_rename_demo_staff', '003_care_forms', '004_access_logs']) {
      old.exec(readFileSync('migrations/' + name + '.sql', 'utf8'));
    }
    await seedDatabase(old, generateSeedSecrets());
    const eventId = randomUUID();
    const at = '2026-11-01T10:00:00.000Z';
    const received = '2026-11-01T11:00:00.000Z';
    old.prepare('INSERT INTO access_logs(id, user_id, mother_id, reason, accessed_at, source, received_at, event_id) VALUES (7, 3, 1, ?, ?, ?, ?, ?)')
      .run(reason, at, 'offline', received, eventId);
    old.prepare('INSERT INTO access_logs(id, user_id, mother_id, reason, accessed_at) VALUES (8, 2, 1, ?, ?)').run('Clinic review', at);
    migrate(old);
    const [online, offline] = listAccessLogs(old, admin).entries;
    assert.equal(online!.receivedAt, at);
    assert.equal(offline!.receivedAt, received);
    assert.equal(offline!.source, 'offline');
    assert.equal(offline!.id, 7);
    assert.equal(old.prepare('SELECT event_id FROM access_logs WHERE id=7').get()!.event_id, eventId);
    assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { old.close(); }
});
