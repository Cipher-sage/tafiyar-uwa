import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import { databasePath } from '../src/config.js';
import { openDatabase, migrate } from '../src/db.js';
import { demoHashes, generateSeedSettings, resetDemoPins, seedDatabase, seedFromHashes, seedSecretsFromEnv } from '../src/seed.js';

function saveLocalSettings(content: string) {
  const temp = `.env.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  renameSync(temp, '.env');
}

function prepareLocalCredentials() {
  const original = existsSync('.env') ? readFileSync('.env', 'utf8') : [
    '# Local fictional-demo credentials. Never commit or share this file.',
    'NODE_ENV=development', 'HOST=127.0.0.1', 'PORT=4317', 'APP_ORIGIN=http://127.0.0.1:4317',
    'DATABASE_PATH=./data/maternal-continuity.sqlite', '',
  ].join('\n');
  const existing = { ...process.env };
  for (const [key, value] of Object.entries(parse(original))) {
    if (!existing[key]) existing[key] = value;
  }
  const settings = generateSeedSettings(existing);
  const credentials = seedSecretsFromEnv(settings);
  const upgrade = Object.keys(settings).some(key => existing[key] && existing[key] !== settings[key]);
  const reset = upgrade || existing.DEMO_PIN_RESET_PENDING === '1' || process.argv.includes('--reset-demo-pins');
  const required = { SESSION_SECRET: existing.SESSION_SECRET || randomBytes(48).toString('hex'), ...settings,
    ...(reset ? { DEMO_PIN_RESET_PENDING: '1' } : {}) };
  let updated = original;
  for (const [key, value] of Object.entries(required)) {
    if (existing[key] === value && parse(original)[key] === value) continue;
    const assignment = new RegExp(`^${key}=.*$`, 'm');
    if (assignment.test(updated)) updated = updated.replace(assignment, () => `${key}=${value}`);
    else updated = `${updated.trimEnd()}\n${key}=${value}\n`;
  }
  if (updated !== original || !existsSync('.env')) saveLocalSettings(updated);
  return { credentials, reset, registeredPins: existing.DEMO_REGISTERED_PINS };
}
const db = openDatabase(databasePath());
try {
  // Serialize credential creation for concurrent setup commands on this demo database.
  db.exec('BEGIN IMMEDIATE');
  let prepared;
  try {
    prepared = prepareLocalCredentials();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  migrate(db);
  if (prepared.reset) {
    const hashes = await demoHashes(prepared.credentials, prepared.registeredPins);
    db.exec('BEGIN IMMEDIATE');
    try {
      seedFromHashes(db, hashes);
      resetDemoPins(db, hashes);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    saveLocalSettings(readFileSync('.env', 'utf8').replace(/^DEMO_PIN_RESET_PENDING=1\r?\n/gm, ''));
  } else {
    await seedDatabase(db, prepared.credentials);
  }
  console.log('Ready: six tables, three demo facilities, four staff accounts and five fictional mothers.');
  console.log('Account names are in README.md. Four-digit demo PINs are in your ignored .env.');
  console.log('Start the app with npm run dev.');
} finally { db.close(); }
