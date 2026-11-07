import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { getMotherAppointments } from '../src/care.js';
import { migrate, openDatabase } from '../src/db.js';
import { generateMaternalId } from '../src/maternal-id.js';
import { generateSeedSecrets, seedDatabase } from '../src/seed.js';

const db = openDatabase(':memory:');
const credentials = generateSeedSecrets();
const origin = 'http://127.0.0.1:4317';
const idPattern = /^MC-[A-HJ-NP-Z2-9]{6}$/;
let app: Awaited<ReturnType<typeof createApp>>;
let worker: string;
let otherWorker: string;
let provider: string;

function request(path: string, cookie?: string) {
  return app.request(new Request(origin + path, { headers: cookie ? { cookie } : {} }));
}

function post(path: string, fields: Record<string, string>, cookie?: string, source = origin) {
  return app.request(new Request(origin + path, {
    method: 'POST',
    headers: { origin: source, ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields),
  }));
}

async function signIn(path: string, fields: Record<string, string>) {
  const response = await post(path, fields);
  assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'sign-in should issue a session');
  return cookie;
}

async function formKey(path: string, cookie: string) {
  const response = await request(path, cookie);
  assert.equal(response.status, 200);
  const form = await response.text();
  const input = form.match(/<input\b[^>]*\bname="requestKey"[^>]*>/i)?.[0];
  const key = input?.match(/\bvalue="([^"]+)"/i)?.[1];
  assert.ok(key, 'the displayed form should have a request key');
  return key;
}

function registration(requestKey: string) {
  const pin = String(randomInt(10_000_000, 100_000_000));
  return {
    name: 'Fictional Clinic Tester', age: '27', language: 'ha', expectedDeliveryDate: '',
    phone: '', pin, pinConfirm: pin, requestKey,
  };
}

function recordPath(response: Response) {
  assert.equal(response.status, 303);
  const path = new URL(response.headers.get('location')!, origin).pathname;
  assert.match(path, /^\/worker\/mothers\/MC-[A-HJ-NP-Z2-9]{6}$/);
  return path;
}

before(async () => {
  migrate(db);
  await seedDatabase(db, credentials);
  app = await createApp(db, {
    origin, sessionSecret: randomBytes(48).toString('hex'), secureCookies: false, sessionSeconds: 1800,
  });
  worker = await signIn('/auth/staff', { identifier: 'worker@tafiyaruwa.test', password: credentials.workerPassword });
  otherWorker = await signIn('/auth/staff', { identifier: 'worker2@tafiyaruwa.test', password: credentials.worker2Password });
  provider = await signIn('/auth/staff', { identifier: 'provider@tafiyaruwa.test', password: credentials.providerPassword });
});
after(() => db.close());

test('maternal IDs are six readable random characters after MC-', () => {
  const samples = Array.from({ length: 100 }, () => generateMaternalId());
  for (const id of samples) assert.match(id, idPattern);
  assert.ok(new Set(samples).size > 1);
});

test('registration preserves an optional consent decision, hashes the PIN and safely retries', async () => {
  const fields = registration(await formKey('/worker/register', worker));
  const url = '/worker/register';
  const results = await Promise.all([post(url, fields, worker), post(url, fields, worker)]);
  const path = recordPath(results[0]!);
  assert.equal(recordPath(results[1]!), path);
  const maternalId = path.split('/').at(-1)!;
  const row = db.prepare('SELECT pin_hash, consent_to_share, registered_facility_id FROM mothers WHERE maternal_id = ?').get(maternalId)!;
  assert.ok(typeof row.pin_hash === 'string' && row.pin_hash.startsWith('scrypt$'));
  assert.ok(!String(row.pin_hash).includes(fields.pin));
  assert.equal(row.consent_to_share, 0);
  assert.equal(row.registered_facility_id, 1);
  assert.equal((await post(url, { ...fields, name: 'Different Fictional Mother' }, worker)).status, 409);
  const granted = { ...registration(await formKey(url, worker)), consentToShare: 'on' };
  const second = recordPath(await post(url, granted, worker)).split('/').at(-1)!;
  assert.equal(db.prepare('SELECT consent_to_share FROM mothers WHERE maternal_id = ?').get(second)?.consent_to_share, 1);
});

test('invalid or cross-site registration cannot create a record or echo its PIN', async () => {
  const fields = registration(await formKey('/worker/register', worker));
  const countMothers = () => db.prepare('SELECT COUNT(*) AS total FROM mothers').get()!.total;
  const before = countMothers();
  assert.equal((await post('/worker/register', fields, worker, 'https://untrusted.example')).status, 403);
  const response = await post('/worker/register', { ...fields, pinConfirm: '', expectedDeliveryDate: '2026-02-31' }, worker);
  assert.ok([400, 422].includes(response.status));
  assert.ok(!(await response.text()).includes(fields.pin));
  assert.equal(countMothers(), before);
});

test('only a health worker at the registering facility can open and update a record, and each open is audited', async () => {
  const fields = registration(await formKey('/worker/register', worker));
  const path = recordPath(await post('/worker/register', fields, worker));
  const id = path.split('/').at(-1)!;
  const internalId = Number(db.prepare('SELECT id FROM mothers WHERE maternal_id = ?').get(id)!.id);
  const auditCount = () => Number(db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE user_id = 2 AND mother_id = ? AND length(trim(reason)) > 0').get(internalId)!.n);
  const before = auditCount();
  await formKey(path, worker);
  await formKey(path, worker);
  assert.equal(auditCount(), before + 2);
  const own = await signIn('/auth/mother', { maternalId: id, pin: fields.pin });
  for (const cookie of [provider, own, otherWorker]) {
    const read = await request(path, cookie);
    assert.ok([403, 404].includes(read.status));
    assert.ok(!(await read.text()).includes(fields.name));
    const write = await post(path + '/visits', { requestKey: randomUUID(), visitDate: '2025-01-01' }, cookie);
    assert.ok([403, 404].includes(write.status));
  }
  assert.equal((await request('/worker/register')).status, 303);
  assert.equal((await post('/worker/register', registration(randomUUID()), provider)).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visits WHERE mother_id = ?').get(internalId)!.n, 0);
});

test('invalid visit dates and measurements do not save part of a visit', async () => {
  const path = '/worker/mothers/MC-7KQ4XM';
  const requestKey = await formKey(path, worker);
  const before = db.prepare('SELECT COUNT(*) AS n FROM visits WHERE mother_id = 1').get()!.n;
  const invalid: Record<string, string>[] = [
    { visitDate: '2025-02-30' }, { nextAppointment: '2025-01-02' },
    { weeksPregnant: '-1' }, { weight: '0' }, { bloodPressure: 'not a measurement' },
  ];
  for (const changes of invalid) {
    const values = { requestKey, visitDate: '2025-01-03', nextAppointment: '2025-01-04', ...changes };
    assert.equal((await post(path + '/visits', values, worker)).status, 422);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visits WHERE mother_id = 1').get()!.n, before);
});

test('a registered mother sees her clinic appointment in both languages and no private visit notes', async () => {
  const fields = registration(await formKey('/worker/register', worker));
  const path = recordPath(await post('/worker/register', fields, worker));
  const maternalId = path.split('/').at(-1)!;
  const own = await signIn('/auth/mother', { maternalId, pin: fields.pin });
  const original = await request('/mother', own);
  assert.match(await original.text(), /<html\s+lang="ha"/);
  const values = {
    requestKey: await formKey(path, worker), visitDate: '2025-05-08', weeksPregnant: '24',
    bloodPressure: '110/70', weight: '62.5', notes: 'Fictional confidential visit note',
    nextAppointment: '2027-03-18',
  };
  assert.equal((await post(path + '/visits', values, worker)).status, 303);
  assert.equal((await post(path + '/visits', values, worker)).status, 303);
  assert.equal((await post(path + '/visits', { ...values, notes: 'Conflicting demo value' }, worker)).status, 409);
  const internalId = Number(db.prepare('SELECT id FROM mothers WHERE maternal_id = ?').get(maternalId)!.id);
  const saved = db.prepare('SELECT weeks_pregnant, blood_pressure, weight, notes, next_appointment, facility_id, recorded_by FROM visits WHERE mother_id = ?').all(internalId);
  assert.deepEqual(saved.map(row => ({ ...row })), [{
    weeks_pregnant: 24, blood_pressure: '110/70', weight: 62.5, notes: values.notes,
    next_appointment: values.nextAppointment, facility_id: 1, recorded_by: 2,
  }]);
  const englishSwitch = await post('/mother/language', { language: 'en', motherId: '1' }, own);
  assert.equal(englishSwitch.status, 303);
  const english = await (await request('/mother?maternalId=MC-7KQ4XM', own)).text();
  assert.match(english, /<html\s+lang="en"/);
  assert.ok(english.includes(maternalId) && !english.includes('MC-7KQ4XM'));
  assert.ok(english.includes(values.nextAppointment));
  assert.ok(!english.includes(values.notes) && !english.includes(values.bloodPressure) && !english.includes(fields.pin));
  assert.equal(db.prepare('SELECT language FROM mothers WHERE id = ?').get(internalId)!.language, 'en');
  assert.equal(db.prepare('SELECT language FROM mothers WHERE id = 1').get()!.language, 'ha');
  assert.equal((await post('/mother/language', { language: 'ha' }, own)).status, 303);
  const hausa = await (await request('/mother', own)).text();
  assert.match(hausa, /<html\s+lang="ha"/);
  assert.ok(hausa.includes(values.nextAppointment) && !hausa.includes(values.notes));
  const another = await signIn('/auth/mother', { maternalId: 'MC-7KQ4XM', pin: credentials.motherPins[0]! });
  const otherPage = await (await request('/mother?maternalId=' + maternalId, another)).text();
  assert.ok(!otherPage.includes(maternalId) && !otherPage.includes(values.nextAppointment));

  const visits = path + '/visits';
  const backdated = { ...values, requestKey: await formKey(path, worker), visitDate: '2025-04-08', nextAppointment: '2025-05-01' };
  assert.equal((await post(visits, backdated, worker)).status, 303);
  assert.equal(getMotherAppointments(db, internalId).next?.nextAppointment, values.nextAppointment);
  const cleared = { ...values, requestKey: await formKey(path, worker), visitDate: '2025-06-08', nextAppointment: '' };
  assert.equal((await post(visits, cleared, worker)).status, 303);
  const plan = getMotherAppointments(db, internalId);
  assert.equal(plan.next, null);
  assert.equal(plan.lastVisitDate, cleared.visitDate);
  assert.ok(plan.history.some(entry => entry.nextAppointment === values.nextAppointment));
});
