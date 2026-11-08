import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openDatabase, migrate, ensureMigrated } from '../src/db.js';
import { generateSeedSecrets, generateSeedSettings, seedDatabase, seedSecretsFromEnv } from '../src/seed.js';
import { hashSecret, verifySecret, signSession, verifySession } from '../src/crypto.js';
import { LoginThrottle } from '../src/auth.js';

const db = openDatabase(':memory:');
const credentials = generateSeedSecrets();

before(async () => { migrate(db); await seedDatabase(db, credentials); });
after(() => db.close());

test('migration creates exactly the six requested business tables and is repeatable', () => {
  migrate(db);
  ensureMigrated(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
  assert.deepEqual(tables.map(row => row.name), ['access_logs', 'facilities', 'mothers', 'sms_outbox', 'users', 'visits']);
});

test('normal startup upgrades original staff names while preserving records and credentials', async () => {
  const original = openDatabase(':memory:');
  try {
    original.exec(readFileSync('migrations/001_initial.sql', 'utf8'));
    await seedDatabase(original, credentials);
    original.exec("UPDATE users SET email = replace(email, '@tafiyaruwa.test', '@nextkind.test'); PRAGMA user_version = 1;");
    const before = original.prepare('SELECT * FROM users ORDER BY id').all();
    const mothersBefore = original.prepare('SELECT * FROM mothers ORDER BY id').all();
    ensureMigrated(original);
    const after = original.prepare('SELECT * FROM users ORDER BY id').all();
    assert.deepEqual(after.map(row => ({ ...row })), before.map(row => ({ ...row, email: String(row.email).replace('@nextkind.test', '@tafiyaruwa.test') })));
    const upgradedMothers = original.prepare('SELECT * FROM mothers ORDER BY id').all();
    assert.deepEqual(upgradedMothers.map(({ registered_by, request_key, registration_digest, ...legacy }) => legacy),
      mothersBefore.map(row => ({ ...row })));
    assert.equal((original.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 6);
    ensureMigrated(original);
    assert.deepEqual(original.prepare('SELECT * FROM users ORDER BY id').all(), after);
  } finally { original.close(); }
});

test('staff rename preserves custom contacts and conflicting accounts', async () => {
  const original = openDatabase(':memory:');
  try {
    original.exec(readFileSync('migrations/001_initial.sql', 'utf8'));
    await seedDatabase(original, credentials);
    original.exec("UPDATE users SET email = replace(email, '@tafiyaruwa.test', '@nextkind.test'); PRAGMA user_version = 1;");
    original.prepare('UPDATE users SET email = ? WHERE id = 3').run('personal@example.test');
    original.prepare(`INSERT INTO users(id, role, name, email, password_hash, facility_id)
      SELECT 99, 'health_worker', 'Custom Demonstration Account', 'worker@tafiyaruwa.test', password_hash, 2
      FROM users WHERE id = 4`).run();
    ensureMigrated(original);
    const email = (id: number) => original.prepare('SELECT email FROM users WHERE id = ?').get(id)?.email;
    assert.equal(email(1), 'admin@tafiyaruwa.test');
    assert.equal(email(2), 'worker@nextkind.test');
    assert.equal(email(3), 'personal@example.test');
    assert.equal(email(4), 'worker2@tafiyaruwa.test');
    assert.equal(email(99), 'worker@tafiyaruwa.test');
  } finally { original.close(); }
});

test('seed is idempotent and preserves existing account credentials', async () => {
  const before = db.prepare('SELECT password_hash FROM users ORDER BY id').all();
  const pinsBefore = db.prepare('SELECT pin_hash, session_version FROM mothers ORDER BY id').all();
  await seedDatabase(db, credentials);
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  assert.equal(count('facilities'), 3);
  assert.equal(count('mothers'), 5);
  assert.ok(count('users') >= 3);
  assert.ok(JSON.stringify(before) === JSON.stringify(db.prepare('SELECT password_hash FROM users ORDER BY id').all()), 'idempotent seeding does not replace credential hashes');
  assert.deepEqual(db.prepare('SELECT pin_hash, session_version FROM mothers ORDER BY id').all(), pinsBefore);
});

test('setup fills missing per-account credentials while preserving existing values', () => {
  const settings = generateSeedSettings({ SEED_MOTHER_PIN: credentials.motherPins[0], SEED_WORKER_PASSWORD: credentials.workerPassword });
  const upgraded = seedSecretsFromEnv(settings);
  assert.equal(upgraded.motherPins[0], credentials.motherPins[0]);
  assert.equal(new Set(upgraded.motherPins).size, 5);
  assert.equal(upgraded.workerPassword, credentials.workerPassword);
  assert.notEqual(upgraded.worker2Password, credentials.workerPassword);
  assert.deepEqual(generateSeedSettings(settings), settings);
  assert.throws(() => seedSecretsFromEnv({ ...settings, SEED_MOTHER_B_PIN: settings.SEED_MOTHER_PIN }), /own credential/);
});

test('seeding replaces legacy shared credentials, revokes those sessions and preserves changed PINs', async () => {
  const migratedDb = openDatabase(':memory:');
  try {
    migrate(migratedDb);
    await seedDatabase(migratedDb, credentials);
    migratedDb.exec('UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE id=2) WHERE id=4');
    migratedDb.exec('UPDATE mothers SET pin_hash = (SELECT pin_hash FROM mothers WHERE id=1) WHERE id IN (2, 4, 5)');
    const personalHash = await hashSecret(generateSeedSecrets().motherPins[2]!);
    migratedDb.prepare('UPDATE mothers SET pin_hash = ? WHERE id = 3').run(personalHash);
    await seedDatabase(migratedDb, credentials);
    const rows = migratedDb.prepare('SELECT pin_hash, session_version FROM mothers ORDER BY id').all() as { pin_hash: string; session_version: number }[];
    assert.deepEqual(rows.map(row => row.session_version), [0, 1, 0, 1, 1]);
    assert.equal(rows[2]!.pin_hash, personalHash);
    for (const i of [1, 3, 4]) {
      assert.ok(await verifySecret(credentials.motherPins[i]!, rows[i]!.pin_hash));
      assert.equal(await verifySecret(credentials.motherPins[0]!, rows[i]!.pin_hash), false);
    }
    const worker = migratedDb.prepare('SELECT password_hash, session_version FROM users WHERE id = 4').get() as {password_hash: string; session_version: number};
    assert.equal(worker.session_version, 1);
    assert.ok(await verifySecret(credentials.worker2Password, worker.password_hash));
    assert.equal(await verifySecret(credentials.workerPassword, worker.password_hash), false);
  } finally { migratedDb.close(); }
});

test('database stores salted credential hashes rather than passwords or PINs', async () => {
  const users = db.prepare('SELECT email, password_hash FROM users').all() as { email: string; password_hash: string }[];
  const mothers = db.prepare('SELECT pin_hash FROM mothers ORDER BY id').all() as { pin_hash: string }[];
  for (const row of users) {
    assert.ok(row.password_hash.startsWith('scrypt$'), 'staff passwords are hashed');
    for (const secret of Object.values(credentials).flat()) assert.ok(!row.password_hash.includes(secret), 'staff hash contains no raw credential');
  }
  for (const [i, row] of mothers.entries()) {
    assert.ok(row.pin_hash.startsWith('scrypt$'), 'mother PINs are hashed');
    assert.ok(await verifySecret(credentials.motherPins[i]!, row.pin_hash), 'individual PIN verifies for the intended account');
  }
  assert.equal(new Set(mothers.map(row => row.pin_hash)).size, mothers.length, 'each mother PIN receives an independent salt');
  const admin = users.find(row => row.email === 'admin@tafiyaruwa.test')!;
  assert.ok(await verifySecret(credentials.adminPassword, admin.password_hash), 'seed password hash verifies');
});

test('schema prevents orphan visits, duplicate maternal IDs and invalid staff roles', () => {
  assert.throws(() => db.prepare('INSERT INTO visits (mother_id, facility_id, visit_date, recorded_by) VALUES (?, ?, ?, ?)').run(1, 99999, '2026-11-07', 1), /FOREIGN KEY/i);
  assert.throws(() => db.prepare('UPDATE mothers SET maternal_id = ? WHERE maternal_id = ?').run('MC-7KQ4XM', 'MC-8RZ5TN'), /UNIQUE/i);
  assert.throws(() => db.prepare('UPDATE users SET role = ? WHERE id = 1').run('superuser'), /CHECK/i);
  assert.throws(() => db.prepare('INSERT INTO access_logs (user_id, mother_id, reason, accessed_at) VALUES (?, ?, ?, ?)').run(1, 1, '', '2026-11-07T10:00:00Z'), /CHECK/i);
});

test('password and PIN hashing rejects incorrect values and malformed hashes', async () => {
  const secret = randomBytes(24).toString('hex');
  const wrong = randomBytes(24).toString('hex');
  const first = await hashSecret(secret);
  const second = await hashSecret(secret);
  assert.ok(first !== second, 'random salt changes each hash');
  assert.ok(await verifySecret(secret, first));
  assert.ok(!(await verifySecret(wrong, first)));
  assert.ok(!(await verifySecret(secret, 'malformed')));
});

test('session verification rejects wrong signing keys, invalid claim types and expired tokens', () => {
  const secret = randomBytes(48).toString('hex');
  const claims = { type: 'mother' as const, id: 1, version: 0, expires: Math.floor(Date.now() / 1000) + 100, nonce: randomBytes(16).toString('hex') };
  const token = signSession(claims, secret);
  assert.ok(verifySession(token, secret));
  assert.equal(verifySession(token, randomBytes(48).toString('hex')), null);
  assert.equal(verifySession(signSession({ ...claims, id: -1 }, secret), secret), null);
  assert.equal(verifySession(signSession({ ...claims, version: -1 }, secret), secret), null);
  assert.equal(verifySession(signSession({ ...claims, nonce: '' }, secret), secret), null);
  assert.equal(verifySession(signSession({ ...claims, expires: 1 }, secret), secret), null);
  assert.equal(verifySession('x'.repeat(2000), secret), null);
});

test('login throttling limits attempts and releases the limit after the window', () => {
  const throttle = new LoginThrottle(2, 100);
  assert.equal(throttle.allow('fictional-client', 1000), true);
  assert.equal(throttle.allow('fictional-client', 1001), true);
  assert.equal(throttle.allow('fictional-client', 1002), false);
  assert.equal(throttle.allow('fictional-client', 1101), true);
});
