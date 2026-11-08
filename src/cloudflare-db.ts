import type { DurableObjectStorage } from '@cloudflare/workers-types';
import type { Database } from './db.js';
import { seedFromHashes } from './seed.js';
import initial from '../migrations/001_initial.sql';
import renamed from '../migrations/002_rename_demo_staff.sql';
import careForms from '../migrations/003_care_forms.sql';
import accessLogs from '../migrations/004_access_logs.sql';
import lookupOutcomes from '../migrations/005_lookup_outcomes.sql';
import outbox from '../migrations/006_reminder_outbox.sql';

const migrations = [initial, renamed, careForms, accessLogs, lookupOutcomes, outbox];
type Row = Record<string, string | number | null>;

export function openClinicStorage(storage: DurableObjectStorage, seed?: string): Database {
  const sql = storage.sql;
  const db: Database = {
    exec(query) { sql.exec(query).toArray(); },
    transactionSync(work) { return storage.transactionSync(work); },
    prepare(query) {
      return {
        get(...values) { return sql.exec<Row>(query, ...values).next().value; },
        all(...values) { return sql.exec<Row>(query, ...values).toArray(); },
        run(...values) {
          sql.exec(query, ...values).toArray();
          return sql.exec<{ changes: number; lastInsertRowid: number }>(
            'SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid',
          ).one();
        },
      };
    },
  };
  // The embedded database and storage.kv commit together. Workers enforce foreign
  // keys and use their own storage metadata instead of SQLite's user_version.
  storage.transactionSync(() => {
    const version = storage.kv.get<number>('schema-version') ?? 0;
    if (!Number.isInteger(version) || version < 0 || version > migrations.length) {
      throw new Error('Unsupported clinic database schema.');
    }
    for (const migration of migrations.slice(version)) {
      db.exec(migration.replace(/^PRAGMA (?:user_version|foreign_keys)\s*=.*?;\s*$/gmi, ''));
    }
    if (!version) {
      if (!seed) throw new Error('First setup requires demo credential hashes.');
      seedFromHashes(db, JSON.parse(seed));
    }
    if (version < migrations.length) storage.kv.put('schema-version', migrations.length);
  });
  return db;
}
