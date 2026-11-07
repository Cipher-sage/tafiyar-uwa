import type { Hono, MiddlewareHandler } from 'hono';
import type { AppEnv } from './auth.js';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';
import { requireRole } from './care-routes.js';
import { getCopy } from './i18n.js';
import { interfaceLanguage } from './interface-language.js';
import { offlineReceipts } from './offline-grant.js';
import { listAccessLogs, lookupProviderRecord, ProviderError, recordOfflineAccess } from './provider.js';
import { adminAccessLogsPage, errorPage, providerLookupPage, providerRecordPage } from './views.js';

export function addProviderRoutes(app: Hono<AppEnv>, db: Database, config: AppConfig) {
  const provider = requireRole('provider');
  const receipts = offlineReceipts(config.sessionSecret);
  app.get('/provider', provider, c => c.html(providerLookupPage({
    facilityName: c.get('principal')!.facilityName, language: interfaceLanguage(c),
  })));
  app.get('/provider/lookup', provider, c => c.redirect('/provider', 303));
  app.post('/provider/lookup', provider, async c => {
    const language = interfaceLanguage(c);
    const copy = getCopy(language);
    if (c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') {
      return c.html(errorPage(415, copy.security.invalidForm, language), 415);
    }
    const user = c.get('principal')!;
    const session = c.get('sessionInfo')!;
    const body = await c.req.parseBody({ all: true });
    const maternalId = typeof body.maternalId === 'string' ? body.maternalId.trim().toUpperCase() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    try {
      const record = lookupProviderRecord(db, user, maternalId, reason);
      const expiresAt = new Date(session.expires).toISOString();
      const offlineGrant = receipts.issue({ providerId: user.id, providerVersion: user.version,
        facilityId: user.facilityId, motherId: record.mother.id, reason: record.reason,
        openedAt: record.openedAt, expiresAt, logId: record.logId, sessionKey: session.key });
      return c.html(providerRecordPage({ record, openedAt: record.openedAt, reason: record.reason,
        sessionKey: session.key, expiresAt, offlineGrant, language, facilityName: user.facilityName }));
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      const t = copy.provider;
      const problems = [error.fields.maternalId && t.invalidId, error.fields.reason && t.invalidReason].filter(Boolean);
      const message = problems.length ? problems.join(' ') : error.status === 403 ? t.forbidden : t.unavailable;
      return c.html(providerLookupPage({ facilityName: user.facilityName, language, error: message,
        values: { maternalId, reason } }), error.status);
    }
  });

  app.get('/admin/access-logs', requireRole('admin'), c => {
    const language = interfaceLanguage(c);
    const rawPage = c.req.query('page') ?? '1';
    if (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage))) {
      return c.html(errorPage(400, getCopy(language).provider.invalidPage, language), 400);
    }
    try {
      const logs = listAccessLogs(db, c.get('principal')!, Number(rawPage));
      return c.html(adminAccessLogsPage({ logs, language }));
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      return c.html(errorPage(error.status, getCopy(language).provider.invalidPage, language), error.status);
    }
  });

  const receiptBody: MiddlewareHandler<AppEnv> = async (c, next) => {
    const message = getCopy(interfaceLanguage(c)).provider.invalidEvent;
    if (c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/json') return c.json({ error: message }, 415);
    let event: unknown;
    try { event = await c.req.json(); } catch { return c.json({ error: message }, 400); }
    if (!event || typeof event !== 'object' || Array.isArray(event)) return c.json({ error: message }, 400);
    await next();
  };
  app.post('/api/provider/check-offline-copy', receiptBody, async c => {
    const message = getCopy(interfaceLanguage(c)).provider.unavailable;
    const user = c.get('principal');
    if (!user) return c.json({ error: message }, 401);
    const grant = receipts.read((await c.req.json()).grant);
    if (!grant || user.role !== 'provider' || grant.providerId !== user.id || grant.facilityId !== user.facilityId ||
        grant.providerVersion !== user.version || grant.sessionKey !== c.get('sessionInfo')?.key ||
        Date.parse(grant.expiresAt) <= Date.now() ||
        !db.prepare('SELECT 1 FROM mothers WHERE id = ? AND consent_to_share = 1').get(grant.motherId)) {
      return c.json({ error: message }, 403);
    }
    return c.body(null, 204);
  });

  // After sign-out the sealed receipt authenticates only this write. The database
  // checks it against the successful online lookup before recording a delayed opening.
  app.post('/api/provider/offline-access', receiptBody, async c => {
    const message = getCopy(interfaceLanguage(c)).provider.invalidEvent;
    const event = await c.req.json();
    const grant = receipts.read(event.grant);
    if (!grant) return c.json({ error: message }, 403);
    try {
      recordOfflineAccess(db, grant, event.eventId, event.viewedAt);
      return c.body(null, 204);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      return c.json({ error: message }, error.status);
    }
  });
}
