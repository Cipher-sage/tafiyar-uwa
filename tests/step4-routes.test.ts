import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db.js';
import { generateSeedSecrets, seedDatabase } from '../src/seed.js';

const origin = 'http://127.0.0.1:4317';
const db = openDatabase(':memory:');
const credentials = generateSeedSecrets();
const ownId = 'MC-7KQ4XM';
const otherId = 'MC-6VP9KD';
const ownDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const otherDate = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
const clinicalNote = 'Fictional test note for staff only';
const simulatorLogin = '/auth/mother?returnTo=simulator&lang=ha';
let app: Awaited<ReturnType<typeof createApp>>;
let worker: string;
let otherClinic: string;
let admin: string;
let provider: string;

function get(path: string, cookie = '') {
  return app.request(origin + path, { headers: { cookie } });
}
function post(path: string, fields: Record<string, string>, cookie = '', source = origin) {
  return app.request(origin + path, {
    method: 'POST', headers: { cookie, origin: source }, body: new URLSearchParams(fields),
  });
}
function cookies(response: Response) {
  assert.equal(response.status, 303);
  return response.headers.getSetCookie().map(header => header.split(';')[0]).join('; ');
}

before(async () => {
  migrate(db);
  await seedDatabase(db, credentials);
  const visit = db.prepare('INSERT INTO visits(mother_id, facility_id, visit_date, notes, recorded_by, next_appointment) VALUES (?, ?, ?, ?, ?, ?)');
  const today = new Date().toISOString().slice(0, 10);
  visit.run(1, 1, today, clinicalNote, 2, ownDate);
  visit.run(3, 2, today, clinicalNote, 4, otherDate);
  app = await createApp(db, { origin, sessionSecret: randomBytes(48).toString('hex'), secureCookies: false, sessionSeconds: 1800 });
  async function staff(email: string, password: string) {
    return cookies(await post('/auth/staff', { identifier: email + '@tafiyaruwa.test', password }));
  }
  worker = await staff('worker', credentials.workerPassword);
  otherClinic = await staff('worker2', credentials.worker2Password);
  admin = await staff('admin', credentials.adminPassword);
  provider = await staff('provider', credentials.providerPassword);
});
after(() => db.close());

test('simulator requires maternal sign-in, serves only the signed-in appointment, and ends access on exit', async () => {
  for (const path of ['/simulator/menu', '/simulator/appointment', '/simulator/tip']) {
    assert.equal((await get(path)).status, 303);
    assert.equal((await get(path, worker)).status, 403);
  }
  const wrong = await post(simulatorLogin, { maternalId: ownId, pin: credentials.motherPins[1]! });
  assert.equal(wrong.status, 401);
  assert.match(await wrong.text(), /SIMULATION/);
  const blocked = await post(simulatorLogin, { maternalId: ownId, pin: credentials.motherPins[0]! }, '', 'https://example.org');
  assert.equal(blocked.status, 403);
  const loggedIn = await post(simulatorLogin, { maternalId: ownId, pin: credentials.motherPins[0]! });
  const mother = cookies(loggedIn);
  assert.equal(new URL(loggedIn.headers.get('location')!, origin).pathname, '/simulator/menu');
  const result = await get('/simulator/appointment?lang=ha&maternalId=' + otherId + '&motherId=3', mother);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const html = await result.text();
  assert.match(html, /<html lang="ha"/);
  assert.ok(html.includes('SIMULATION') && html.includes(ownDate));
  assert.ok(!html.includes(otherDate) && !html.includes(clinicalNote));
  const tip = await get('/simulator/tip?lang=en', mother);
  assert.equal(tip.status, 200);
  assert.match(await tip.text(), /https:\/\/www\.who\.int\//);
  assert.equal((await get('/worker/outbox', mother)).status, 403);
  assert.equal((await get('/admin/outbox', mother)).status, 403);
  assert.equal((await post('/auth/logout?returnTo=simulator', {}, mother)).status, 303);
  assert.equal((await get('/simulator/menu', mother)).status, 303);
});

test('a reminder stays inside the originating clinic outbox and repeated form posts produce one message', async () => {
  const path = '/worker/mothers/' + ownId + '/reminders';
  const key = { requestKey: randomUUID() };
  assert.equal((await post(path, key, worker, 'https://example.org')).status, 403);
  assert.equal((await post(path, key, otherClinic)).status, 404);
  assert.equal((await post(path, key, admin)).status, 403);
  assert.equal((await post(path, key, provider)).status, 403);
  assert.equal((await post(path, key)).status, 303);
  assert.equal((await get('/admin/outbox', worker)).status, 403);
  assert.equal((await get('/worker/outbox', provider)).status, 403);
  assert.equal((await get('/admin/outbox')).status, 303);
  let messages = db.prepare('SELECT COUNT(*) AS n FROM sms_outbox').get();
  assert.equal(messages?.n, 0);
  for (const notice of ['queued', 'duplicate']) {
    const response = await post(path, key, worker);
    assert.equal(response.status, 303);
    const url = new URL(response.headers.get('location')!, origin);
    assert.equal(url.pathname, '/worker/outbox');
    assert.equal(url.searchParams.get('notice'), notice);
  }
  messages = db.prepare('SELECT COUNT(*) AS n FROM sms_outbox').get();
  assert.equal(messages?.n, 1);
  for (const [path, cookie] of [['/worker/outbox', worker], ['/admin/outbox', admin]] as const) {
    const result = await get(path, cookie);
    assert.equal(result.status, 200);
    const html = await result.text();
    assert.ok(html.includes(ownId) && !html.includes(clinicalNote));
    const message = /<blockquote[^>]+lang="ha"[^>]*>([^<]+)<\/blockquote>/.exec(html)?.[1];
    assert.ok(message);
    assert.doesNotMatch(message, /MC-|Demo Mother|pregnan|antenatal|juna biyu|ciki|awo|Gombe/i);
  }
  const unshared = await get('/worker/outbox?facility_id=1', otherClinic);
  assert.equal(unshared.status, 200);
  assert.ok(!(await unshared.text()).includes(ownId));
});
