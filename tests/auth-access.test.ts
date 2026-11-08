import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { openDatabase, migrate } from '../src/db.js';
import { generateSeedSecrets, seedDatabase } from '../src/seed.js';
import { signSession } from '../src/crypto.js';
import type { AppConfig } from '../src/config.js';

// All identities below belong to the fictional seed dataset. Credentials are
// generated per test run and are never written to fixtures or test output.
const credentials = generateSeedSecrets();
const config: AppConfig = {
  origin: 'http://127.0.0.1:4317',
  sessionSecret: randomBytes(48).toString('hex'),
  secureCookies: false,
  sessionSeconds: 1800,
};
const db = openDatabase(':memory:');
let app: Awaited<ReturnType<typeof createApp>>;
const cookies = new Map<string, string>();

function request(path: string, init: RequestInit = {}) {
  return app.request(new Request(`${config.origin}${path}`, init));
}
function post(path: string, fields: Record<string, string>, cookie?: string, origin = config.origin) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin, ...(cookie ? { cookie } : {}) },
    body: new URLSearchParams(fields).toString(),
  });
}
function authenticated(path: string, role: string) {
  return request(path, { headers: { cookie: cookies.get(role)! } });
}
function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie');
  assert.ok(header, 'successful login must issue a session cookie');
  return header.split(';')[0]!;
}

before(async () => {
  migrate(db);
  await seedDatabase(db, credentials);
  app = await createApp(db, config);
  const accounts = [
    ['admin', 'admin@tafiyaruwa.test', credentials.adminPassword, '/admin'],
    ['health_worker', 'worker@tafiyaruwa.test', credentials.workerPassword, '/worker'],
    ['provider', 'provider@tafiyaruwa.test', credentials.providerPassword, '/provider'],
  ];
  for (const [role, identifier, password, destination] of accounts) {
    const response = await post('/auth/staff', { identifier: identifier!, password: password! });
    assert.equal(response.status, 303, `${role} should sign in`);
    assert.equal(response.headers.get('location'), destination);
    cookies.set(role!, cookieFrom(response));
  }
  const response = await post('/auth/mother', { maternalId: 'MC-7KQ4XM', pin: credentials.motherPins[0]! });
  assert.equal(response.status, 303, 'mother should sign in');
  assert.equal(response.headers.get('location'), '/mother');
  cookies.set('mother', cookieFrom(response));
});

after(() => db.close());

test('anonymous callers cannot open any protected API or workspace', async () => {
  for (const path of ['/api/session', '/api/admin/directory', '/api/worker/workspace', '/api/provider/workspace', '/api/mother/profile']) {
    assert.equal((await request(path)).status, 401, path);
  }
  for (const path of ['/admin', '/worker', '/provider', '/mother']) {
    const response = await request(path);
    assert.equal(response.status, 303, path);
    assert.ok(response.headers.get('location')?.startsWith('/login'), 'anonymous page redirects to login');
  }
});

test('server enforces every pair of role and protected workspace', async () => {
  const destinations = {
    admin: ['/admin', '/api/admin/directory'],
    health_worker: ['/worker', '/api/worker/workspace'],
    provider: ['/provider', '/api/provider/workspace'],
    mother: ['/mother', '/api/mother/profile'],
  };
  for (const signedInRole of Object.keys(destinations)) {
    for (const [requiredRole, paths] of Object.entries(destinations)) {
      for (const path of paths) {
        const response = await authenticated(path, signedInRole);
        assert.equal(response.status, signedInRole === requiredRole ? 200 : 403, `${signedInRole} requesting ${path}`);
      }
    }
    assert.equal((await authenticated('/api/session', signedInRole)).status, 200);
  }
});

test('mothers can see only their own identity even when another record is requested', async () => {
  const otherLogin = await post('/auth/mother', { maternalId: 'MC-8RZ5TN', pin: credentials.motherPins[0]! });
  assert.equal(otherLogin.status, 401, 'one mother cannot sign in with her PIN and another mother’s ID');
  assert.equal(otherLogin.headers.get('set-cookie'), null);
  const response = await authenticated('/api/mother/profile?motherId=2&maternalId=MC-8RZ5TN', 'mother');
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(text.includes('MC-7KQ4XM'), 'own maternal ID is returned');
  assert.ok(!text.includes('MC-8RZ5TN'), 'another maternal ID is not returned');
  const second = db.prepare('SELECT name FROM mothers WHERE maternal_id = ?').get('MC-8RZ5TN') as { name: string };
  assert.ok(!text.includes(second.name), 'another mother’s name is not returned');
});

test('public responses and role APIs never expose password hashes or PINs', async () => {
  const checks: [string, string | undefined][] = [
    ['/login', undefined], ['/login?kind=mother', undefined],
    ['/api/admin/directory', 'admin'], ['/api/session', 'admin'],
    ['/api/worker/workspace', 'health_worker'], ['/api/provider/workspace', 'provider'],
    ['/api/mother/profile', 'mother'], ['/api/session', 'mother'],
  ];
  for (const [path, role] of checks) {
    const response = role ? await authenticated(path, role) : await request(path);
    const text = await response.text();
    assert.ok(!text.includes('scrypt$'), `${path} contains no hash`);
    assert.ok(!/password_hash|pin_hash/.test(text), `${path} contains no secret database fields`);
    for (const secret of Object.values(credentials).flat()) assert.ok(!text.includes(secret), `${path} contains no raw credential`);
    assert.ok(!text.includes(config.sessionSecret), `${path} contains no signing key`);
  }
});

test('staff workspaces do not expose patient records before audited look-up exists', async () => {
  const mothers = db.prepare('SELECT name, maternal_id FROM mothers').all() as { name: string; maternal_id: string }[];
  for (const [path, role] of [['/admin', 'admin'], ['/worker', 'health_worker'], ['/provider', 'provider']]) {
    const text = await (await authenticated(path!, role!)).text();
    for (const mother of mothers) {
      assert.ok(!text.includes(mother.name), `${role} workspace must not disclose mother names`);
      assert.ok(!text.includes(mother.maternal_id), `${role} workspace must not disclose maternal IDs`);
    }
  }
});

test('credential errors are generic for known, unknown and injection-shaped identifiers', async () => {
  const wrongPassword = randomBytes(24).toString('hex');
  const known = await post('/auth/staff', { identifier: 'worker2@tafiyaruwa.test', password: wrongPassword });
  const unknown = await post('/auth/staff', { identifier: 'absent@tafiyaruwa.test', password: wrongPassword });
  const injection = await post('/auth/staff', { identifier: "' OR 1=1 --", password: wrongPassword });
  assert.equal(known.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(injection.status, 401);
  assert.equal(await known.text(), await unknown.text(), 'unknown and incorrect account errors must match');
  assert.equal(known.headers.get('set-cookie'), null);
});

test('staff sign in with their saved email after whitespace and case normalization', async () => {
  const accounts = [
    ['admin', credentials.adminPassword, '/admin'],
    ['worker', credentials.workerPassword, '/worker'],
    ['provider', credentials.providerPassword, '/provider'],
    ['worker2', credentials.worker2Password, '/worker'],
  ];
  for (const [name, password, destination] of accounts) {
    const email = `${name}@tafiyaruwa.test`;
    for (const identifier of [email, `  ${email.toUpperCase()}  `]) {
      const response = await post('/auth/staff', { identifier, password: password! });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), destination);
    }
  }
});

test('staff sign-in follows the current contact when an address changes ownership', async () => {
  db.prepare('UPDATE users SET email = ? WHERE id = 2').run('personal@example.test');
  try {
    assert.equal((await post('/auth/staff', { identifier: 'worker@tafiyaruwa.test', password: credentials.workerPassword })).status, 401);
    assert.equal((await post('/auth/staff', { identifier: 'personal@example.test', password: credentials.workerPassword })).status, 303);
    db.prepare(`INSERT INTO users(id, role, name, email, password_hash, facility_id)
      SELECT 99, 'health_worker', 'Custom Demonstration Account', 'worker@tafiyaruwa.test', password_hash, 2
      FROM users WHERE id = 4`).run();
    assert.equal((await post('/auth/staff', { identifier: 'worker@tafiyaruwa.test', password: credentials.workerPassword })).status, 401);
    const direct = await post('/auth/staff', { identifier: 'worker@tafiyaruwa.test', password: credentials.worker2Password });
    assert.equal(direct.status, 303);
    const profile = await request('/api/session', { headers: { cookie: cookieFrom(direct) } });
    assert.equal((await profile.json()).name, 'Custom Demonstration Account');
  } finally {
    db.prepare('DELETE FROM users WHERE id = 99').run();
    db.prepare('UPDATE users SET email = ? WHERE id = 2').run('worker@tafiyaruwa.test');
  }
});

test('browser sign-in and sign-out forms retain their origin for native form submissions', async () => {
  for (const kind of ['mother', 'staff']) {
    const page = await request(`/login?kind=${kind}`);
    assert.equal(page.headers.get('referrer-policy'), 'same-origin');
    assert.ok((await page.text()).includes(`action="/auth/${kind}"`));
    const reopened = await request(`/auth/${kind}`);
    assert.equal(reopened.status, 303);
    assert.equal(reopened.headers.get('location'), `/login?kind=${kind}`);
  }
  const dashboard = await authenticated('/mother', 'mother');
  assert.equal(dashboard.headers.get('referrer-policy'), 'same-origin');
  assert.ok((await dashboard.text()).includes('action="/auth/logout"'));
});

test('a browser with a hidden form origin can retry safely from the mother sign-in page', async () => {
  const rejected = await request('/auth/mother', {
    method: 'POST', headers: { origin: 'null', accept: 'text/html' },
    body: new URLSearchParams({ maternalId: 'MC-7KQ4XM', pin: credentials.motherPins[0]! }),
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('set-cookie'), null);
  assert.equal(rejected.headers.get('referrer-policy'), 'same-origin');
  const page = await rejected.text();
  assert.ok(page.includes('action="/auth/mother"'));
  assert.ok(!page.includes(credentials.motherPins[0]!));
});

test('cross-origin, missing-origin and malformed login submissions are rejected', async () => {
  const fields = { identifier: 'admin@tafiyaruwa.test', password: credentials.adminPassword };
  assert.equal((await post('/auth/staff', fields, undefined, 'https://untrusted.example')).status, 403);
  assert.equal((await request('/auth/staff', { method: 'POST', body: new URLSearchParams(fields) })).status, 403);
  assert.equal((await request('/auth/staff', {
    method: 'POST', headers: { origin: config.origin, 'content-type': 'application/json' }, body: '{}',
  })).status, 400);
  assert.equal((await post('/auth/staff', {})).status, 400);
  assert.equal((await post('/auth/mother', {})).status, 400);
});

test('session cookies are HttpOnly and SameSite Strict, and production cookies are Secure', async () => {
  const response = await post('/auth/staff', { identifier: 'worker2@tafiyaruwa.test', password: credentials.worker2Password });
  assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie') ?? '';
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\//i);
  const httpsConfig = { ...config, origin: 'https://demo.tafiyaruwa.test', secureCookies: true };
  const httpsApp = await createApp(db, httpsConfig);
  const httpsResponse = await httpsApp.request(new Request(`${httpsConfig.origin}/auth/staff`, {
    method: 'POST', headers: { origin: httpsConfig.origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ identifier: 'worker2@tafiyaruwa.test', password: credentials.worker2Password }),
  }));
  assert.equal(httpsResponse.status, 303);
  const secureCookie = httpsResponse.headers.get('set-cookie') ?? '';
  assert.match(secureCookie, /^__Host-mc_session=/);
  assert.match(secureCookie, /; Secure/i);
  assert.ok(!/Domain=/i.test(secureCookie), 'host-only cookie must not have a Domain attribute');
});

test('tampered and expired cookies cannot authenticate', async () => {
  const good = cookies.get('mother')!;
  const changed = good.slice(0, -5) + (good.at(-5) === 'a' ? 'b' : 'a') + good.slice(-4);
  assert.equal((await request('/api/session', { headers: { cookie: changed } })).status, 401);
  const expired = signSession({ type: 'mother', id: 1, version: 0, expires: Math.floor(Date.now() / 1000) - 60, nonce: randomBytes(16).toString('hex') }, config.sessionSecret);
  assert.equal((await request('/api/session', { headers: { cookie: `mc_session=${expired}` } })).status, 401);
});

test('server reads current roles and account activation on every request', async () => {
  db.prepare('UPDATE users SET role = ? WHERE email = ?').run('provider', 'worker@tafiyaruwa.test');
  assert.equal((await authenticated('/api/worker/workspace', 'health_worker')).status, 403);
  assert.equal((await authenticated('/api/provider/workspace', 'health_worker')).status, 200);
  db.prepare('UPDATE users SET role = ? WHERE email = ?').run('health_worker', 'worker@tafiyaruwa.test');
  db.prepare('UPDATE users SET active = 0 WHERE email = ?').run('provider@tafiyaruwa.test');
  assert.equal((await authenticated('/api/session', 'provider')).status, 401);
  assert.equal((await post('/auth/staff', { identifier: 'provider@tafiyaruwa.test', password: credentials.providerPassword })).status, 401);
  db.prepare('UPDATE users SET active = 1 WHERE email = ?').run('provider@tafiyaruwa.test');
});

test('signing out revokes a copied session cookie, not only the browser cookie', async () => {
  const oldCookie = cookies.get('admin')!;
  const response = await post('/auth/logout', {}, oldCookie);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/login?notice=signed-out');
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  assert.equal((await request('/api/session', { headers: { cookie: oldCookie } })).status, 401);
});

test('five simultaneous wrong PINs lock the account until expiry', async () => {
  const correctPin = credentials.motherPins[4]!;
  const wrongPin = String((Number(correctPin) + 1) % 100_000_000).padStart(8, '0');
  const attempts = await Promise.all(Array.from({ length: 5 }, () =>
    post('/auth/mother', { maternalId: 'MC-9BX2RA', pin: wrongPin })));
  for (const response of attempts) assert.equal(response.status, 401);
  const locked = db.prepare('SELECT failed_attempts, locked_until FROM mothers WHERE maternal_id = ?').get('MC-9BX2RA') as { failed_attempts: number; locked_until: number };
  assert.equal(locked.failed_attempts, 5);
  assert.ok(locked.locked_until > Date.now());
  const response = await post('/auth/mother', { maternalId: 'MC-9BX2RA', pin: correctPin });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  db.prepare('UPDATE mothers SET locked_until = ? WHERE maternal_id = ?').run(Date.now() - 1, 'MC-9BX2RA');
  assert.equal((await post('/auth/mother', { maternalId: 'MC-9BX2RA', pin: wrongPin })).status, 401);
  assert.equal((await post('/auth/mother', { maternalId: 'MC-9BX2RA', pin: correctPin })).status, 303);
});

test('repeated successful sign-ins do not use up the guessing limit', async () => {
  const fields = { identifier: 'admin@tafiyaruwa.test', password: credentials.adminPassword };
  for (let i = 0; i < 13; i++) {
    assert.equal((await post('/auth/staff', fields)).status, 303);
  }
});
