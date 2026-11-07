import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { migrate, openDatabase } from '../src/db.js';
import { generateSeedSecrets, seedDatabase } from '../src/seed.js';

const db = openDatabase(':memory:');
const credentials = generateSeedSecrets();
const origin = 'http://127.0.0.1:4317';
let app: Awaited<ReturnType<typeof createApp>>;
let provider: string;
let admin: string;

function form(path: string, fields: Record<string, string>, cookie = '') {
  return app.request(path, { method: 'POST', headers: { origin, cookie }, body: new URLSearchParams(fields) });
}
function postReceipt(path: string, data: unknown, cookie = '', from = origin) {
  return app.request('/api/provider/' + path, { method: 'POST', headers: {
    origin: from, cookie, 'content-type': 'application/json',
  }, body: JSON.stringify(data) });
}
async function login(identifier: string, password: string) {
  const response = await form('/auth/staff', { identifier, password });
  assert.equal(response.status, 303);
  return response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
}
before(async () => {
  migrate(db);
  await seedDatabase(db, credentials);
  app = await createApp(db, { origin, secureCookies: false, sessionSecret: randomBytes(48).toString('hex'), sessionSeconds: 1800 });
  provider = await login('provider@tafiyaruwa.test', credentials.providerPassword);
  admin = await login('admin@tafiyaruwa.test', credentials.adminPassword);
});
after(() => db.close());

test('the referral page validates the ID and reason, respects consent and keeps the admin log private', async () => {
  const reason = 'Review antenatal history for a referral';
  assert.equal((await form('/provider/lookup', { maternalId: 'MC-7KQ4XM', reason }, admin)).status, 403);
  assert.equal((await form('/provider/lookup', { maternalId: 'MC-7KQ4XM', reason })).status, 303);
  const invalid = await form('/provider/lookup', { maternalId: 'BAD', reason: ' ' }, provider);
  assert.equal(invalid.status, 422);
  assert.match(await invalid.text(), /Give a reason/);
  for (const maternalId of ['MC-3HW7SC', 'MC-ZZZZZZ']) {
    const denied = await form('/provider/lookup', { maternalId, reason }, provider);
    assert.equal(denied.status, 404);
    const html = await denied.text();
    assert.match(html, /This record is unavailable/);
    assert.doesNotMatch(html, /Demo Mother D|id="provider-snapshot"/);
  }
  assert.equal((await app.request('/admin/access-logs', { headers: { cookie: provider } })).status, 403);
  const log = await app.request('/admin/access-logs', { headers: { cookie: admin } });
  assert.equal(log.status, 200);
  assert.match(await log.text(), /MC-ZZZZZZ/);
  assert.equal((await app.request('/admin/access-logs?page=-2', { headers: { cookie: admin } })).status, 400);
});

test('a saved copy checks live consent and its original login; a delayed report can sync once after sign-out', async () => {
  const response = await form('/provider/lookup', { maternalId: 'mc-7kq4xm', reason: 'Review for referral' }, provider);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /Demo Mother A/);
  const attribute = html.match(/id="provider-snapshot" hidden data-payload="([^"]+)"/)?.[1];
  assert.ok(attribute);
  const snapshot = JSON.parse(attribute.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.ok(provider.includes('tafiyar_offline_session=' + snapshot.sessionKey));
  const { offlineGrant: grant, openedAt: viewedAt } = snapshot;
  const audit = { grant, viewedAt, eventId: randomUUID() };
  assert.equal((await postReceipt('check-offline-copy', { grant }, provider)).status, 204);
  assert.equal((await postReceipt('check-offline-copy', { grant }, admin)).status, 403);
  const differentLogin = await login('provider@tafiyaruwa.test', credentials.providerPassword);
  assert.equal((await postReceipt('check-offline-copy', { grant }, differentLogin)).status, 403);
  db.prepare('UPDATE mothers SET consent_to_share = 0 WHERE maternal_id = ?').run('MC-7KQ4XM');
  assert.equal((await postReceipt('check-offline-copy', { grant }, provider)).status, 403);
  assert.equal((await postReceipt('offline-access', audit, provider, 'https://other.test')).status, 403);
  assert.equal((await postReceipt('offline-access', { ...audit, grant: grant.slice(0,-10) })).status, 403);
  assert.equal((await postReceipt('offline-access', { ...audit, viewedAt: snapshot.expiresAt })).status, 422);
  const logout = await form('/auth/logout', {}, provider);
  assert.equal(logout.status, 303);
  assert.ok(logout.headers.getSetCookie().some(cookie => cookie.startsWith('tafiyar_offline_session=;')));
  assert.equal((await postReceipt('check-offline-copy', { grant }, provider)).status, 401);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await postReceipt('offline-access', audit);
    assert.equal(result.status, 204);
    assert.equal(await result.text(), '');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_logs WHERE event_id = ?').get(audit.eventId)!.n, 1);
});
