import { randomInt } from 'node:crypto';
import { demoStaff as staff } from './demo-staff.js';
import type { Database } from './db.js';
import { hashSecret, verifySecret } from './crypto.js';

const pinKeys = ['SEED_MOTHER_PIN', 'SEED_MOTHER_B_PIN', 'SEED_MOTHER_C_PIN', 'SEED_MOTHER_D_PIN', 'SEED_MOTHER_E_PIN'] as const;
const passwordKeys = ['SEED_ADMIN_PASSWORD', 'SEED_WORKER_PASSWORD', 'SEED_WORKER2_PASSWORD', 'SEED_PROVIDER_PASSWORD'] as const;

export interface SeedSecrets {
  adminPassword: string;
  workerPassword: string;
  worker2Password: string;
  providerPassword: string;
  motherPins: string[];
}

// Existing local settings take priority when upgrading an earlier demo.
export function generateSeedSettings(existing: NodeJS.ProcessEnv = {}): Record<string, string> {
  const settings: Record<string, string> = {};
  const keys = [...passwordKeys, ...pinKeys];
  const usedPins = new Set(keys.map(key => existing[key]).filter(pin => pin && /^\d{4}$/.test(pin)));
  for (const key of keys) {
    let pin = existing[key];
    if (!pin || !/^\d{4}$/.test(pin)) {
      do { pin = String(randomInt(10_000)).padStart(4, '0'); } while (usedPins.has(pin));
      usedPins.add(pin);
    }
    settings[key] = pin;
  }
  return settings;
}

export function seedSecretsFromEnv(env: NodeJS.ProcessEnv = process.env): SeedSecrets {
  const passwords = passwordKeys.map(key => env[key] ?? '');
  const motherPins = pinKeys.map(key => env[key] ?? '');
  const all = [...passwords, ...motherPins];
  if (all.some(pin => !/^\d{4}$/.test(pin))) {
    throw new Error('Demo accounts require four-digit PINs. Run npm run setup.');
  }
  if (new Set(all).size !== all.length) {
    throw new Error('Each demo account needs its own credential. Check the local seed settings.');
  }
  const secrets = {
    adminPassword: env.SEED_ADMIN_PASSWORD!,
    workerPassword: env.SEED_WORKER_PASSWORD!,
    worker2Password: env.SEED_WORKER2_PASSWORD!,
    providerPassword: env.SEED_PROVIDER_PASSWORD!,
    motherPins,
  };
  return secrets;
}

export function generateSeedSecrets(): SeedSecrets {
  return seedSecretsFromEnv(generateSeedSettings());
}

const mothers = [
    ['MC-7KQ4XM', 'Demo Mother A', 26, 'ha', '2027-02-15', 1, 1],
    ['MC-8RZ5TN', 'Demo Mother B', 30, 'en', '2027-03-02', 1, 1],
    ['MC-6VP9KD', 'Demo Mother C', 23, 'ha', '2027-01-20', 2, 1],
    ['MC-3HW7SC', 'Demo Mother D', 28, 'en', '2027-04-10', 2, 0],
    ['MC-9BX2RA', 'Demo Mother E', 32, 'ha', '2027-02-28', 1, 1],
  ] as const;
interface DemoHashes { staff: string[]; mothers: string[]; registered?: Record<string, string>; pinFormat?: number }
function validateHashes(hashes: DemoHashes) {
  const validHashes = (values: unknown, count: number) => Array.isArray(values) && values.length === count &&
    values.every(value => typeof value === 'string' && /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value));
  if (!hashes || !validHashes(hashes.staff, staff.length) || !validHashes(hashes.mothers, mothers.length)) {
    throw new Error('Invalid demo credential hashes.');
  }
  for (const [id, hash] of Object.entries(hashes.registered ?? {})) {
    if (!/^MC-[A-HJ-NP-Z2-9]{6}$/.test(id) || !validHashes([hash], 1)) throw new Error('Invalid registered demo PIN hash.');
  }
}

export async function demoHashes(secrets: SeedSecrets, registeredJson = '{}'): Promise<DemoHashes> {
  const extras: unknown = JSON.parse(registeredJson);
  if (!extras || typeof extras !== 'object' || Array.isArray(extras)) throw new Error('Invalid registered demo PIN list.');
  const registered: Record<string, string> = {};
  for (const [id, pin] of Object.entries(extras)) {
    if (!/^MC-[A-HJ-NP-Z2-9]{6}$/.test(id) || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw new Error('Invalid registered demo PIN.');
    registered[id] = await hashSecret(pin);
  }
  const passwords = [secrets.adminPassword, secrets.workerPassword, secrets.providerPassword, secrets.worker2Password];
  return { pinFormat: 4, staff: await Promise.all(passwords.map(hashSecret)), mothers: await Promise.all(secrets.motherPins.map(hashSecret)), registered };
}

// Call inside a transaction, only on an intentional credential reset.
export function resetDemoPins(db: Database, hashes: DemoHashes) {
  validateHashes(hashes);
  const staffPin = db.prepare(`UPDATE users SET password_hash=?, session_version=session_version+1, failed_attempts=0, locked_until=0
    WHERE id=? AND role=? AND email=? AND facility_id=?`);
  staff.forEach(([id, role, , email, facility], i) => staffPin.run(hashes.staff[i]!, id, role, email, facility));
  const motherPin = db.prepare(`UPDATE mothers SET pin_hash=?, session_version=session_version+1, failed_attempts=0, locked_until=0
    WHERE id=? AND maternal_id=?`);
  mothers.forEach(([id], i) => motherPin.run(hashes.mothers[i]!, i+1, id));
  const registeredPin = db.prepare(`UPDATE mothers SET pin_hash=?, session_version=session_version+1, failed_attempts=0, locked_until=0
    WHERE maternal_id=? AND registered_by IS NOT NULL`);
  for (const [id, hash] of Object.entries(hashes.registered ?? {})) registeredPin.run(hash, id);
}

// Both runtimes call this inside their own database transaction.
export function seedFromHashes(db: Database, hashes: DemoHashes) {
  validateHashes(hashes);
  const facility = db.prepare('INSERT INTO facilities(id, name, state) VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
  facility.run(1, 'Gombe Community Health Centre (Demo)', 'Gombe');
  facility.run(2, 'Gombe Riverside Health Centre (Demo)', 'Gombe');
  facility.run(3, 'Gombe Referral Hospital (Demo)', 'Gombe');
  const user = db.prepare(`INSERT INTO users(id, role, name, email, password_hash, facility_id)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
  staff.forEach(([id, role, name, email, facilityId], i) => user.run(id, role, name, email, hashes.staff[i]!, facilityId));
  const mother = db.prepare(`INSERT INTO mothers(id, maternal_id, name, age, pin_hash, language,
    expected_delivery_date, registered_facility_id, consent_to_share) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING`);
  mothers.forEach((row, i) => mother.run(i + 1, row[0], row[1], row[2], hashes.mothers[i]!, row[3], row[4], row[5], row[6]));
}

export async function seedDatabase(db: Database, secrets: SeedSecrets): Promise<void> {
  const passwords = [secrets.adminPassword, secrets.workerPassword, secrets.providerPassword, secrets.worker2Password];
  const staffHashes = await Promise.all(passwords.map(hashSecret));
  const pinHashes = await Promise.all(secrets.motherPins.map(hashSecret));
  // Upgrade only known seed rows that still verify against the legacy shared credential.
  // Compare the same stored hash again at write time to preserve concurrent changes.
  const priorWorker = db.prepare('SELECT password_hash FROM users WHERE id = 4 AND email = ?')
    .get(staff[3][3]) as { password_hash: string } | undefined;
  const sharedWorkerHash = priorWorker && await verifySecret(secrets.workerPassword, priorWorker.password_hash)
    ? priorWorker.password_hash : null;
  const readMother = db.prepare('SELECT pin_hash FROM mothers WHERE id = ? AND maternal_id = ?');
  const sharedMotherHashes = await Promise.all(mothers.map(async (row, i) => {
    if (i === 0) return null;
    const existing = readMother.get(i + 1, row[0]) as { pin_hash: string } | undefined;
    return existing && await verifySecret(secrets.motherPins[0]!, existing.pin_hash) ? existing.pin_hash : null;
  }));
  db.exec('BEGIN IMMEDIATE');
  try {
    seedFromHashes(db, { staff: staffHashes, mothers: pinHashes });
    if (sharedWorkerHash) {
      db.prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1
        WHERE id = 4 AND email = ? AND password_hash = ?`).run(staffHashes[3]!, staff[3][3], sharedWorkerHash);
    }
    const rotatePin = db.prepare(`UPDATE mothers SET pin_hash = ?, session_version = session_version + 1
      WHERE id = ? AND maternal_id = ? AND pin_hash = ?`);
    sharedMotherHashes.forEach((previous, i) => {
      if (previous) rotatePin.run(pinHashes[i]!, i + 1, mothers[i]![0], previous);
    });
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
