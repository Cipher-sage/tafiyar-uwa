import type { Principal } from './auth.js';
import { getMotherAppointments, todayInGombe, transaction } from './care.js';
import type { Database } from './db.js';
import { formatDate, getCopy, type Language } from './i18n.js';

type ErrorCode = 'forbidden' | 'unavailable' | 'invalidRequest' | 'noAppointment' | 'pastAppointment' | 'conflict';
export class ReminderError extends Error {
  constructor(public code: ErrorCode, public status: 403 | 404 | 409 | 422) { super(code); }
}

export interface ReminderEntry {
  id: number;
  maternalId: string;
  motherName: string;
  message: string;
  createdAt: string;
  facilityName: string | null;
  staffName: string | null;
  language: Language | null;
  appointmentDate: string | null;
  status: 'simulation';
}

const reminderQuery = `SELECT o.id, m.maternal_id AS maternalId, m.name AS motherName,
  o.message_text AS message, o.created_at AS createdAt, f.name AS facilityName,
  u.name AS staffName, o.language, o.appointment_date AS appointmentDate, 'simulation' AS status
  FROM sms_outbox o JOIN mothers m ON m.id = o.mother_id
  LEFT JOIN facilities f ON f.id = o.facility_id LEFT JOIN users u ON u.id = o.user_id`;

function requireStaff(db: Database, user: Principal) {
  if (user.type !== 'staff' || !['health_worker', 'admin'].includes(user.role) || !db.prepare(
    'SELECT 1 FROM users WHERE id = ? AND role = ? AND active = 1 AND facility_id = ? AND session_version = ?'
  ).get(user.id, user.role, user.facilityId, user.version)) throw new ReminderError('forbidden', 403);
}

export function queueReminder(db: Database, user: Principal, inputId: unknown, inputKey: unknown) {
  return transaction(db, () => {
    requireStaff(db, user);
    if (user.role !== 'health_worker') throw new ReminderError('forbidden', 403);
    const maternalId = typeof inputId === 'string' ? inputId.trim().toUpperCase() : '';
    const requestKey = typeof inputKey === 'string' ? inputKey.toLowerCase() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestKey)) {
      throw new ReminderError('invalidRequest', 422);
    }
    const mother = db.prepare(
      'SELECT id, language FROM mothers WHERE maternal_id = ? AND registered_facility_id = ?'
    ).get(maternalId, user.facilityId) as { id: number; language: Language } | undefined;
    if (!mother) throw new ReminderError('unavailable', 404);
    const previous = db.prepare(
      'SELECT id, mother_id AS motherId, facility_id AS facilityId FROM sms_outbox WHERE user_id = ? AND request_key = ?'
    ).get(user.id, requestKey);
    if (previous && (previous.motherId !== mother.id || previous.facilityId !== user.facilityId)) {
      throw new ReminderError('conflict', 409);
    }
    let id = Number(previous?.id);
    if (!previous) {
      const { next } = getMotherAppointments(db, mother.id);
      if (!next) throw new ReminderError('noAppointment', 422);
      if (next.nextAppointment < todayInGombe()) throw new ReminderError('pastAppointment', 422);
      const message = getCopy(mother.language).reminder.message.replace('{date}', formatDate(next.nextAppointment, mother.language));
      const inserted = db.prepare(`INSERT INTO sms_outbox
        (mother_id, message_text, created_at, facility_id, user_id, visit_id, request_key, language, appointment_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        mother.id, message, new Date().toISOString(), user.facilityId, user.id, next.visitId,
        requestKey, mother.language, next.nextAppointment,
      );
      id = Number(inserted.lastInsertRowid);
    }
    // Returning a reminder accesses appointment information and must be auditable too.
    db.prepare(`INSERT INTO access_logs(user_id, mother_id, reason, accessed_at, staff_role, staff_facility_id)
      VALUES (?, ?, ?, ?, ?, ?)`).run(user.id, mother.id, 'Prepare a simulated appointment reminder',
      new Date().toISOString(), user.role, user.facilityId);
    const entry = db.prepare(reminderQuery + ' WHERE o.id = ?').get(id) as unknown as ReminderEntry;
    return { created: !previous, entry };
  });
}

export function listReminderOutbox(db: Database, user: Principal, requestedPage: unknown = 1) {
  return transaction(db, () => {
    requireStaff(db, user);
    // Older rows have no trustworthy sending-clinic provenance and stay admin-only.
    const where = user.role === 'admin' ? '' : ' WHERE o.facility_id = ?';
    const parameters = user.role === 'admin' ? [] : [user.facilityId];
    const total = Number(db.prepare('SELECT COUNT(*) AS n FROM sms_outbox o' + where).get(...parameters)!.n);
    const pageSize = 25;
    const input = typeof requestedPage === 'number' || typeof requestedPage === 'string' ? Number(requestedPage) : 1;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Number.isSafeInteger(input) ? Math.max(1, Math.min(input, lastPage)) : 1;
    const entries = db.prepare(reminderQuery + where + ' ORDER BY o.id DESC LIMIT ? OFFSET ?')
      .all(...parameters, pageSize, (page - 1) * pageSize) as unknown as ReminderEntry[];
    return { entries, page, pageSize, total, hasPrevious: page > 1, hasNext: page < lastPage };
  });
}
