import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { demoHashes, generateSeedSettings, seedSecretsFromEnv } from '../src/seed.js';

const action = process.argv[2];
if (action !== 'local' && action !== 'deploy') throw new Error('Choose local or deploy.');
const file = action === 'deploy' ? '.env.cloud-demo' : '.env';
if (action === 'deploy') {
  const settings = { SESSION_SECRET: randomBytes(48).toString('hex'), ...generateSeedSettings() };
  try {
    writeFileSync(file, Object.entries(settings).map(([key, value]) => key + '=' + value).join('\n') + '\n',
      { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}
const settings = parse(readFileSync(file));
const credentials = seedSecretsFromEnv(settings);
if (!settings.SESSION_SECRET || settings.SESSION_SECRET.length < 48) throw new Error('Missing session secret in ' + file);
const bindings = {
  SESSION_SECRET: settings.SESSION_SECRET,
  SEED_HASHES: JSON.stringify(await demoHashes(credentials, settings.DEMO_REGISTERED_PINS)),
};
if (action === 'local') {
  writeFileSync('.dev.vars', Object.entries(bindings).map(([key, value]) => key + "='" + value + "'").join('\n') + '\n', { mode: 0o600 });
  console.log('Local Worker bindings prepared. Use the local fictional accounts from .env.');
} else {
  // Wrangler uploads only the session key and salted hashes to the named Worker.
  mkdirSync('.wrangler', { recursive: true });
  const temporary = resolve('.wrangler', 'bindings-' + randomUUID() + '.json');
  writeFileSync(temporary, JSON.stringify(bindings), { flag: 'wx', mode: 0o600 });
  try {
    const result = spawnSync(process.execPath, [resolve('node_modules/wrangler/bin/wrangler.js'), 'deploy',
      '--config', 'wrangler.jsonc', '--secrets-file', temporary], { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { unlinkSync(temporary); }
}
