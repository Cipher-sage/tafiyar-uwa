import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Database = DatabaseSync;

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrate(db: Database, migrationsDirectory = resolve('migrations')): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (current.user_version > 3) throw new Error('Database schema is newer than this app.');
    if (current.user_version === 0) {
      db.exec(readFileSync(resolve(migrationsDirectory, '001_initial.sql'), 'utf8'));
    }
    if (current.user_version < 2) {
      db.exec(readFileSync(resolve(migrationsDirectory, '002_rename_demo_staff.sql'), 'utf8'));
    }
    if (current.user_version < 3) {
      db.exec(readFileSync(resolve(migrationsDirectory, '003_care_forms.sql'), 'utf8'));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function ensureMigrated(db: Database): void {
  const current = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (current.user_version === 1 || current.user_version === 2) migrate(db);
  else if (current.user_version !== 3) throw new Error('Database is not ready. Run npm run db:migrate and npm run db:seed.');
}
