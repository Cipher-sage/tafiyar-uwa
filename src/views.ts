import { html } from 'hono/html';
import copy from './locales/en.json' with { type: 'json' };
import { formatDate, getCopy, type Language } from './i18n.js';

type Markup = ReturnType<typeof html>;
type Role = keyof typeof copy.roles;

export interface DashboardProps {
  language?: Language;
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

function header(signedIn = false, language: Language = 'en') {
  const copy = getCopy(language);
  return html`<header class="site-header"><a class="brand" href="/" aria-label="${copy.pageTitle}">
    <span class="brand-symbol">${icon('leaf')}</span><span><strong>${copy.brand}</strong>
    <span class="brand-product">${copy.product}</span></span></a>
    ${signedIn ? html`<form method="post" action="/auth/logout">
      <button class="secondary" type="submit">${copy.dashboard.signOut}</button></form>`
      : html`<span class="demo-label">${copy.demoLabel}</span>`}</header>`;
}

function layout(body: Markup, title: string, language: Language = 'en') {
  const copy = getCopy(language);
  return html`<!doctype html><html lang="${language}"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#19483e">
    <meta name="description" content="${copy.metaDescription}"><title>${title} · ${copy.pageTitle}</title>
    <link rel="stylesheet" href="/assets/app.css"><script defer src="/assets/app.js"></script></head>
    <body><a class="skip-link" href="#main">${copy.skipLink}</a>${body}</body></html>`;
}

function secretField(isMother: boolean, language: Language) {
  const t = getCopy(language).login;
  const show = isMother ? t.showPin : t.showPassword;
  return html`<div class="field"><label for="secret">${isMother ? t.pinLabel : t.passwordLabel}</label>
    <div class="secret-input"><input id="secret" name="${isMother ? 'pin' : 'password'}" type="password"
      autocomplete="current-password" inputmode="${isMother ? 'numeric' : 'text'}"
      maxlength="${isMother ? 12 : 256}" required>
      <button type="button" hidden data-reveal="secret" data-show="${t.showSecret}" data-hide="${t.hideSecret}"
        data-show-label="${show}" data-hide-label="${isMother ? t.hidePin : t.hidePassword}"
        aria-label="${show}" aria-pressed="false">${t.showSecret}</button></div></div>`;
}

export function loginPage({ kind, error, notice, language = 'en' }: { kind: 'staff' | 'mother'; error?: string; notice?: string; language?: Language }) {
  const copy = getCopy(language);
  const t = copy.login;
  const isMother = kind === 'mother';
  const heading = isMother ? t.motherHeading : t.staffHeading;
  const query = language === 'ha' ? '&lang=ha' : '';
  return layout(html`${header(false, language)}<main id="main" class="login-layout">
    <aside class="context-panel"><div class="location">${icon('location')}${copy.region}</div>
      <h2>${t.headline}</h2><p>${t.intro}</p></aside>
    <section class="login-card" aria-labelledby="login-title">
      <nav class="login-tabs" aria-label="${t.roleHeading}">
        <a href="/login?kind=staff${query}" aria-current="${isMother ? 'false' : 'page'}">${icon('building')}${t.staffTab}</a>
        <a href="/login?kind=mother${query}" aria-current="${isMother ? 'page' : 'false'}">${icon('heart')}${t.motherTab}</a>
      </nav>${languageLinks(language, `/login?kind=${kind}`)}<h1 id="login-title">${heading}</h1><p>${isMother ? t.motherDescription : t.staffDescription}</p>
      ${error ? html`<div class="message error" role="alert">${error}</div>` : ''}
      ${notice ? html`<div class="message success" role="status">${notice}</div>` : ''}
      <form method="post" action="${isMother ? '/auth/mother' : '/auth/staff'}${language === 'ha' ? '?lang=ha' : ''}" class="login-form" data-login-form>
        <div class="field"><label for="identifier">${isMother ? t.maternalIdLabel : t.identifierLabel}</label>
          ${isMother ? html`<input id="identifier" name="maternalId" type="text" autocomplete="username"
            autocapitalize="characters" spellcheck="false" maxlength="150" placeholder="${t.maternalIdPlaceholder}"
            aria-describedby="id-hint" required><small id="id-hint">${t.maternalIdHint}</small>`
            : html`<input id="identifier" name="identifier" type="text" autocomplete="username"
            autocapitalize="none" spellcheck="false" maxlength="150" required>`}</div>
        ${secretField(isMother, language)}<button class="primary" type="submit" data-submitting="${t.submitting}">
          <span>${t.submit}</span>${icon('arrow')}</button>
      </form><details><summary>${t.demoGuide}</summary><p>${t.demoGuideDescription}</p>
        <ul>${(isMother ? [t.motherAccount] : [t.workerAccount, t.providerAccount, t.adminAccount])
            .map(account => html`<li>${account}</li>`)}</ul></details>
    </section></main>`, heading, language);
}

function adminDirectory({ stats, facilities = [], staff = [], language }: DashboardProps) {
  const copy = getCopy(language);
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
  const copy = getCopy(props.language);
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
  const language = props.language ?? 'en';
  const copy = getCopy(language);
  const t = copy.dashboard;
  const [title, intro] = {
    admin: [t.adminTitle, t.adminIntro], health_worker: [t.workerTitle, t.workerIntro],
    provider: [t.providerTitle, t.providerIntro], mother: [t.motherTitle, t.motherIntro],
  }[props.role] as [string, string];
  return layout(html`${header(true, language)}<main id="main" class="workspace">
    ${props.role === 'health_worker' ? languageLinks(language, '/worker') : ''}
    <div class="workspace-heading"><div class="location">${icon('location')}${copy.region}</div>
      <h1>${title}</h1><p>${intro}</p></div>
    ${props.role === 'health_worker' ? html`<section class="workspace-actions">
      <a class="primary action-link" href="/worker/register">${copy.care.register}${icon('arrow')}</a>
      ${openForm(language)}</section>` : ''}
    ${props.role === 'admin' ? adminDirectory(props) : accountDetails(props)}
    <footer><span>${icon('lock')}${t.sharedDevice}</span><span>${copy.demoLabel}</span></footer>
    </main>`, title, language);
}

export function errorPage(status: number, message: string, language: Language = 'en') {
  const copy = getCopy(language);
  return layout(html`${header(false, language)}<main id="main" class="workspace"><section class="panel error-panel">
    <small>${status}</small><h1>${message}</h1><a href="/">${copy.error.back}</a>
    </section></main>`, String(status), language);
}

type FormValues = Record<string, string>;
type FormPage = {
  requestKey: string;
  facilityName: string;
  values?: FormValues;
  errors?: string[];
  language?: Language;
};
type Appointment = { visitDate: string; nextAppointment: string; facilityName: string };
type VisitSummary = {
  visitDate: string; weeksPregnant: number | null; bloodPressure: string | null;
  weight: number | null; notes: string; nextAppointment: string | null; facilityName: string;
};
type WorkerRecord = {
  mother: { maternalId: string; name: string; age: number; phone: string | null;
    expectedDeliveryDate: string | null; language: string; consentToShare: boolean | number };
  visits: VisitSummary[];
};

function languageLinks(language: Language, path: string) {
  const t = getCopy(language).care;
  const prefix = path.includes('?') ? '&' : '?';
  return html`<nav class="language-switch" aria-label="${t.chooseLanguage}">
    ${(['en','ha'] as const).map(lang => html`<a lang="${lang}" hreflang="${lang}"
      href="${path}${prefix}lang=${lang}" aria-current="${language === lang ? 'true' : 'false'}">
      ${lang === 'ha' ? t.hausa : t.english}</a>`)}
    </nav>`;
}

function openForm(language: Language, maternalId = '') {
  const t = getCopy(language);
  return html`<form class="panel open-form" method="get" action="/worker/open">
    <h2>${t.care.open}</h2><p>${t.care.openHint}</p>
    <div class="field"><label for="open-id">${t.care.maternalId}</label>
      <input id="open-id" name="maternalId" required maxlength="16" value="${maternalId}"
        placeholder="${t.login.maternalIdPlaceholder}" autocapitalize="characters" spellcheck="false" autocomplete="off">
    </div><button type="submit" class="secondary">${t.care.open}</button></form>`;
}

function formErrors(errors?: string[]) {
  return !errors?.length ? '' : html`<div class="message error" role="alert"><ul>
    ${errors.map(error => html`<li>${error}</li>`)}</ul></div>`;
}

type InputProps = {
  name: string; label: string; value?: string; type?: 'text' | 'number' | 'date' | 'tel' | 'password';
  required?: boolean; min?: string; max?: string; step?: string; maxlength?: number;
  pattern?: string; inputmode?: 'numeric' | 'decimal' | 'tel'; hint?: string;
};
function formInput({name, label, value = '', type = 'text', required, min, max, step, maxlength, pattern, inputmode, hint}: InputProps) {
  return html`<div class="field"><label for="${name}">${label}${required ? html` <span aria-hidden="true">*</span>` : ''}</label>
    <input id="${name}" name="${name}" type="${type}" value="${type === 'password' ? '' : value}"
      ${required ? 'required' : ''} ${min !== undefined ? html`min="${min}"` : ''}
      ${max !== undefined ? html`max="${max}"` : ''} ${step ? html`step="${step}"` : ''}
      ${maxlength ? html`maxlength="${maxlength}"` : ''} ${pattern ? html`pattern="${pattern}"` : ''}
      ${inputmode ? html`inputmode="${inputmode}"` : ''} autocomplete="${type === 'password' ? 'new-password' : 'off'}"
      ${hint ? html`aria-describedby="${name}-hint"` : ''}>
    ${hint ? html`<small id="${name}-hint">${hint}</small>` : ''}</div>`;
}

function careHeading(language: Language, title: string, facilityName: string, path: string) {
  const t = getCopy(language);
  return html`<div class="care-toolbar"><a href="/worker">${t.care.back}</a>${languageLinks(language, path)}</div>
    <div class="workspace-heading"><div class="location">${icon('location')}${facilityName}</div><h1>${title}</h1></div>`;
}

export function registrationPage({requestKey, facilityName, values = {}, errors, language = 'en'}: FormPage) {
  const t = getCopy(language).care;
  const preferred = values.language ?? 'ha';
  return layout(html`${header(true, language)}<main id="main" class="workspace care-workspace">
    ${careHeading(language, t.register, facilityName, '/worker/register')}
    <form class="panel care-form" method="post" action="/worker/register" autocomplete="off">
      <input type="hidden" name="requestKey" value="${requestKey}">
      <p>${t.registrationIntro}</p><small>${t.requiredHint}</small>${formErrors(errors)}
      <div class="form-grid">
        ${formInput({name:'name',label:t.name,value:values.name,required:true,maxlength:100})}
        ${formInput({name:'age',label:t.age,value:values.age,required:true,type:'number',min:'0',max:'120',step:'1',inputmode:'numeric'})}
        ${formInput({name:'phone',label:t.phone,value:values.phone,type:'tel',maxlength:32})}
        ${formInput({name:'expectedDeliveryDate',label:t.expectedDeliveryDate,value:values.expectedDeliveryDate,type:'date'})}
        <div class="field"><label for="language">${t.language} <span aria-hidden="true">*</span></label>
        <select required id="language" name="language">
          <option value="ha" ${preferred === 'ha' ? 'selected' : ''}>${t.hausa}</option>
          <option value="en" ${preferred === 'en' ? 'selected' : ''}>${t.english}</option></select></div>
      </div><fieldset><legend>${t.access}</legend><div class="form-grid">
        ${formInput({name:'pin',label:t.pin,required:true,type:'password',inputmode:'numeric',pattern:'[0-9]{8,12}',maxlength:12})}
        ${formInput({name:'pinConfirm',label:t.pinConfirm,required:true,type:'password',inputmode:'numeric',pattern:'[0-9]{8,12}',maxlength:12})}
      </div></fieldset>
      <label class="consent-option"><input type="checkbox" name="consentToShare" value="on"
        ${values.consentToShare === 'on' ? 'checked' : ''} aria-describedby="consent-hint"><span>${t.consent}</span></label>
      <small id="consent-hint">${t.consentHint}</small><button class="primary" type="submit">${t.registerSubmit}${icon('arrow')}</button>
    </form></main>`, t.register, language);
}

export function workerOpenPage({facilityName, error, maternalId, language = 'en'}: {
  facilityName: string; error?: string; maternalId?: string; language?: Language;
}) {
  const t = getCopy(language).care;
  return layout(html`${header(true, language)}<main class="workspace care-workspace" id="main">
    <div class="care-toolbar"><a href="/worker">${t.back}</a>${languageLinks(language, '/worker/open')}</div>
    <h1>${facilityName}</h1>${formErrors(error ? [error] : [])}
    ${openForm(language, maternalId)}</main>`, t.open, language);
}

function dateText(date: string, language: Language) {
  return html`<time datetime="${date}">${formatDate(date, language)}</time>`;
}

export function workerRecordPage({requestKey,facilityName,record,today,values = {},errors,notice,language = 'en'}:
  FormPage & {record:WorkerRecord; today:string; notice?:string}) {
  const c = getCopy(language), t = c.care;
  const m = record.mother;
  const path = `/worker/mothers/${encodeURIComponent(m.maternalId)}`;
  return layout(html`${header(true, language)}<main id="main" class="workspace care-workspace">
    ${careHeading(language, m.name, facilityName, path)}
    ${notice ? html`<div class="message success" role="status">${notice}</div>` : ''}
    <section class="panel identity"><div><span>${t.maternalId}</span><strong class="maternal-id">${m.maternalId}</strong></div>
      <details><summary>${t.details}</summary><dl class="record-data">
        <div><dt>${t.age}</dt><dd>${m.age}</dd></div>
        <div><dt>${t.phone}</dt><dd>${m.phone ?? t.notRecorded}</dd></div>
        <div><dt>${t.expectedDeliveryDate}</dt><dd>${m.expectedDeliveryDate ? dateText(m.expectedDeliveryDate,language) : t.notRecorded}</dd></div>
        <div><dt>${t.language}</dt><dd>${m.language === 'ha' ? t.hausa : t.english}</dd></div>
        <div><dt>${t.consentToShare}</dt><dd>${m.consentToShare ? t.yes : t.no}</dd></div></dl></details></section>
    <form class="panel care-form" method="post" action="${path}/visits">
      <input type="hidden" name="requestKey" value="${requestKey}"><h2>${t.visit}</h2>
      <small>${t.requiredHint}</small>${formErrors(errors)}
      <div class="form-grid">
        ${formInput({name:'visitDate',label:t.visitDate,type:'date',value:values.visitDate ?? today,max:today,required:true})}
        ${formInput({name:'weeksPregnant',label:t.weeksPregnant,type:'number',min:'0',step:'any',value:values.weeksPregnant,inputmode:'decimal'})}
        ${formInput({name:'bloodPressure',label:t.bloodPressure,value:values.bloodPressure,hint:t.bpHint,maxlength:15})}
        ${formInput({name:'weight',label:t.weight,type:'number',min:'0',step:'any',value:values.weight,inputmode:'decimal'})}
      </div><div class="field"><label for="notes">${t.notes}</label><textarea id="notes" name="notes"
        maxlength="1000" rows="3">${values.notes ?? ''}</textarea></div>
      ${formInput({name:'nextAppointment',label:t.nextAppointment,type:'date',value:values.nextAppointment})}
      <button type="submit" class="primary">${t.saveVisit}${icon('arrow')}</button>
    </form><section class="panel"><h2>${t.history}</h2>
    ${!record.visits.length ? html`<p>${t.noVisits}</p>` : record.visits.map(visit => html`
      <details class="visit-entry"><summary>${dateText(visit.visitDate,language)} · ${visit.facilityName}</summary>
        <dl class="record-data"><div><dt>${t.weeksPregnant}</dt><dd>${visit.weeksPregnant ?? t.notRecorded}</dd></div>
          <div><dt>${t.weight}</dt><dd>${visit.weight ?? t.notRecorded}</dd></div>
          <div><dt>${t.bloodPressure}</dt><dd>${visit.bloodPressure ?? t.notRecorded}</dd></div>
          <div><dt>${t.notes}</dt><dd class="clinic-notes">${visit.notes || t.notRecorded}</dd></div>
          <div><dt>${t.nextAppointment}</dt><dd>${visit.nextAppointment ? dateText(visit.nextAppointment,language) : t.notRecorded}</dd></div></dl>
      </details>`)}</section></main>`,t.motherRecord, language);
}

export function motherAppointmentsPage({name,maternalId,facilityName,language,today,appointments,notice}: {
  name: string; maternalId: string; facilityName: string; language: Language; today: string; notice?:string;
  appointments: {next:Appointment|null; history:Appointment[]; lastVisitDate:string|null};
}) {
  const c = getCopy(language), t = c.care, next = appointments.next;
  return layout(html`${header(true, language)}<main id="main" class="workspace mother-space">
    <div class="care-toolbar"><span class="location">${icon('location')}${c.region}</span>
      <form class="language-switch" method="post" action="/mother/language" aria-label="${t.chooseLanguage}">
        ${(['en','ha'] as const).map(lang => html`<button type="submit" name="language" value="${lang}"
          lang="${lang}" aria-pressed="${language === lang ? 'true' : 'false'}">${lang === 'en' ? t.english : t.hausa}</button>`)}
      </form></div>
    <h1>${t.appointments}</h1><p class="mother-name">${name} · <span class="maternal-id">${maternalId}</span></p>
    ${notice ? html`<div class="message success" role="status">${notice}</div>` : ''}
    <section class="appointment-card"><h2>${t.nextAppointment}</h2>
      ${next ? html`<p class="appointment-date">${dateText(next.nextAppointment,language)}</p>
        <p class="appointment-facility">${icon('building')}${next.facilityName}</p>
        ${next.nextAppointment < today ? html`<p class="appointment-note">${t.pastAppointment}</p>` : ''}`
        : html`<p class="empty-appointment">${t.noAppointment}</p><p class="appointment-note">${t.noAppointmentHint}</p>`}
    </section>
    <section class="panel"><h2>${c.dashboard.account}</h2><dl class="record-data">
      <div><dt>${t.signedUpAt}</dt><dd>${facilityName}</dd></div>
      ${appointments.lastVisitDate ? html`<div><dt>${t.latestVisit}</dt><dd>${dateText(appointments.lastVisitDate,language)}</dd></div>` : ''}
    </dl></section>
    ${appointments.history.length ? html`<section class="panel"><h2>${t.previousPlans}</h2><p>${t.previousHint}</p>
      <ul class="past-appointments">${appointments.history.map(item => html`<li><strong>${dateText(item.nextAppointment,language)}</strong>
        <span>${item.facilityName}</span><small>${t.setOn} ${dateText(item.visitDate,language)}</small></li>`)}</ul></section>` : ''}
    <footer><span>${icon('lock')}${c.dashboard.sharedDevice}</span><span>${c.demoLabel}</span></footer>
    </main>`,t.appointments,language);
}
