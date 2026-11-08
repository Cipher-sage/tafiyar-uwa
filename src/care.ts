import { createHash } from 'node:crypto';
import type { Principal } from './auth.js';
import { hashSecret, verifySecret } from './crypto.js';
import type { Database } from './db.js';
import { generateMaternalId } from './maternal-id.js';

export interface MotherRecord {
  id: number;
  maternalId: string;
  name: string;
  age: number;
  phone: string | null;
  language: 'en' | 'ha';
  expectedDeliveryDate: string | null;
  registeredFacilityId: number;
  facilityName: string;
  consentToShare: boolean;
}

export interface VisitRecord {
  visitId: number;
  visitDate: string;
  weeksPregnant: number | null;
  bloodPressure: string | null;
  weight: number | null;
  notes: string;
  nextAppointment: string | null;
  facilityName: string;
}

export interface Appointment {
  visitId: number;
  visitDate: string;
  nextAppointment: string;
  facilityName: string;
}

type ErrorCode = 'validation' | 'forbidden' | 'notFound' | 'duplicateRequest' | 'idUnavailable';
type ErrorStatus = 403 | 404 | 409 | 422 | 503;
type FormInput = Record<string, unknown>;
type Fields = Record<string, string>;

export class CareError extends Error {
  constructor(public code: ErrorCode, public status: ErrorStatus, public fields: Fields = {}) {
    super(code);
  }
  get key() { return this.code; }
}

const gombeDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function todayInGombe(date = new Date()): string {
  return gombeDate.format(date);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dateField(input: FormInput, key: string, errors: Fields): string | null {
  const value = stringValue(input[key]);
  if (!value) return null;
  const date = new Date(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value) errors[key] = 'invalidDate';
  return value;
}

function formKey(input: FormInput, errors: Fields): string {
  const key = stringValue(input.requestKey).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key)) {
    errors.requestKey = 'invalidRequest';
  }
  return key;
}

function readRegistration(input: FormInput) {
  const errors: Fields = {};
  const requestKey = formKey(input, errors);
  const name = stringValue(input.name);
  if (!name || name.length > 100) errors.name = 'invalidName';
  const ageText = stringValue(input.age);
  const age = Number(ageText);
  if (!/^\d{1,3}$/.test(ageText) || age > 120) errors.age = 'invalidAge';
  const phoneText = stringValue(input.phone);
  const phone = phoneText.replace(/[\s()-]/g, '') || null;
  if (phoneText && (!phone || !/^\+?\d{7,15}$/.test(phone))) errors.phone = 'invalidPhone';
  const language = stringValue(input.language);
  if (language !== 'en' && language !== 'ha') errors.language = 'invalidLanguage';
  const expectedDeliveryDate = dateField(input, 'expectedDeliveryDate', errors);
  const consentToShare = ['on', '1', 'true', true].includes(input.consentToShare as string | boolean);
  const pin = typeof input.pin === 'string' ? input.pin : '';
  if (!/^\d{8,12}$/.test(pin)) errors.pin = 'invalidPin';
  if (input.pinConfirm !== pin) errors.pinConfirm = 'pinMismatch';
  if (Object.keys(errors).length) throw new CareError('validation', 422, errors);
  return { requestKey, pin, details: { name, age, phone, language, expectedDeliveryDate, consentToShare } };
}

function readVisit(input: FormInput) {
  const errors: Fields = {};
  const requestKey = formKey(input, errors);
  const visitDate = dateField(input, 'visitDate', errors);
  if (!visitDate) errors.visitDate = 'required';
  else if (!errors.visitDate && visitDate > todayInGombe()) errors.visitDate = 'futureVisit';
  const nextAppointment = dateField(input, 'nextAppointment', errors);
  if (!errors.nextAppointment && nextAppointment && visitDate && nextAppointment < visitDate) {
    errors.nextAppointment = 'appointmentBeforeVisit';
  }
  function measurement(field: 'weeksPregnant' | 'weight') {
    const value = stringValue(input[field]);
    if (!value) return null;
    const number = Number(value);
    if (!/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(number) || (field === 'weight' && number <= 0)) {
      errors[field] = 'invalidNumber';
    }
    return number;
  }
  const weeksPregnant = measurement('weeksPregnant');
  const weight = measurement('weight');
  const bloodPressure = stringValue(input.bloodPressure).replace(/\s/g, '') || null;
  if (bloodPressure && !/^\d{1,3}\/\d{1,3}$/.test(bloodPressure)) errors.bloodPressure = 'invalidPressure';
  const notes = stringValue(input.notes);
  if (notes.length > 1000) errors.notes = 'notesTooLong';
  if (Object.keys(errors).length) throw new CareError('validation', 422, errors);
  return { requestKey, visitDate: visitDate!, nextAppointment, weeksPregnant, weight, bloodPressure, notes };
}

// Keep each access check, read or write, and audit entry together. Never await inside this transaction.
export function transaction<T>(db: Database, work: () => T): T {
  if (db.transactionSync) return db.transactionSync(work);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function checkWorker(db: Database, user: Principal) {
  if (user.type !== 'staff' || user.role !== 'health_worker' || !db.prepare(
    "SELECT 1 FROM users WHERE id = ? AND role = 'health_worker' AND facility_id = ? AND active = 1 AND session_version = ?"
  ).get(user.id, user.facilityId, user.version)) throw new CareError('forbidden', 403);
}

function audit(db: Database, user: Principal, motherId: number, reason: string) {
  db.prepare('INSERT INTO access_logs(user_id, mother_id, reason, accessed_at, staff_role, staff_facility_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user.id, motherId, reason, new Date().toISOString(), user.role, user.facilityId);
}

export function findMother(db: Database, facilityId: number, maternalId: string): MotherRecord {
  const row = db.prepare(
    'SELECT m.id, m.maternal_id AS maternalId, m.name, m.age, m.phone, m.language,' +
    ' m.expected_delivery_date AS expectedDeliveryDate, m.registered_facility_id AS registeredFacilityId,' +
    ' f.name AS facilityName, m.consent_to_share AS consentToShare FROM mothers m' +
    ' JOIN facilities f ON f.id = m.registered_facility_id WHERE m.registered_facility_id = ? AND m.maternal_id = ?'
  ).get(facilityId, maternalId.trim().toUpperCase()) as (Omit<MotherRecord, 'consentToShare'> & { consentToShare: number }) | undefined;
  if (!row) throw new CareError('notFound', 404);
  return { ...row, consentToShare: Boolean(row.consentToShare) };
}

interface EarlierRegistration { maternalId: string; facilityId: number; digest: string; pinHash: string }

export async function createMother(db: Database, user: Principal, input: FormInput) {
  checkWorker(db, user);
  const { details, requestKey, pin } = readRegistration(input);
  // Keep the original non-secret input fingerprint because the mother can change her language later.
  const digest = createHash('sha256').update(JSON.stringify(details)).digest('hex');
  const hash = await hashSecret(pin);
  const result = transaction(db, () => {
    checkWorker(db, user);
    const earlier = db.prepare(
      'SELECT maternal_id AS maternalId, registered_facility_id AS facilityId, registration_digest AS digest,' +
      ' pin_hash AS pinHash FROM mothers WHERE registered_by = ? AND request_key = ?'
    ).get(user.id, requestKey) as EarlierRegistration | undefined;
    if (earlier) {
      if (earlier.facilityId !== user.facilityId || earlier.digest !== digest) throw new CareError('duplicateRequest', 409);
      return { earlier } as const;
    }
    const insert = db.prepare(
      'INSERT INTO mothers(maternal_id, name, age, phone, language, expected_delivery_date, consent_to_share,' +
      ' registered_by, registered_facility_id, request_key, registration_digest, pin_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' +
      ' ON CONFLICT(maternal_id) DO NOTHING'
    );
    for (let attempt = 0; attempt < 12; attempt++) {
      const maternalId = generateMaternalId();
      const saved = insert.run(maternalId, details.name, details.age, details.phone, details.language,
        details.expectedDeliveryDate, Number(details.consentToShare), user.id, user.facilityId, requestKey, digest, hash);
      if (saved.changes) {
        const mother = findMother(db, user.facilityId, maternalId);
        audit(db, user, mother.id, 'Register mother');
        return { mother } as const;
      }
    }
    throw new CareError('idUnavailable', 503);
  });
  if (result.mother) return { mother: result.mother, created: true };
  const previous = result.earlier;
  if (!await verifySecret(pin, previous.pinHash)) throw new CareError('duplicateRequest', 409);
  return transaction(db, () => {
    checkWorker(db, user);
    const mother = findMother(db, user.facilityId, previous.maternalId);
    audit(db, user, mother.id, 'Review registration');
    return { mother, created: false };
  });
}

const visitColumns = 'v.id AS visitId, v.visit_date AS visitDate, v.next_appointment AS nextAppointment, f.name AS facilityName';
const clinicalColumns = 'v.weeks_pregnant AS weeksPregnant, v.blood_pressure AS bloodPressure, v.weight, v.notes';
const visitOrder = ' FROM visits v JOIN facilities f ON f.id = v.facility_id WHERE v.mother_id = ? ORDER BY v.visit_date DESC, v.id DESC';

export function clinicVisitHistory(db: Database, motherId: number): VisitRecord[] {
  return db.prepare('SELECT ' + visitColumns + ', ' + clinicalColumns + visitOrder).all(motherId) as unknown as VisitRecord[];
}

export function getWorkerRecord(db: Database, user: Principal, maternalId: string) {
  return transaction(db, () => {
    checkWorker(db, user);
    const mother = findMother(db, user.facilityId, maternalId);
    audit(db, user, mother.id, 'Review record for a clinic visit');
    const visits = clinicVisitHistory(db, mother.id);
    return { mother, visits };
  });
}

export function saveVisit(db: Database, user: Principal, maternalId: string, input: FormInput) {
  return transaction(db, () => {
    checkWorker(db, user);
    const mother = findMother(db, user.facilityId, maternalId);
    const visit = readVisit(input);
    const earlier = db.prepare(
      'SELECT id AS visitId, mother_id AS motherId, facility_id AS facilityId, visit_date AS visitDate,' +
      ' next_appointment AS nextAppointment, weeks_pregnant AS weeksPregnant, blood_pressure AS bloodPressure,' +
      ' weight, notes FROM visits WHERE recorded_by = ? AND request_key = ?'
    ).get(user.id, visit.requestKey);
    if (earlier) {
      if (earlier.motherId !== mother.id || earlier.facilityId !== user.facilityId ||
        earlier.visitDate !== visit.visitDate || earlier.nextAppointment !== visit.nextAppointment ||
        earlier.weeksPregnant !== visit.weeksPregnant || earlier.bloodPressure !== visit.bloodPressure ||
        earlier.weight !== visit.weight || earlier.notes !== visit.notes) throw new CareError('duplicateRequest', 409);
      return { visitId: Number(earlier.visitId), created: false };
    }
    const saved = db.prepare(
      'INSERT INTO visits(mother_id, facility_id, visit_date, weeks_pregnant, blood_pressure, weight,' +
      ' notes, next_appointment, recorded_by, request_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(mother.id, user.facilityId, visit.visitDate, visit.weeksPregnant, visit.bloodPressure, visit.weight,
      visit.notes, visit.nextAppointment, user.id, visit.requestKey);
    audit(db, user, mother.id, 'Record clinic visit');
    return { visitId: Number(saved.lastInsertRowid), created: true };
  });
}

export function getMotherAppointments(db: Database, motherId: number) {
  const rows = db.prepare('SELECT ' + visitColumns + visitOrder).all(motherId) as unknown as (Omit<Appointment, 'nextAppointment'> & { nextAppointment: string | null })[];
  const [latest, ...previous] = rows;
  const next: Appointment | null = latest?.nextAppointment ? { ...latest, nextAppointment: latest.nextAppointment } : null;
  const history: Appointment[] = previous.filter((row): row is Appointment => row.nextAppointment !== null);
  return { next, history, lastVisitDate: latest?.visitDate ?? null };
}
