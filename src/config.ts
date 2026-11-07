import 'dotenv/config';
import { resolve } from 'node:path';

export interface AppConfig {
  origin: string;
  sessionSecret: string;
  secureCookies: boolean;
  sessionSeconds: number;
}

export function loadConfig(): AppConfig {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 48) throw new Error('SESSION_SECRET must have at least 48 characters. Run npm run setup.');
  const url = new URL(process.env.APP_ORIGIN ?? 'http://127.0.0.1:4317');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('APP_ORIGIN must be an HTTP(S) origin.');
  if (url.origin !== (process.env.APP_ORIGIN ?? url.origin)) throw new Error('APP_ORIGIN must contain only scheme, hostname and port.');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production requires an HTTPS APP_ORIGIN.');
  return { origin: url.origin, sessionSecret: secret, secureCookies: url.protocol === 'https:', sessionSeconds: 1800 };
}

export function databasePath(): string {
  return resolve(process.env.DATABASE_PATH ?? './data/maternal-continuity.sqlite');
}
