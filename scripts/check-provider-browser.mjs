// Run from the project root with node --import tsx scripts/check-provider-browser.mjs.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { openDatabase, migrate } from '../src/db.ts';
import { generateSeedSecrets, seedDatabase } from '../src/seed.ts';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : 'playwright');
const scratchParent = resolve(tmpdir());
const directory = await mkdtemp(join(scratchParent, 'tafiyar-provider-browser-'));
const credentials = generateSeedSecrets();
const databasePath = join(directory, 'fictional.sqlite');
let browser;
let server;
async function capture(page, name) {
  if (!process.env.PROVIDER_SCREENSHOT_DIRECTORY) return;
  const destination = resolve(process.env.PROVIDER_SCREENSHOT_DIRECTORY);
  await mkdir(destination, { recursive: true });
  await page.screenshot({ path: join(destination, name + '.png'), fullPage: true });
}
try {
  const db = openDatabase(databasePath);
  try {
    migrate(db);
    await seedDatabase(db, credentials);
  } finally { db.close(); }
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath,
      HOST: '127.0.0.1', PORT: String(port), APP_ORIGIN: origin, SESSION_SECRET: randomBytes(48).toString('hex') },
    windowsHide: true, stdio: 'inherit',
  });
  for (let i = 0; i < 80; i++) {
    if ((await fetch(origin + '/health').catch(() => null))?.ok) break;
    if (server.exitCode !== null) throw new Error('Server exited during startup.');
    await delay(200);
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: 360, height: 740 } });
  context.setDefaultTimeout(12000);
  const tab = await context.newPage();
  const errors = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  tab.on('pageerror', e => errors.push(e.message));

  async function login(page, role) {
    await page.goto(origin + '/login');
    await page.locator('[name=identifier]').fill(role);
    await page.locator('[name=password]').fill(credentials[role + 'Password']);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(origin + '/' + role);
  }
  async function openRecord(page, id, reason) {
    await page.goto(origin + '/provider?lang=ha');
    const form = page.locator('form[action="/provider/lookup"]');
    await form.locator('[name=maternalId]').fill(id);
    await form.locator('[name=reason]').fill(reason);
    await form.locator('button[type=submit]').click();
    await page.locator('#offline-link').waitFor();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  }
  const reasonA = 'Fictional antenatal referral review A';
  const reasonB = 'Fictional antenatal referral review B';
  const visitNote = 'Fictional clinic visit for provider browser verification';
  const worker = await browser.newPage();
  await login(worker, 'worker');
  await worker.goto(origin + '/worker/mothers/MC-7KQ4XM');
  const visitForm = worker.locator('form[action$="/visits"]');
  await visitForm.locator('[name=visitDate]').fill(new Date().toISOString().slice(0,10));
  await visitForm.locator('[name=weeksPregnant]').fill('24');
  await visitForm.locator('[name=bloodPressure]').fill('110/70');
  await visitForm.locator('[name=notes]').fill(visitNote);
  await visitForm.locator('button[type=submit]').click();
  await worker.waitForURL(/notice=visit-saved/);
  await worker.close();
  await login(tab, 'provider');
  await openRecord(tab, 'MC-7KQ4XM', reasonA);
  assert.ok((await tab.locator('#provider-record-content').textContent()).includes(visitNote));
  await capture(tab, 'provider-record');
  const allCached = await tab.evaluate(async () => {
    const cache = await caches.open((await caches.keys()).find(name => name.startsWith('tafiyar-provider-shell-')));
    const entries = await cache.keys();
    return Promise.all(entries.map(async entry => [new URL(entry.url).pathname, await (await cache.match(entry)).text()]));
  });
  assert.deepEqual(allCached.map(([path]) => path).sort(), ['/assets/app.css', '/assets/offline.js', '/offline']);
  assert.ok(!allCached.some(([, body]) => body.includes('MC-7KQ4XM') || body.includes(reasonA)));
  const second = await context.newPage();
  await second.goto(origin + '/provider');
  await context.setOffline(true);
  const unavailableServer = await tab.evaluate(() => fetch('/api/session').then(() => false, () => true));
  assert.ok(unavailableServer, 'browser network is disconnected');
  await tab.locator('#offline-link').click();
  await tab.locator('#offline-content').getByText('MC-7KQ4XM', { exact: true }).waitFor();
  await tab.reload();
  await tab.locator('#offline-content').getByText(reasonA, { exact: true }).waitFor();
  assert.equal(await tab.locator('html').getAttribute('lang'), 'ha');
  assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await tab.locator('#offline-content details summary').first().click();
  assert.ok((await tab.locator('#offline-content').innerText()).includes(visitNote));
  await capture(tab, 'provider-offline');
  const pending = await tab.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tafiyar.offline.audit.')).length);
  assert.equal(pending, 2, 'both offline accesses are queued');
  const storage = await tab.evaluate(() => JSON.stringify(localStorage));
  assert.ok(!storage.includes('MC-7KQ4XM') && !storage.includes(reasonA));
  // A fresh tab has no clinical record, even for the same authenticated browser.
  await second.goto(origin + '/offline');
  await second.locator('#offline-status').getByText(/No saved record/).waitFor();
  assert.equal(await second.locator('#offline-content').innerText(), '');
  await context.setOffline(false);
  await tab.waitForFunction(() => !Object.keys(localStorage).some(k => k.startsWith('tafiyar.offline.audit.')));
  await openRecord(second, 'MC-8RZ5TN', reasonB);
  await tab.waitForFunction(() => !document.querySelector('#offline-content').textContent);
  assert.equal(await tab.evaluate(() => sessionStorage.getItem('tafiyar.offline.record')), null);
  await second.locator('#offline-link').click();
  await second.locator('#offline-content').getByText('MC-8RZ5TN', { exact: true }).waitFor();

  await tab.goto(origin + '/provider');
  await tab.locator('form[action="/auth/logout"] button').click();
  await second.waitForFunction(() => !document.querySelector('#offline-content').textContent);
  await context.setOffline(true);
  await second.reload();
  await second.locator('#offline-status').getByText(/No saved record/).waitFor();
  assert.equal(await second.locator('#offline-content').innerText(), '');

  await context.setOffline(false);
  await login(tab, 'provider');
  await openRecord(tab, 'MC-8RZ5TN', reasonB);
  await tab.locator('#offline-clear').click();
  assert.equal(await tab.evaluate(() => sessionStorage.getItem('tafiyar.offline.record')), null);
  await tab.clock.install();
  await openRecord(tab, 'MC-8RZ5TN', reasonB);
  const recheck = tab.waitForResponse(response => response.url().endsWith('/api/provider/check-offline-copy'));
  await tab.locator('#offline-link').click();
  assert.equal((await recheck).status(), 204, 'reopening after clearing retains current-session permission');
  await tab.locator('#offline-content').getByText('MC-8RZ5TN', { exact: true }).waitFor();
  await context.setOffline(true);
  await tab.clock.runFor(31 * 60 * 1000);
  assert.equal(await tab.locator('#offline-content').innerText(), '');
  assert.equal(await tab.evaluate(() => sessionStorage.getItem('tafiyar.offline.record')), null);

  const admin = await browser.newPage();
  await login(admin, 'admin');
  await admin.goto(origin + '/admin/access-logs?lang=en');
  const rows = admin.locator('.audit-entry').filter({ hasText: reasonA });
  assert.equal(await rows.count(), 3, 'original lookup and both offline views reached the audit log');
  assert.equal(await rows.filter({ hasText: /offline/i }).count(), 2);
  await capture(admin, 'admin-access');
  assert.deepEqual(errors, []);
  console.log('Provider browser checks passed.');
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill();
    await stopped;
  }
  if (dirname(resolve(directory)) !== scratchParent || !resolve(directory).startsWith(join(scratchParent, 'tafiyar-provider-browser-'))) {
    throw new Error('Temporary browser test directory verification failed.');
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
}
