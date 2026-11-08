import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface Database {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...values: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
    all(...values: SQLInputValue[]): Record<string, SQLOutputValue>[];
    run(...values: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
  transactionSync?<T>(work: () => T): T;
}

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  return db;
}

export function migrate(db: Database, migrationsDirectory = resolve('migrations')): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (current.user_version > 6) throw new Error('Database schema is newer than this app.');
    if (current.user_version === 0) {
      db.exec(readFileSync(resolve(migrationsDirectory, '001_initial.sql'), 'utf8'));
    }
    if (current.user_version < 2) {
      db.exec(readFileSync(resolve(migrationsDirectory, '002_rename_demo_staff.sql'), 'utf8'));
    }
    if (current.user_version < 3) {
      db.exec(readFileSync(resolve(migrationsDirectory, '003_care_forms.sql'), 'utf8'));
    }
    if (current.user_version < 4) {
      db.exec(readFileSync(resolve(migrationsDirectory, '004_access_logs.sql'), 'utf8'));
    }
    if (current.user_version < 5) {
      db.exec(readFileSync(resolve(migrationsDirectory, '005_lookup_outcomes.sql'), 'utf8'));
    }
    if (current.user_version < 6) {
      db.exec(readFileSync(resolve(migrationsDirectory, '006_reminder_outbox.sql'), 'utf8'));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function ensureMigrated(db: Database): void {
  const current = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (current.user_version >= 1 && current.user_version < 6) migrate(db);
  else if (current.user_version !== 6) throw new Error('Database is not ready. Run npm run db:migrate and npm run db:seed.');
}
