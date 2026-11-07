import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import { databasePath } from '../src/config.js';
import { openDatabase, migrate } from '../src/db.js';
import { generateSeedSettings, seedDatabase, seedSecretsFromEnv } from '../src/seed.js';

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
  const required = { SESSION_SECRET: existing.SESSION_SECRET || randomBytes(48).toString('hex'), ...settings };
  let updated = original;
  for (const [key, value] of Object.entries(required)) {
    if (existing[key]) continue;
    const emptyAssignment = new RegExp(`^${key}=[ \\t]*\\r?$`, 'm');
    if (emptyAssignment.test(updated)) updated = updated.replace(emptyAssignment, `${key}=${value}`);
    else updated = `${updated.trimEnd()}\n${key}=${value}\n`;
  }
  if (updated !== original || !existsSync('.env')) {
    const temp = `.env.${process.pid}.tmp`;
    writeFileSync(temp, updated, { mode: 0o600 });
    renameSync(temp, '.env');
  }
  return credentials;
}
const db = openDatabase(databasePath());
try {
  // Serialize credential creation for concurrent setup commands on this demo database.
  db.exec('BEGIN IMMEDIATE');
  let credentials;
  try {
    credentials = prepareLocalCredentials();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  migrate(db);
  await seedDatabase(db, credentials);
  console.log('Ready: six tables, three demo facilities, four staff accounts and five fictional mothers.');
  console.log('Account names are in README.md. Generated passwords and individual PINs are in your ignored .env.');
  console.log('Start the app with npm run dev.');
} finally { db.close(); }
