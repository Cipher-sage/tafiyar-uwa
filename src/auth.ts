import { randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Database } from './db.js';
import type { AppConfig } from './config.js';
import { signSession, verifySession } from './crypto.js';

export type Role = 'admin' | 'health_worker' | 'provider' | 'mother';
export interface Principal {
  id: number; type: 'staff' | 'mother'; role: Role; name: string;
  facilityId: number; facilityName: string; maternalId?: string; language?: string; version: number;
}
export type AppEnv = { Variables: { principal: Principal | null } };

export function cookieName(config: AppConfig): string { return config.secureCookies ? '__Host-mc_session' : 'mc_session'; }

export function establishSession(c: Context<AppEnv>, config: AppConfig, type: 'staff' | 'mother', id: number, version: number): void {
  const token = signSession({ type, id, version, expires: Math.floor(Date.now() / 1000) + config.sessionSeconds, nonce: randomBytes(16).toString('hex') }, config.sessionSecret);
  setCookie(c, cookieName(config), token, { httpOnly: true, secure: config.secureCookies, sameSite: 'Strict', path: '/', maxAge: config.sessionSeconds });
}

export function clearSession(c: Context<AppEnv>, config: AppConfig): void {
  deleteCookie(c, cookieName(config), { path: '/', secure: config.secureCookies, httpOnly: true, sameSite: 'Strict' });
}

export function identify(db: Database, config: AppConfig): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('principal', null);
    const token = getCookie(c, cookieName(config));
    const claims = token ? verifySession(token, config.sessionSecret) : null;
    if (claims) {
      if (claims.type === 'staff') {
        const row = db.prepare(`SELECT u.id, u.role, u.name, u.facility_id AS facilityId, f.name AS facilityName,
          u.session_version AS version FROM users u JOIN facilities f ON f.id = u.facility_id
          WHERE u.id = ? AND u.active = 1 AND u.session_version = ?`).get(claims.id, claims.version) as Omit<Principal, 'type'> | undefined;
        if (row) c.set('principal', { ...row, type: 'staff' });
      } else {
        const row = db.prepare(`SELECT m.id, m.name, m.maternal_id AS maternalId, m.language,
          m.registered_facility_id AS facilityId, f.name AS facilityName, m.session_version AS version
          FROM mothers m JOIN facilities f ON f.id = m.registered_facility_id
          WHERE m.id = ? AND m.session_version = ?`).get(claims.id, claims.version) as Omit<Principal, 'type' | 'role'> | undefined;
        if (row) c.set('principal', { ...row, type: 'mother', role: 'mother' });
      }
    }
    await next();
  };
}

export const homeFor = (role: Role): string => ({ admin: '/admin', health_worker: '/worker', provider: '/provider', mother: '/mother' })[role];

export class LoginThrottle {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private limit = 12, private windowMs = 5 * 60 * 1000) {}
  allow(key: string, now = Date.now()): boolean {
    for (const [k, v] of this.attempts) if (v.until <= now) this.attempts.delete(k);
    const previous = this.attempts.get(key);
    if (previous) {
      if (previous.count >= this.limit) return false;
      previous.count++;
      return true;
    }
    if (this.attempts.size >= 2000) return false;
    this.attempts.set(key, { count: 1, until: now + this.windowMs });
    return true;
  }
  releaseSuccessful(key: string, startedAt: number): void {
    const entry = this.attempts.get(key);
    if (!entry || startedAt < entry.until - this.windowMs) return;
    if (--entry.count === 0) this.attempts.delete(key);
  }
}
