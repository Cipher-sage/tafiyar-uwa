import { html } from 'hono/html';
import copy from './locales/en.json' with { type: 'json' };

type Markup = ReturnType<typeof html>;
type Role = keyof typeof copy.roles;

export interface DashboardProps {
  role: Role;
  name: string;
  facilityName: string | null;
  maternalId?: string;
  stats: { facilities: number; staff: number; mothers: number };
  facilities?: { id: number; name: string; state: string }[];
  staff?: { name: string; role: string; facilityName: string }[];
}

const paths = {
  leaf: 'M20 3C10 3 3 7 4 14c1 6 8 8 12 2 3-4 4-9 4-13ZM5 20l10-11',
  heart: 'M20 5a5.5 5.5 0 0 0-8 1 5.5 5.5 0 0 0-8-1c-3 3-2 6 0 9l8 7 8-7c2-3 3-6 0-9Z',
  building: 'M5 21V3h14v18M2 21h20M8 8h2M14 8h2M8 12h2M14 12h2M10 21v-5h4v5',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3',
  location: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM14 10a2 2 0 1 1-4 0 2 2 0 1 1 4 0Z',
};

function icon(name: keyof typeof paths) {
  return html`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="${paths[name]}"></path></svg>`;
}

function header(signedIn = false) {
  return html`<header class="site-header"><a class="brand" href="/" aria-label="${copy.pageTitle}">
    <span class="brand-symbol">${icon('leaf')}</span><span><strong>${copy.brand}</strong>
    <span class="brand-product">${copy.product}</span></span></a>
    ${signedIn ? html`<form method="post" action="/auth/logout">
      <button class="secondary" type="submit">${copy.dashboard.signOut}</button></form>`
      : html`<span class="demo-label">${copy.demoLabel}</span>`}</header>`;
}

function layout(body: Markup, title: string) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#19483e">
    <meta name="description" content="${copy.metaDescription}"><title>${title} · ${copy.pageTitle}</title>
    <link rel="stylesheet" href="/assets/app.css"><script defer src="/assets/app.js"></script></head>
    <body><a class="skip-link" href="#main">${copy.skipLink}</a>${body}</body></html>`;
}

function secretField(isMother: boolean) {
  const t = copy.login;
  const show = isMother ? t.showPin : t.showPassword;
  return html`<div class="field"><label for="secret">${isMother ? t.pinLabel : t.passwordLabel}</label>
    <div class="secret-input"><input id="secret" name="${isMother ? 'pin' : 'password'}" type="password"
      autocomplete="current-password" inputmode="${isMother ? 'numeric' : 'text'}"
      maxlength="${isMother ? 12 : 256}" required>
      <button type="button" hidden data-reveal="secret" data-show="${t.showSecret}" data-hide="${t.hideSecret}"
        data-show-label="${show}" data-hide-label="${isMother ? t.hidePin : t.hidePassword}"
        aria-label="${show}" aria-pressed="false">${t.showSecret}</button></div></div>`;
}

export function loginPage({ kind, error, notice }: { kind: 'staff' | 'mother'; error?: string; notice?: string }) {
  const t = copy.login;
  const isMother = kind === 'mother';
  const heading = isMother ? t.motherHeading : t.staffHeading;
  return layout(html`${header()}<main id="main" class="login-layout">
    <aside class="context-panel"><div class="location">${icon('location')}${copy.region}</div>
      <h2>${t.headline}</h2><p>${t.intro}</p></aside>
    <section class="login-card" aria-labelledby="login-title">
      <nav class="login-tabs" aria-label="${t.roleHeading}">
        <a href="/login?kind=staff" aria-current="${isMother ? 'false' : 'page'}">${icon('building')}${t.staffTab}</a>
        <a href="/login?kind=mother" aria-current="${isMother ? 'page' : 'false'}">${icon('heart')}${t.motherTab}</a>
      </nav><h1 id="login-title">${heading}</h1><p>${isMother ? t.motherDescription : t.staffDescription}</p>
      ${error ? html`<div class="message error" role="alert">${error}</div>` : ''}
      ${notice ? html`<div class="message success" role="status">${notice}</div>` : ''}
      <form method="post" action="${isMother ? '/auth/mother' : '/auth/staff'}" class="login-form" data-login-form>
        <div class="field"><label for="identifier">${isMother ? t.maternalIdLabel : t.identifierLabel}</label>
          ${isMother ? html`<input id="identifier" name="maternalId" type="text" autocomplete="username"
            autocapitalize="characters" spellcheck="false" maxlength="150" placeholder="${t.maternalIdPlaceholder}"
            aria-describedby="id-hint" required><small id="id-hint">${t.maternalIdHint}</small>`
            : html`<input id="identifier" name="identifier" type="text" autocomplete="username"
            autocapitalize="none" spellcheck="false" maxlength="150" required>`}</div>
        ${secretField(isMother)}<button class="primary" type="submit" data-submitting="${t.submitting}">
          <span>${t.submit}</span>${icon('arrow')}</button>
      </form><details><summary>${t.demoGuide}</summary><p>${t.demoGuideDescription}</p>
        <ul>${(isMother ? [t.motherAccount] : [t.workerAccount, t.providerAccount, t.adminAccount])
            .map(account => html`<li>${account}</li>`)}</ul></details>
    </section></main>`, heading);
}

function adminDirectory({ stats, facilities = [], staff = [] }: DashboardProps) {
  const t = copy.dashboard;
  return html`<dl class="stats">${[[t.facilities, stats.facilities], [t.staff, stats.staff], [t.mothers, stats.mothers]]
    .map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}</dl>
    <section class="panel"><h2>${t.facilityHeading}</h2><ul class="facility-list">
      ${facilities.map(f => html`<li>${icon('building')}<div><strong>${f.name}</strong><span>${f.state}</span></div></li>`)}
    </ul></section><section class="panel"><h2>${t.staffHeading}</h2><table><thead><tr>
      <th scope="col">${t.staffName}</th><th scope="col">${t.role}</th><th scope="col">${t.facilityName}</th>
    </tr></thead><tbody>${staff.map(s => html`<tr><th scope="row">${s.name}</th>
      <td>${copy.roles[s.role as Role] ?? s.role}</td><td>${s.facilityName || t.fallbackFacility}</td></tr>`)}
    </tbody></table></section>`;
}

function accountDetails(props: DashboardProps) {
  const t = copy.dashboard;
  return html`<section class="panel account"><h2>${t.account}</h2><dl>
    <div><dt>${t.name}</dt><dd>${props.name}</dd></div>
    ${props.role === 'mother' ? html`<div><dt>${t.yourId}</dt><dd class="maternal-id">${props.maternalId}</dd></div>`
      : html`<div><dt>${t.role}</dt><dd>${copy.roles[props.role]}</dd></div>`}
    <div><dt>${t.facilityName}</dt><dd>${props.facilityName ?? t.fallbackFacility}</dd></div>
    ${props.role === 'health_worker' ? html`<div><dt>${t.registeredMothers}</dt><dd>${props.stats.mothers}</dd></div>` : ''}
    </dl></section>`;
}

export function dashboardPage(props: DashboardProps) {
  const t = copy.dashboard;
  const [title, intro] = {
    admin: [t.adminTitle, t.adminIntro], health_worker: [t.workerTitle, t.workerIntro],
    provider: [t.providerTitle, t.providerIntro], mother: [t.motherTitle, t.motherIntro],
  }[props.role] as [string, string];
  return layout(html`${header(true)}<main id="main" class="workspace">
    <div class="workspace-heading"><div class="location">${icon('location')}${copy.region}</div>
      <h1>${title}</h1><p>${intro}</p></div>
    ${props.role === 'admin' ? adminDirectory(props) : accountDetails(props)}
    <footer><span>${icon('lock')}${t.sharedDevice}</span><span>${copy.demoLabel}</span></footer>
    </main>`, title);
}

export function errorPage(status: number, message: string) {
  return layout(html`${header()}<main id="main" class="workspace"><section class="panel error-panel">
    <small>${status}</small><h1>${message}</h1><a href="/">${copy.error.back}</a>
    </section></main>`, String(status));
}
