import { databasePath } from '../src/config.js';
import { openDatabase, migrate } from '../src/db.js';
const db = openDatabase(databasePath());
try { migrate(db); console.log('Schema migration completed.'); } finally { db.close(); }
