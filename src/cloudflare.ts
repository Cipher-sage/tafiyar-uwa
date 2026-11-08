import type { DurableObjectState } from '@cloudflare/workers-types';
import { createApp } from './app.js';
import { openClinicStorage } from './cloudflare-db.js';
import { publicAssetRoutes } from './public-assets.js';

interface Bindings {
  CLINIC: { getByName(name: string): { fetch(request: Request): Promise<Response> } };
  ASSETS: { fetch(request: Request): Promise<Response> };
  SESSION_SECRET?: string;
  SEED_HASHES?: string;
  APP_ORIGIN?: string;
}

const unavailable = () => new Response('The demo is temporarily unavailable.', {
  status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
});

export class Clinic {
  private application?: Promise<Awaited<ReturnType<typeof createApp>>>;
  private origin?: string;
  constructor(private state: DurableObjectState, private env: Bindings) {}

  async fetch(request: Request) {
    const url = new URL(request.url);
    const origin = this.env.APP_ORIGIN || url.origin;
    if (url.origin !== origin) return new Response('Unknown site origin.', { status: 421 });
    if (!this.env.SESSION_SECRET || this.env.SESSION_SECRET.length < 48) return unavailable();
    const secure = url.protocol === 'https:';
    if (!secure && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return unavailable();
    try {
      if (!this.application || this.origin !== origin) {
        const db = openClinicStorage(this.state.storage, this.env.SEED_HASHES);
        this.origin = origin;
        this.application = createApp(db, {
          origin, sessionSecret: this.env.SESSION_SECRET, sessionSeconds: 1800, secureCookies: secure,
        });
      }
      return await (await this.application).fetch(request);
    } catch (error) {
      this.application = undefined;
      // Initialization errors are operational; record no request content or secrets.
      console.error('Clinic startup failed:', error instanceof SyntaxError ? 'Invalid configuration' : error instanceof Error ? error.name : 'Unknown error');
      return unavailable();
    }
  }
}

export default {
  fetch(request: Request, env: Bindings) {
    const routes = publicAssetRoutes(async name => {
      const file = new URL('/' + name, request.url);
      const asset = await env.ASSETS.fetch(new Request(file));
      if (!asset.ok) throw new Error('Public asset unavailable.');
      return asset.text();
    });
    routes.all('*', c => env.CLINIC.getByName('gombe-demo').fetch(c.req.raw));
    return routes.fetch(request);
  },
};
