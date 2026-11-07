import { randomBytes, randomInt } from 'node:crypto';
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
  for (const key of passwordKeys) settings[key] = existing[key] || randomBytes(18).toString('base64url');
  const usedPins = new Set(pinKeys.map(key => existing[key]).filter(Boolean));
  for (const key of pinKeys) {
    let pin = existing[key];
    if (!pin) {
      do { pin = String(randomInt(10_000_000, 100_000_000)); } while (usedPins.has(pin));
      usedPins.add(pin);
    }
    settings[key] = pin;
  }
  return settings;
}

export function seedSecretsFromEnv(env: NodeJS.ProcessEnv = process.env): SeedSecrets {
  const passwords = passwordKeys.map(key => env[key] ?? '');
  const motherPins = pinKeys.map(key => env[key] ?? '');
  if (passwords.some(value => value.length < 16) || motherPins.some(pin => !/^\d{8,12}$/.test(pin))) {
    throw new Error('Demo credentials are missing or too short. Run npm run setup.');
  }
  if (new Set(passwords).size !== passwords.length || new Set(motherPins).size !== motherPins.length) {
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

export async function seedDatabase(db: Database, secrets: SeedSecrets): Promise<void> {
  const staff = [
    [1, 'admin', 'Demo Administrator', 'admin@tafiyaruwa.test', secrets.adminPassword, 3],
    [2, 'health_worker', 'Demo Health Worker', 'worker@tafiyaruwa.test', secrets.workerPassword, 1],
    [3, 'provider', 'Demo Hospital Doctor', 'provider@tafiyaruwa.test', secrets.providerPassword, 3],
    [4, 'health_worker', 'Demo Health Worker Two', 'worker2@tafiyaruwa.test', secrets.worker2Password, 2],
  ] as const;
  const mothers = [
    ['MC-7KQ4XM', 'Demo Mother A', 26, 'ha', '2027-02-15', 1, 1],
    ['MC-8RZ5TN', 'Demo Mother B', 30, 'en', '2027-03-02', 1, 1],
    ['MC-6VP9KD', 'Demo Mother C', 23, 'ha', '2027-01-20', 2, 1],
    ['MC-3HW7SC', 'Demo Mother D', 28, 'en', '2027-04-10', 2, 0],
    ['MC-9BX2RA', 'Demo Mother E', 32, 'ha', '2027-02-28', 1, 1],
  ] as const;
  const staffHashes = await Promise.all(staff.map(row => hashSecret(row[4])));
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
    const facility = db.prepare('INSERT INTO facilities(id, name, state) VALUES (?, ?, ?) ON CONFLICT DO NOTHING');
    facility.run(1, 'Gombe Community Health Centre (Demo)', 'Gombe');
    facility.run(2, 'Gombe Riverside Health Centre (Demo)', 'Gombe');
    facility.run(3, 'Gombe Referral Hospital (Demo)', 'Gombe');
    const user = db.prepare(`INSERT INTO users(id, role, name, email, password_hash, facility_id)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
    staff.forEach((row, i) => user.run(row[0], row[1], row[2], row[3], staffHashes[i]!, row[5]));
    if (sharedWorkerHash) {
      db.prepare(`UPDATE users SET password_hash = ?, session_version = session_version + 1
        WHERE id = 4 AND email = ? AND password_hash = ?`).run(staffHashes[3]!, staff[3][3], sharedWorkerHash);
    }
    const mother = db.prepare(`INSERT INTO mothers(id, maternal_id, name, age, pin_hash, language,
      expected_delivery_date, registered_facility_id, consent_to_share) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`);
    mothers.forEach((row, i) => mother.run(i + 1, row[0], row[1], row[2], pinHashes[i]!, row[3], row[4], row[5], row[6]));
    const rotatePin = db.prepare(`UPDATE mothers SET pin_hash = ?, session_version = session_version + 1
      WHERE id = ? AND maternal_id = ? AND pin_hash = ?`);
    sharedMotherHashes.forEach((previous, i) => {
      if (previous) rotatePin.run(pinHashes[i]!, i + 1, mothers[i]![0], previous);
    });
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
