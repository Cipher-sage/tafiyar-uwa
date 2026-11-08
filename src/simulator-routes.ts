import type { Hono } from 'hono';
import type { AppEnv } from './auth.js';
import type { Database } from './db.js';
import { requireRole } from './care-routes.js';
import { getMotherAppointments, todayInGombe } from './care.js';
import { interfaceLanguage } from './interface-language.js';
import { getCopy } from './i18n.js';
import { listReminderOutbox, queueReminder, ReminderError } from './reminders.js';
import { errorPage, reminderOutboxPage, simulatorPage } from './views.js';

export function addStepFourRoutes(app: Hono<AppEnv>, db: Database) {
  app.get('/simulator', c => c.html(simulatorPage({ stage: 'language', language: interfaceLanguage(c) })));
  for (const stage of ['login', 'menu', 'appointment', 'tip'] as const) {
    app.get('/simulator/' + stage, c => {
      const language = interfaceLanguage(c);
      const user = c.get('principal');
      if (user?.type === 'staff') return c.html(errorPage(403, getCopy(language).simulator.motherOnly, language), 403);
      if (stage === 'login') {
        if (user) return c.redirect('/simulator/menu?lang=' + language, 303);
        return c.html(simulatorPage({ stage, language }));
      }
      if (!user) return c.redirect('/simulator/login?lang=' + language, 303);
      if (stage === 'appointment') return c.html(simulatorPage({ stage, language, today: todayInGombe(),
        appointments: getMotherAppointments(db, user.id) }));
      return c.html(simulatorPage({ stage, language }));
    });
  }

  app.post('/worker/mothers/:maternalId/reminders', requireRole('health_worker'), async c => {
    const language = interfaceLanguage(c);
    const copy = getCopy(language);
    if (c.req.header('Content-Type')?.split(';')[0]?.trim() !== 'application/x-www-form-urlencoded') {
      return c.html(errorPage(415, copy.reminder.invalidRequest, language), 415);
    }
    const fields = await c.req.parseBody({ all: true });
    try {
      const { created } = queueReminder(db, c.get('principal')!, c.req.param('maternalId'), fields.requestKey);
      return c.redirect('/worker/outbox?notice=' + (created ? 'queued' : 'duplicate'), 303);
    } catch (error) {
      if (!(error instanceof ReminderError)) throw error;
      return c.html(errorPage(error.status, copy.reminder[error.code], language), error.status);
    }
  });
  for (const [role, path] of [['health_worker', '/worker/outbox'], ['admin', '/admin/outbox']] as const) {
    app.get(path, requireRole(role), c => {
      const language = interfaceLanguage(c);
      const copy = getCopy(language);
      const page = c.req.query('page') ?? '1';
      if (!/^[1-9]\d*$/.test(page) || !Number.isSafeInteger(Number(page))) {
        return c.html(errorPage(400, copy.provider.invalidPage, language), 400);
      }
      const flag = c.req.query('notice');
      const notice = flag === 'queued' || flag === 'duplicate' ? copy.reminder[flag] : undefined;
      const outbox = listReminderOutbox(db, c.get('principal')!, Number(page));
      return c.html(reminderOutboxPage({ role, language, notice, outbox }));
    });
  }
}
