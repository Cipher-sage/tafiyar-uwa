import en from './locales/en.json' with { type: 'json' };
import ha from './locales/ha.json' with { type: 'json' };

export type Language = 'en' | 'ha';
export type Copy = typeof en;

const messages: Record<Language, Copy> = { en, ha };
export function getCopy(language: Language = 'en'): Copy {
  return messages[language];
}

export function formatDate(value: string, language: Language = 'en'): string {
  return new Intl.DateTimeFormat(language === 'ha' ? 'ha-NG' : 'en-NG', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}
