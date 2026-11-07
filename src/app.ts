import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import type { Database } from './db.js';
import type { AppConfig } from './config.js';
import { hashSecret, verifySecret } from './crypto.js';
import { identify, establishSession, clearSession, homeFor, LoginThrottle, type AppEnv, type Role } from './auth.js';
import { loginPage, dashboardPage, errorPage } from './views.js';
import en from './locales/en.json' with { type: 'json' };
import { addCareRoutes } from './care-routes.js';
import { addProviderRoutes } from './provider-routes.js';
import { interfaceLanguage, rememberLanguage } from './interface-language.js';
import { getCopy } from './i18n.js';

interface AccountRow { id: number; secret_hash: string; session_version: number }

// This factory has no network or database side effects; tests exercise real routes in memory.
export async function createApp(db: Database, config: AppConfig): Promise<Hono<AppEnv>> {
  const app = new Hono<AppEnv>();
  const dummyHash = await hashSecret(randomBytes(32).toString('hex'));
  const throttle = new LoginThrottle();
  const legacyDemoAccount = db.prepare(`WITH demo(id, old_email, new_email) AS (
      VALUES (1, 'admin@nextkind.test', 'admin@tafiyaruwa.test'),
             (2, 'worker@nextkind.test', 'worker@tafiyaruwa.test'),
             (3, 'provider@nextkind.test', 'provider@tafiyaruwa.test'),
             (4, 'worker2@nextkind.test', 'worker2@tafiyaruwa.test')
    ) SELECT users.id, users.password_hash AS secret_hash, users.session_version
      FROM users JOIN demo ON users.id = demo.id AND users.email = demo.new_email
      WHERE demo.old_email = ?`);
  app.use('*', secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'], fontSrc: ["'self'"], connectSrc: ["'self'"],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'self'"],
    // A native form POST needs its same-origin Origin header for the check below.
    }, referrerPolicy: 'same-origin', xFrameOptions: 'DENY',
  }));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const language = interfaceLanguage(c);
    const copy = getCopy(language);
    if (c.req.method === 'GET' && ['en', 'ha'].includes(c.req.query('lang') ?? '')) {
      rememberLanguage(c, language, config.secureCookies);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('Origin') !== config.origin) {
      if (c.req.header('Accept')?.includes('text/html')) {
        if (c.req.path === '/auth/staff' || c.req.path === '/auth/mother') {
          const kind = c.req.path === '/auth/mother' ? 'mother' : 'staff';
          return c.html(loginPage({ kind, language, error: copy.security.origin }), 403);
        }
        return c.html(errorPage(403, copy.security.origin, language), 403);
      }
      return c.json({ error: copy.security.origin }, 403);
    }
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 32 * 1024, onError: c => c.json({ error: getCopy(interfaceLanguage(c)).security.tooLarge }, 413) }));
  app.use('/auth/*', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: getCopy(interfaceLanguage(c)).security.tooLarge }, 413) }));
  app.use('*', identify(db, config));
  app.get('/health', c => c.json({ status: 'ok', stage: 3, fictionalDataOnly: true }));
  app.get('/', c => c.redirect(c.get('principal') ? homeFor(c.get('principal')!.role) : '/login', 303));
  app.get('/login', c => {
    if (c.get('principal')) return c.redirect(homeFor(c.get('principal')!.role), 303);
    const language = interfaceLanguage(c);
    return c.html(loginPage({ kind: c.req.query('kind') === 'mother' ? 'mother' : 'staff', language,
      notice: c.req.query('notice') === 'signed-out' ? getCopy(language).security.signedOut : undefined }));
  });

  for (const type of ['staff', 'mother'] as const) {
    app.get(`/auth/${type}`, c => c.redirect(`/login?kind=${type}`, 303));
    const staff = type === 'staff';
    const table = staff ? 'users' : 'mothers';
    const hashColumn = staff ? 'password_hash' : 'pin_hash';
    const lookup = db.prepare(`SELECT id, ${hashColumn} AS secret_hash, session_version FROM ${table}
      WHERE ${staff ? 'email = :identifier OR phone = :identifier' : 'maternal_id = :identifier'}`);
    // SQLite checks these conditions when each hash verification finishes, even if several overlap.
    const eligible = `id = ? AND ${hashColumn} = ? AND session_version = ? AND locked_until <= ?${staff ? ' AND active = 1' : ''}`;
    const recordFailure = db.prepare(`UPDATE ${table} SET
        failed_attempts = CASE WHEN locked_until > 0 THEN 1 ELSE failed_attempts + 1 END,
        locked_until = CASE WHEN locked_until = 0 AND failed_attempts + 1 >= 5 THEN ? ELSE 0 END
      WHERE ${eligible}`);
    const acceptLogin = db.prepare(`UPDATE ${table} SET failed_attempts = 0, locked_until = 0
      WHERE ${eligible} RETURNING ${staff ? 'role' : "'mother'"} AS role, session_version`);
    app.post(`/auth/${type}`, async c => {
      const language = interfaceLanguage(c);
      const messages = getCopy(language).security;
      if (!c.req.header('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return c.json({ error: messages.invalidForm }, 400);
      const body = await c.req.parseBody();
      const rawIdentifier = body[type === 'staff' ? 'identifier' : 'maternalId'];
      const password = body[type === 'staff' ? 'password' : 'pin'];
      if (typeof rawIdentifier !== 'string' || typeof password !== 'string' || rawIdentifier.length > 150 || password.length > 256 || !rawIdentifier.trim() || !password) {
        return c.html(loginPage({ kind: type, language, error: messages.invalidForm }), 400);
      }
      const identifier = type === 'mother' ? rawIdentifier.trim().toUpperCase() : rawIdentifier.trim().toLowerCase();
      const throttleKey = `${type}:${identifier}`;
      const startedAt = Date.now();
      if (!throttle.allow(throttleKey, startedAt)) return c.html(loginPage({ kind: type, language, error: messages.rateLimited }), 429);
      // Direct contacts take priority. Old demo names alias only the original seed IDs.
      const account = (lookup.get({ identifier }) ??
        (staff ? legacyDemoAccount.get(identifier) : undefined)) as AccountRow | undefined;
      const matches = await verifySecret(password, account?.secret_hash ?? dummyHash);
      const now = Date.now();
      if (account) {
        const conditions = [account.id, account.secret_hash, account.session_version, now] as const;
        if (matches) {
          const accepted = acceptLogin.get(...conditions) as { role: Role; session_version: number } | undefined;
          if (accepted) {
            throttle.releaseSuccessful(throttleKey, startedAt);
            establishSession(c, config, type, account.id, accepted.session_version);
            return c.redirect(homeFor(accepted.role), 303);
          }
        } else {
          recordFailure.run(now + 5 * 60 * 1000, ...conditions);
        }
      }
      return c.html(loginPage({ kind: type, language, error: messages.invalidCredentials }), 401);
    });
  }

  app.post('/auth/logout', c => {
    const user = c.get('principal');
    if (user) {
      if (user.role === 'mother') rememberLanguage(c, user.language === 'ha' ? 'ha' : 'en', config.secureCookies);
      const table = user.type === 'staff' ? 'users' : 'mothers';
      db.prepare(`UPDATE ${table} SET session_version = session_version + 1 WHERE id = ?`).run(user.id);
    }
    clearSession(c, config);
    return c.redirect('/login?notice=signed-out', 303);
  });

  addProviderRoutes(app, db, config);
  app.use('/api/*', async (c, next) => {
    if (!c.get('principal')) return c.json({ error: en.security.signInRequired }, 401);
    await next();
  });
  app.get('/api/session', c => {
    const user = c.get('principal')!;
    return c.json({ role: user.role, name: user.name, facilityName: user.facilityName });
  });

  const directory = () => ({
    facilities: db.prepare('SELECT id, name, state FROM facilities ORDER BY id').all(),
    staff: db.prepare(`SELECT u.name, u.email, u.role, f.name AS facilityName FROM users u
      JOIN facilities f ON f.id = u.facility_id WHERE u.active = 1 ORDER BY u.id`).all(),
  });
  const routes = [
    ['/api/admin/directory', 'admin'], ['/api/worker/workspace', 'health_worker'],
    ['/api/provider/workspace', 'provider'], ['/api/mother/profile', 'mother'],
  ] as const;
  for (const [path, role] of routes) {
    app.get(path, c => {
      const user = c.get('principal')!;
      if (user.role !== role) return c.json({ error: en.security.forbidden }, 403);
      if (role === 'admin') return c.json(directory());
      if (role === 'mother') return c.json({ name: user.name, maternalId: user.maternalId, language: user.language });
      if (role === 'health_worker') {
        const count = db.prepare('SELECT COUNT(*) AS count FROM mothers WHERE registered_facility_id = ?').get(user.facilityId) as { count: number };
        return c.json({ facilityName: user.facilityName, registeredMothers: count.count });
      }
      return c.json({ facilityName: user.facilityName });
    });
  }

  addCareRoutes(app, db, config);
  for (const role of ['admin', 'health_worker'] as const) {
    app.get(homeFor(role), c => {
      const user = c.get('principal');
      const language = interfaceLanguage(c);
      if (!user) return c.redirect('/login?kind=staff', 303);
      if (user.role !== role) return c.html(errorPage(403, getCopy(language).security.forbidden, language), 403);
      const count = (query: string, ...values: (number | string)[]) => (db.prepare(query).get(...values) as { count: number }).count;
      const stats = role === 'admin'
        ? { facilities: count('SELECT COUNT(*) AS count FROM facilities'), staff: count('SELECT COUNT(*) AS count FROM users WHERE active = 1'), mothers: count('SELECT COUNT(*) AS count FROM mothers') }
        : { facilities: 1, staff: 0, mothers: count('SELECT COUNT(*) AS count FROM mothers WHERE registered_facility_id = ?', user.facilityId) };
      const adminDirectory = role === 'admin' ? directory() : {};
      return c.html(dashboardPage({ role, language, name: user.name, facilityName: user.facilityName,
        stats, ...adminDirectory } as Parameters<typeof dashboardPage>[0]));
    });
  }
  app.get('/dashboard', c => c.redirect(c.get('principal') ? homeFor(c.get('principal')!.role) : '/login', 303));
  app.notFound(c => {
    const language = interfaceLanguage(c);
    const message = getCopy(language).security.notFound;
    return c.req.path.startsWith('/api/') ? c.json({ error: message }, 404) : c.html(errorPage(404, message, language), 404);
  });
  app.onError((_error, c) => {
    const language = interfaceLanguage(c);
    const message = getCopy(language).security.serverError;
    return c.req.path.startsWith('/api/') ? c.json({ error: message }, 500) : c.html(errorPage(500, message, language), 500);
  });
  return app;
}
