import { Hono } from 'hono';
import en from './locales/en.json' with { type: 'json' };
import ha from './locales/ha.json' with { type: 'json' };

const offlineText: Record<string, string> = { brand: en.brand };
for (const [language, copy] of [['en', en.offline], ['ha', ha.offline]] as const) {
  for (const [key, value] of Object.entries(copy)) offlineText[language + '.' + key] = value;
}
const htmlEscapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
// The cached shell includes only generic bilingual copy and never uses a signed-in identity.
function renderOffline(template: string) {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_match, key: string) => {
    const text = offlineText[key];
    if (text === undefined) throw new Error('Missing offline interface translation.');
    return text.replace(/[&<>"']/g, character => htmlEscapes[character]!);
  });
}

// Only explicitly named public files are served. No directory browsing or project-file access.
export function publicAssetRoutes(load: (name: string) => string | Promise<string>) {
  const publicApp = new Hono();
  const assets = [
    ['/assets/app.css', 'app.css', 'text/css'],
    ['/assets/app.js', 'app.js', 'application/javascript'],
    ['/assets/offline.js', 'offline.js', 'application/javascript'],
    ['/sw.js', 'sw.js', 'application/javascript'],
    ['/offline', 'offline.html', 'text/html'],
  ] as const;
  for (const [path, name, type] of assets) {
    publicApp.get(path, async c => {
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Cache-Control', 'no-cache');
      // Keep the offline page in the same browsing context as authenticated pages.
      c.header('Cross-Origin-Opener-Policy', 'same-origin');
      c.header('Referrer-Policy', 'same-origin');
      c.header('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      const template = await load(name);
      const body = path === '/offline' ? renderOffline(template) : template;
      return c.body(body, 200, { 'Content-Type': type + '; charset=utf-8' });
    });
  }
  return publicApp;
}
