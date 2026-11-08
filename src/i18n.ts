import en from './locales/en.json' with { type: 'json' };
import ha from './locales/ha.json' with { type: 'json' };

export type Language = 'en' | 'ha';
export type Copy = typeof en;

const messages: Record<Language, Copy> = { en, ha };
export function getCopy(language: Language = 'en'): Copy {
  return messages[language];
}

export function formatDate(value: string, language: Language = 'en'): string {
  return calendarDate(new Date(`${value}T12:00:00Z`), language);
}

function calendarDate(date: Date, language: Language, short = false): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid date');
  const names = getCopy(language).dates[short ? 'shortMonths' : 'months'];
  return `${date.getUTCDate()} ${names[date.getUTCMonth()]}${language === 'ha' ? ',' : ''} ${date.getUTCFullYear()}`;
}

export function formatTimestamp(value: string, language: Language = 'en'): string {
  // Gombe uses UTC+1 year-round. Avoid relying on host-provided Hausa ICU data.
  const local = new Date(new Date(value).getTime() + 60 * 60 * 1000);
  const time = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  return `${calendarDate(local, language, true)}, ${time}`;
}
