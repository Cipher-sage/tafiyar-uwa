import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { databasePath, loadConfig } from './config.js';
import { openDatabase, ensureMigrated } from './db.js';
import { createApp } from './app.js';
import en from './locales/en.json' with { type: 'json' };
import ha from './locales/ha.json' with { type: 'json' };

const config = loadConfig();
const db = openDatabase(databasePath());
ensureMigrated(db);
const app = await createApp(db, config);
const offlineText: Record<string, string> = { brand: en.brand };
for (const [language, copy] of [['en', en.offline], ['ha', ha.offline]] as const) {
  for (const [key, value] of Object.entries(copy)) offlineText[language + '.' + key] = value;
}
const htmlEscapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// The cached shell includes only generic bilingual copy and never uses a signed-in identity.
const offlinePage = readFileSync(resolve('public/offline.html'), 'utf8').replace(/\{\{([\w.]+)\}\}/g, (_match, key: string) => {
  const text = offlineText[key];
  if (text === undefined) throw new Error('Missing offline interface translation.');
  return text.replace(/[&<>"']/g, character => htmlEscapes[character]!);
});
// Only explicitly named public files are served. No directory browsing or project-file access.
const publicApp = new Hono();
const assets = [
  ['/assets/app.css', 'app.css', 'text/css'],
  ['/assets/app.js', 'app.js', 'application/javascript'],
  ['/assets/offline.js', 'offline.js', 'application/javascript'],
  ['/sw.js', 'sw.js', 'application/javascript'],
  ['/offline', 'offline.html', 'text/html'],
] as const;
for (const [path, name, type] of assets) {
  publicApp.get(path, c => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-cache');
    // Keep the offline page in the same browsing context as authenticated pages.
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Referrer-Policy', 'same-origin');
    c.header('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const body = path === '/offline' ? offlinePage : readFileSync(resolve('public', name), 'utf8');
    return c.body(body, 200, { 'Content-Type': type + '; charset=utf-8' });
  });
}
publicApp.route('/', app);
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number.');
const hostname = process.env.HOST ?? '127.0.0.1';
const server = serve({ fetch: publicApp.fetch, hostname, port }, () => console.log(`Maternal Continuity demo ready at ${config.origin}`));
let closing = false;
const stop = () => {
  if (closing) return;
  closing = true;
  server.close(() => { db.close(); process.exit(0); });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
