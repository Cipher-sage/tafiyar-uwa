import { databasePath } from '../src/config.js';
import { openDatabase, ensureMigrated } from '../src/db.js';
import { seedDatabase, seedSecretsFromEnv } from '../src/seed.js';
const db = openDatabase(databasePath());
try {
  ensureMigrated(db);
  await seedDatabase(db, seedSecretsFromEnv());
  console.log('Fictional demo accounts are ready.');
} finally { db.close(); }
