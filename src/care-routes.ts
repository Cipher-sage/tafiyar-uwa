import { randomUUID } from 'node:crypto';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { AppEnv, Role } from './auth.js';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';
import { CareError, createMother, getMotherAppointments, getWorkerRecord, saveVisit, todayInGombe } from './care.js';
import { getCopy, type Language } from './i18n.js';
import { interfaceLanguage, rememberLanguage } from './interface-language.js';
import { errorPage, motherAppointmentsPage, registrationPage, workerOpenPage, workerRecordPage } from './views.js';

export function requireRole(role: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('principal');
    if (!user) return c.redirect(role === 'mother' ? '/login?kind=mother' : '/login?kind=staff', 303);
    const language = interfaceLanguage(c);
    if (user.role !== role) return c.html(errorPage(403, getCopy(language).security.forbidden, language), 403);
    await next();
  };
}

function formValues(body: Record<string, unknown>, names: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of names) {
    if (typeof body[name] === 'string') values[name] = body[name];
  }
  return values;
}

function errorMessages(error: CareError, language: Language): string[] {
  const copy = getCopy(language);
  const errors: Record<string, string> = copy.careErrors;
  const labels: Record<string, string> = copy.care;
  if (!Object.keys(error.fields).length) return [errors[error.code] ?? copy.security.serverError];
  return Object.entries(error.fields).map(([field, key]) => {
    const detail = errors[key] ?? copy.careErrors.validation;
    return labels[field] ? `${labels[field]} — ${detail}` : detail;
  });
}

function careFailure(c: Context<AppEnv>, error: unknown) {
  if (!(error instanceof CareError)) throw error;
  const language = interfaceLanguage(c);
  return c.html(errorPage(error.status, errorMessages(error, language).join(' '), language), error.status);
}

function retryKey(value: unknown, error: CareError) {
  return typeof value === 'string' && !error.fields.requestKey && error.code !== 'duplicateRequest' ? value : randomUUID();
}

function recordUrl(id: string) { return `/worker/mothers/${encodeURIComponent(id)}`; }

export function addCareRoutes(app: Hono<AppEnv>, db: Database, config: AppConfig) {
  const worker = requireRole('health_worker');
  const mother = requireRole('mother');

  // These forms send scalar fields only. Reject other payloads before parsing them.
  const form: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (c.req.header('Content-Type')?.split(';', 1)[0]?.trim() !== 'application/x-www-form-urlencoded') {
      const language = interfaceLanguage(c);
      return c.html(errorPage(415, getCopy(language).careErrors.validation, language), 415);
    }
    await next();
  };

  app.get('/worker/register', worker, c => c.html(registrationPage({
    facilityName: c.get('principal')!.facilityName, requestKey: randomUUID(), language: interfaceLanguage(c),
  })));
  app.post('/worker/register', worker, form, async c => {
    const user = c.get('principal')!;
    const body = await c.req.parseBody();
    try {
      const { mother: registered } = await createMother(db, user, body);
      return c.redirect(`${recordUrl(registered.maternalId)}?notice=registered`, 303);
    } catch (error) {
      if (!(error instanceof CareError) || !['validation', 'duplicateRequest'].includes(error.code)) return careFailure(c, error);
      const language = interfaceLanguage(c);
      const values = formValues(body, ['name','age','phone','language','expectedDeliveryDate','consentToShare']);
      return c.html(registrationPage({ facilityName: user.facilityName, language, values,
        requestKey: retryKey(body.requestKey, error), errors: errorMessages(error, language) }), error.status);
    }
  });

  app.get('/worker/open', worker, c => {
    const id = c.req.query('maternalId')?.trim().toUpperCase();
    const language = interfaceLanguage(c);
    if (id && /^MC-[A-HJ-NP-Z2-9]{6}$/.test(id)) return c.redirect(recordUrl(id), 303);
    return c.html(workerOpenPage({ facilityName: c.get('principal')!.facilityName, language,
      error: id ? getCopy(language).careErrors.notFound : undefined }), id ? 404 : 200);
  });

  app.get('/worker/mothers/:maternalId', worker, c => {
    const user = c.get('principal')!;
    const language = interfaceLanguage(c);
    const copy = getCopy(language).care;
    try {
      const record = getWorkerRecord(db, user, c.req.param('maternalId'));
      const flag = c.req.query('notice');
      const notice = flag === 'registered' ? copy.registered : flag === 'visit-saved' ? copy.visitSaved : undefined;
      return c.html(workerRecordPage({ record, facilityName: user.facilityName, language,
        requestKey: randomUUID(), today: todayInGombe(), notice }));
    } catch (error) { return careFailure(c, error); }
  });
  app.post('/worker/mothers/:maternalId/visits', worker, form, async c => {
    const user = c.get('principal')!;
    const id = c.req.param('maternalId');
    const language = interfaceLanguage(c);
    const body = await c.req.parseBody();
    try {
      saveVisit(db, user, id, body);
      return c.redirect(`${recordUrl(id)}?notice=visit-saved`, 303);
    } catch (error) {
      if (!(error instanceof CareError) || !['validation', 'duplicateRequest'].includes(error.code)) return careFailure(c, error);
      try {
        const record = getWorkerRecord(db, user, id);
        const values = formValues(body, ['visitDate','weeksPregnant','bloodPressure','weight','notes','nextAppointment']);
        return c.html(workerRecordPage({ record, facilityName: user.facilityName, language, values, today: todayInGombe(),
          requestKey: retryKey(body.requestKey, error), errors: errorMessages(error, language) }), error.status);
      } catch (readError) { return careFailure(c, readError); }
    }
  });

  app.get('/mother', mother, c => {
    const user = c.get('principal')!;
    return c.html(motherAppointmentsPage({ name: user.name, maternalId: user.maternalId!, facilityName: user.facilityName,
      language: user.language === 'ha' ? 'ha' : 'en', today: todayInGombe(), appointments: getMotherAppointments(db, user.id) }));
  });
  app.post('/mother/language', mother, form, async c => {
    const user = c.get('principal')!;
    const { language } = await c.req.parseBody();
    if (language !== 'en' && language !== 'ha') {
      const previous = user.language === 'ha' ? 'ha' : 'en';
      return c.html(errorPage(400, getCopy(previous).careErrors.invalidLanguage, previous), 400);
    }
    db.prepare('UPDATE mothers SET language = ? WHERE id = ?').run(language, user.id);
    rememberLanguage(c, language, config.secureCookies);
    return c.redirect('/mother', 303);
  });
}
