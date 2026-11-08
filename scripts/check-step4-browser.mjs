// Runs the five-point demo on a fresh local database. To check an existing deployment,
// pass DEMO_CHECK_ORIGIN and its three DEMO_CHECK_*_PASSWORD values explicitly.
import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { migrate, openDatabase } from '../src/db.ts';
import { generateSeedSecrets, seedDatabase } from '../src/seed.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const scratchParent = resolve(tmpdir());
let directory;
let server;
let browser;
let origin;
let passwords;
async function startLocalApp() {
  directory = await mkdtemp(join(scratchParent, 'tafiyar-step4-browser-'));
  const dbPath = join(directory, 'fictional.sqlite');
  const credentials = generateSeedSecrets();
  const db = openDatabase(dbPath);
  try {
    migrate(db);
    await seedDatabase(db, credentials);
  } finally { db.close(); }
  passwords = { worker: credentials.workerPassword, provider: credentials.providerPassword, admin: credentials.adminPassword };
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  origin = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: dbPath, HOST: '127.0.0.1', PORT: String(port),
      APP_ORIGIN: origin, SESSION_SECRET: randomBytes(48).toString('hex') }, windowsHide: true, stdio: 'ignore',
  });
  for (let i = 0; i < 80; i++) {
    if ((await fetch(origin + '/health').catch(() => null))?.ok) return;
    if (server.exitCode !== null) break;
    await delay(200);
  }
  throw new Error('The local test server could not start.');
}
async function signIn(page, role) {
  await page.goto(origin + '/login');
  const form = page.locator('form[action^="/auth/staff"]');
  await form.locator('[name=identifier]').fill(role + '@tafiyaruwa.test');
  await form.locator('[name=password]').fill(passwords[role]);
  await form.locator('button[type=submit]').click();
  await page.waitForURL(url => url.pathname === '/' + role);
}
async function assertFits(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'Screen extends beyond the viewport at ' + new URL(page.url()).pathname);
}
async function capture(page, name) {
  if (!process.env.DEMO_CHECK_SCREENSHOTS) return;
  const destination = resolve(process.env.DEMO_CHECK_SCREENSHOTS);
  await mkdir(destination, { recursive: true });
  await page.screenshot({ path: join(destination, name + '.png'), fullPage: true });
}

try {
  if (process.env.DEMO_CHECK_ORIGIN) {
    const target = new URL(process.env.DEMO_CHECK_ORIGIN);
    assert.ok(target.origin === target.href.replace(/\/$/, ''), 'Supply only the demo origin.');
    assert.ok(target.protocol === 'https:' || ['localhost','127.0.0.1'].includes(target.hostname), 'Use an HTTPS deployment or loopback.');
    origin = target.origin;
    passwords = Object.fromEntries(['worker', 'admin', 'provider'].map(role => {
      const value = process.env['DEMO_CHECK_' + role.toUpperCase() + '_PASSWORD'];
      assert.ok(value, 'Supply the dedicated demo password for ' + role);
      return [role, value];
    }));
  } else {
    await startLocalApp();
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  const worker = await browser.newPage({ viewport: { width: 320, height: 740 } });
  await signIn(worker, 'worker');
  await worker.locator('a[href="/worker/register"]').click();
  await assertFits(worker);
  const signup = worker.locator('form[action="/worker/register"]');
  const pin = String(randomInt(10_000_000, 100_000_000));
  await signup.locator('[name=name]').fill('Fictional Demo Check');
  await signup.locator('[name=age]').fill('27');
  await signup.locator('[name=language]').selectOption('ha');
  await signup.locator('[name=pin]').fill(pin);
  await signup.locator('[name=pinConfirm]').fill(pin);
  await signup.locator('[name=consentToShare]').check();
  await signup.locator('button[type=submit]').click();
  await worker.waitForURL(/\/worker\/mothers\/MC-[A-HJ-NP-Z2-9]{6}/);
  const maternalId = new URL(worker.url()).pathname.split('/').at(-1);
  const clinicalNote = 'Fictional continuity demonstration visit';
  const date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const visit = worker.locator('form[action$="/visits"]');
  await visit.locator('[name=visitDate]').fill(new Date().toISOString().slice(0, 10));
  await visit.locator('[name=weeksPregnant]').fill('24');
  await visit.locator('[name=bloodPressure]').fill('110/70');
  await visit.locator('[name=notes]').fill(clinicalNote);
  await visit.locator('[name=nextAppointment]').fill(date);
  await visit.locator('button[type=submit]').click();
  await worker.waitForURL(/notice=visit-saved/);
  await assertFits(worker);
  const reminder = await worker.locator('.reminder-preview-label + blockquote').innerText();
  assert.doesNotMatch(reminder, /MC-|Fictional|pregnan|antenatal|juna biyu|ciki|awo|Gombe/i);
  await worker.locator('form[action$="/reminders"] button').click();
  await worker.waitForURL(url => url.pathname === '/worker/outbox');
  await assertFits(worker);
  const workerRow = worker.locator('.outbox-entry').filter({ hasText: maternalId });
  assert.equal(await workerRow.locator('blockquote[lang="ha"]').innerText(), reminder);
  await capture(worker, 'worker-outbox-mobile');

  const mother = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 740 } });
  for (const lang of ['ha', 'en']) {
    await mother.goto(origin + '/login?kind=mother');
    await mother.locator('a[href^="/simulator"]').click();
    await mother.locator('a[href="/simulator/login?lang=' + lang + '"]').click();
    await assertFits(mother);
    const login = mother.locator('form[action^="/auth/mother"]');
    await login.locator('[name=maternalId]').fill(maternalId);
    await login.locator('[name=pin]').fill(pin);
    await login.locator('button[type=submit]').click();
    await mother.waitForURL(url => url.pathname === '/simulator/menu');
    assert.equal(await mother.locator('html').getAttribute('lang'), lang);
    assert.equal(await mother.locator('.simulation-banner').innerText(), 'SIMULATION');
    await assertFits(mother);
    await mother.locator('a[href^="/simulator/appointment"]').click();
    await mother.locator('time[datetime="' + date + '"]').waitFor();
    const expectedMonth = new Intl.DateTimeFormat(lang === 'ha' ? 'ha-NG' : 'en-NG', { month: 'long', timeZone: 'UTC' }).format(new Date(date));
    assert.ok((await mother.locator('time[datetime="' + date + '"]').innerText()).includes(expectedMonth), 'Appointment month uses the selected language.');
    assert.ok(!(await mother.locator('main').innerText()).includes(clinicalNote));
    await assertFits(mother);
    await capture(mother, 'simulator-appointment-' + lang);
    await mother.locator('a[href^="/simulator/menu"]').click();
    await mother.locator('a[href^="/simulator/tip"]').click();
    assert.ok(await mother.locator('a[href^="https://www.who.int/"]').count() > 0);
    await assertFits(mother);
    await mother.goto(origin + '/mother');
    await mother.locator('time[datetime="' + date + '"]').waitFor();
    await assertFits(mother);
    await mother.goto(origin + '/simulator/menu?lang=' + lang);
    await mother.locator('form[action^="/auth/logout"] button').click();
    await mother.goto(origin + '/simulator/appointment');
    assert.equal(await mother.locator('time[datetime="' + date + '"]').count(), 0);
  }

  const provider = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(provider, 'provider');
  await provider.goto(origin + '/provider?lang=ha');
  const lookup = provider.locator('form[action="/provider/lookup"]');
  const reason = 'Fictional referral review ' + maternalId;
  await lookup.locator('[name=maternalId]').fill(maternalId);
  await lookup.locator('[name=reason]').fill(reason);
  await lookup.locator('button[type=submit]').click();
  await provider.locator('#provider-record-content').waitFor();
  assert.ok((await provider.locator('#provider-record-content').textContent()).includes(clinicalNote));
  await assertFits(provider);
  await provider.waitForFunction(() => Boolean(navigator.serviceWorker.controller) && Boolean(sessionStorage.getItem('tafiyar.offline.record')));
  await provider.context().setOffline(true);
  await provider.locator('#offline-link').click();
  await provider.locator('#offline-content').getByText(maternalId, { exact: true }).waitFor();
  await provider.reload();
  await provider.locator('#offline-content').getByText(reason, { exact: true }).waitFor();
  assert.equal(await provider.locator('html').getAttribute('lang'), 'ha');
  await provider.locator('#offline-content details summary').first().click();
  assert.ok((await provider.locator('#offline-content').innerText()).includes(clinicalNote));
  await assertFits(provider);
  await capture(provider, 'provider-offline-ha');
  await provider.context().setOffline(false);
  await provider.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('tafiyar.offline.audit.')));

  const admin = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await signIn(admin, 'admin');
  await admin.locator('a[href^="/admin/outbox"]').click();
  const adminRow = admin.locator('.outbox-entry').filter({ hasText: maternalId });
  assert.equal(await adminRow.locator('blockquote').innerText(), reminder);
  await assertFits(admin);
  await capture(admin, 'admin-outbox-desktop');
  await admin.locator('a[href="/admin"]').click();
  await admin.locator('a[href^="/admin/access-logs"]').click();
  assert.ok(await admin.locator('.audit-entry').filter({ hasText: reason }).count() > 0);
  assert.equal(await admin.locator('.audit-entry').filter({ hasText: reason }).count(), 3, 'Online lookup and both offline openings reach the admin log.');
  console.log('Browser checks passed for worker registration and visit, bilingual appointments and simulator, per-clinic reminder, provider lookup, offline viewing and administrator audit.');
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const finished = once(server, 'exit');
    server.kill();
    await finished;
  }
  if (directory && dirname(resolve(directory)) === scratchParent && resolve(directory).startsWith(join(scratchParent, 'tafiyar-step4-browser-'))) {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
}
