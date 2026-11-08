import { serve } from '@hono/node-server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { databasePath, loadConfig } from './config.js';
import { openDatabase, ensureMigrated } from './db.js';
import { createApp } from './app.js';
import { publicAssetRoutes } from './public-assets.js';

const config = loadConfig();
const db = openDatabase(databasePath());
ensureMigrated(db);
const app = await createApp(db, config);
const publicApp = publicAssetRoutes(name => readFileSync(resolve('public', name), 'utf8'));
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
