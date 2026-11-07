import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from './auth.js';
import type { Language } from './i18n.js';

export function interfaceLanguage(c: Context<AppEnv>): Language {
  const requested = c.req.query('lang');
  if (requested === 'ha' || requested === 'en') return requested;
  return getCookie(c, 'tafiyar_language') === 'ha' ? 'ha' : 'en';
}

export function rememberLanguage(c: Context<AppEnv>, language: Language, secure: boolean) {
  setCookie(c, 'tafiyar_language', language, { path: '/', sameSite: 'Strict', httpOnly: true, secure });
}
