import type { Principal, Role } from './auth.js';
import { clinicVisitHistory, findMother, transaction } from './care.js';
import type { Database } from './db.js';

type ErrorCode = 'validation' | 'forbidden' | 'unavailable' | 'invalidEvent' | 'conflict';

export class ProviderError extends Error {
  constructor(public code: ErrorCode, public status: 403 | 404 | 409 | 422, public fields: Record<string, string> = {}) {
    super(code);
  }
}

export interface OfflineAuditGrant {
  logId: number;
  providerId: number;
  providerVersion: number;
  facilityId: number;
  motherId: number;
  reason: string;
  openedAt: string;
  expiresAt: string;
}

function requireStaff(db: Database, user: Principal, role: 'provider' | 'admin') {
  if (user.type !== 'staff' || user.role !== role || !db.prepare(
    'SELECT 1 FROM users WHERE id = ? AND role = ? AND facility_id = ? AND active = 1 AND session_version = ?'
  ).get(user.id, role, user.facilityId, user.version)) throw new ProviderError('forbidden', 403);
}

export function lookupProviderRecord(db: Database, user: Principal, inputId: unknown, inputReason: unknown) {
  const record = transaction(db, () => {
    requireStaff(db, user, 'provider');
    const maternalId = typeof inputId === 'string' ? inputId.trim().toUpperCase() : '';
    const reason = typeof inputReason === 'string' ? inputReason.trim() : '';
    const errors: Record<string, string> = {};
    if (!/^MC-[A-HJ-NP-Z2-9]{6}$/.test(maternalId)) errors.maternalId = 'invalidMaternalId';
    if (reason.length < 3 || reason.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
      errors.reason = 'invalidReason';
    }
    if (Object.keys(errors).length) throw new ProviderError('validation', 422, errors);

    const target = db.prepare(
      'SELECT id, registered_facility_id AS facility, consent_to_share AS consent FROM mothers WHERE maternal_id = ?'
    ).get(maternalId);
    const openedAt = new Date().toISOString();
    const allowed = target?.consent === 1;
    const log = db.prepare(
      'INSERT INTO access_logs(user_id, mother_id, reason, accessed_at, attempted_maternal_id, outcome,' +
      ' staff_role, staff_facility_id, provider_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(user.id, target?.id ?? null, reason, openedAt, maternalId, allowed ? 'opened' : 'denied',
      user.role, user.facilityId, user.version);
    if (!allowed) return null;
    const mother = findMother(db, Number(target.facility), maternalId);
    return { mother, visits: clinicVisitHistory(db, mother.id), reason, openedAt, logId: Number(log.lastInsertRowid) };
  });
  // Commit the denied attempt before returning the same response for either cause.
  if (!record) throw new ProviderError('unavailable', 404);
  return record;
}

export interface AccessLogEntry {
  id: number;
  staffId: number;
  staffName: string;
  staffRole: Exclude<Role, 'mother'>;
  facilityName: string;
  motherName: string | null;
  maternalId: string;
  reason: string;
  accessedAt: string;
  receivedAt: string;
  source: 'online' | 'offline';
  outcome: 'opened' | 'denied';
}

export function listAccessLogs(db: Database, user: Principal, requestedPage: unknown = 1) {
  return transaction(db, () => {
    requireStaff(db, user, 'admin');
    const pageSize = 50;
    const total = Number(db.prepare('SELECT COUNT(*) AS n FROM access_logs').get()!.n);
    const input = typeof requestedPage === 'string' || typeof requestedPage === 'number' ? Number(requestedPage) : 1;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Number.isSafeInteger(input) ? Math.max(1, Math.min(input, lastPage)) : 1;
    const entries = db.prepare(
      'SELECT l.id, l.user_id AS staffId, u.name AS staffName, COALESCE(l.staff_role, u.role) AS staffRole,' +
      ' f.name AS facilityName, m.name AS motherName, COALESCE(l.attempted_maternal_id, m.maternal_id) AS maternalId,' +
      ' l.reason, l.accessed_at AS accessedAt, COALESCE(l.received_at, l.accessed_at) AS receivedAt,' +
      ' l.source, l.outcome FROM access_logs l JOIN users u ON u.id = l.user_id' +
      ' JOIN facilities f ON f.id = COALESCE(l.staff_facility_id, u.facility_id) LEFT JOIN mothers m ON m.id = l.mother_id' +
      ' ORDER BY l.id DESC LIMIT ? OFFSET ?'
    ).all(pageSize, (page - 1) * pageSize) as unknown as AccessLogEntry[];
    return { entries, page, pageSize, total, hasPrevious: page > 1, hasNext: page < lastPage };
  });
}

function isoTime(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}

// The HTTP layer authenticates the grant. Verify its original lookup even when the session has since ended.
export function recordOfflineAccess(db: Database, grant: OfflineAuditGrant, eventId: unknown, viewedAt: unknown): boolean {
  const opened = isoTime(grant.openedAt);
  const expires = isoTime(grant.expiresAt);
  const viewed = isoTime(viewedAt);
  if (typeof eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId) ||
      typeof viewedAt !== 'string' || !(opened <= viewed && viewed < expires && viewed <= Date.now())) {
    throw new ProviderError('invalidEvent', 422);
  }
  return transaction(db, () => {
    const original = db.prepare(
      "SELECT id FROM access_logs WHERE id = ? AND user_id = ? AND staff_role = 'provider' AND provider_version = ?" +
      " AND staff_facility_id = ? AND mother_id = ? AND reason = ? AND accessed_at = ? AND source = 'online' AND outcome = 'opened'"
    ).get(grant.logId, grant.providerId, grant.providerVersion, grant.facilityId, grant.motherId, grant.reason, grant.openedAt);
    if (!original) throw new ProviderError('invalidEvent', 422);
    const key = eventId.toLowerCase();
    const existing = db.prepare('SELECT original_lookup_id, accessed_at FROM access_logs WHERE event_id = ?').get(key);
    if (existing) {
      if (existing.original_lookup_id !== grant.logId || existing.accessed_at !== viewedAt) throw new ProviderError('conflict', 409);
      return false;
    }
    db.prepare(
      'INSERT INTO access_logs(user_id, mother_id, reason, accessed_at, source, event_id, received_at,' +
      ' staff_role, staff_facility_id, provider_version, original_lookup_id)' +
      " VALUES (?, ?, ?, ?, 'offline', ?, ?, 'provider', ?, ?, ?)"
    ).run(grant.providerId, grant.motherId, grant.reason, viewedAt, key, new Date().toISOString(),
      grant.facilityId, grant.providerVersion, grant.logId);
    return true;
  });
}
