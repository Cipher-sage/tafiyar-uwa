'use strict';

(() => {
  const snapshotKey = 'tafiyar.offline.record';
  const markerKey = 'tafiyar.offline.latest';
  const auditPrefix = 'tafiyar.offline.audit.';
  const shell = document.body.hasAttribute('data-offline-shell');
  const payload = document.querySelector('#provider-snapshot');
  const clinical = document.querySelector('#provider-record-content');
  const clearButton = document.querySelector('#offline-clear');
  const link = document.querySelector('#offline-link');
  const status = document.querySelector('#offline-status');
  const content = document.querySelector('#offline-content');
  const unavailable = document.body.dataset.unavailable || status?.dataset.unavailable || '';
  const auditBlocked = document.body.dataset.auditBlocked || unavailable;
  let onlineRecord = null;
  let shownId = null;
  let active = true;
  let timer;
  let flushing = false;
  let viewAttempt = 0;

  function read(storage, key) {
    return JSON.parse(storage.getItem(key) || 'null');
  }

  function sessionCookie() {
    return document.cookie.split('; ').find((item) => item.startsWith('tafiyar_offline_session='))?.split('=')[1];
  }

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function discardLocal() {
    try { sessionStorage.removeItem(snapshotKey); } catch { /* Storage may be disabled. */ }
  }

  function markerMatches(record) {
    const marker = read(localStorage, markerKey);
    return marker?.sessionKey === record.sessionKey && marker.id === record.id;
  }

  function stillValid(record) {
    return record && record.sessionKey === sessionCookie() && Date.now() < record.until && markerMatches(record);
  }

  function conceal(message) {
    clearTimeout(timer);
    shownId = null;
    content?.replaceChildren();
    if (clinical) clinical.hidden = true;
    if (clearButton) clearButton.hidden = true;
    if (link) link.hidden = true;
    setStatus(message || (shell ? unavailable : status?.dataset.unavailable || unavailable));
  }

  function clearRecord() {
    // Keep the last open time, so a stale history entry cannot restore a cleared copy.
    try {
      const marker = read(localStorage, markerKey);
      const mine = onlineRecord || read(sessionStorage, snapshotKey);
      if (mine && markerMatches(mine)) {
        localStorage.setItem(markerKey, JSON.stringify({ ...marker, id: null }));
      }
    } finally {
      discardLocal();
      conceal(status?.dataset.cleared);
    }
  }

  function revokeSession() {
    try { localStorage.removeItem(markerKey); } finally {
      discardLocal();
      conceal();
    }
  }

  function cleanupInvalid() {
    if (!active) return;
    try {
      const saved = read(sessionStorage, snapshotKey);
      if (saved && !stillValid(saved)) discardLocal();
      if (onlineRecord && !stillValid(onlineRecord)) conceal();
      if (shell && !stillValid(saved)) conceal();
    } catch { discardLocal(); conceal(); }
  }

  function scheduleExpiry(record) {
    clearTimeout(timer);
    timer = setTimeout(cleanupInvalid, Math.max(0, Math.min(record.until - Date.now() + 1, 2147483647)));
  }

  function auditKeys() {
    return Object.keys(localStorage).filter((key) => key.startsWith(auditPrefix));
  }

  async function flushAudit() {
    if (flushing || !navigator.onLine) return;
    flushing = true;
    try {
      for (const key of auditKeys()) {
        const body = localStorage.getItem(key);
        if (!body) continue;
        const response = await fetch('/api/provider/offline-access', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', cache: 'no-store', redirect: 'error', body,
        });
        if (response.ok) localStorage.removeItem(key);
      }
    } catch { /* Keep pending views until a subsequent successful upload. */ }
    finally { flushing = false; }
  }

  function saveAudit(record) {
    // Every cached view must be recorded before the screen can reveal it.
    if (auditKeys().length >= 100) return false;
    const eventId = crypto.randomUUID();
    localStorage.setItem(auditPrefix + eventId, JSON.stringify({
      grant: record.offlineGrant, eventId, viewedAt: new Date().toISOString(),
    }));
    return true;
  }

  const node = (tag, value, className) => {
    const element = document.createElement(tag);
    if (value !== undefined) element.textContent = value;
    if (className) element.className = className;
    return element;
  };

  function render(record) {
    const { record: { mother, visits }, copy: { care, provider }, language } = record;
    const locale = language === 'ha' ? 'ha-NG' : 'en-NG';
    const date = (value, withTime = false) => {
      if (!value) return care.notRecorded;
      const options = { dateStyle: 'medium', timeZone: 'Africa/Lagos' };
      if (withTime) options.timeStyle = 'short';
      return new Intl.DateTimeFormat(locale, options).format(new Date(value));
    };
    function fields(rows) {
      const list = node('dl', undefined, 'record-data');
      for (const [label, value] of rows) {
        const row = node('div');
        row.append(node('dt', label), node('dd', value ?? care.notRecorded, 'clinic-notes'));
        list.append(row);
      }
      return list;
    }
    document.documentElement.lang = language;
    document.title = provider.lastRecord + ' · ' + record.copy.brand;
    document.querySelector('#offline-title').textContent = provider.lastRecord;
    setStatus(provider.offlineNotice);
    document.querySelector('#offline-back').textContent = provider.back;
    clearButton.textContent = provider.clear;
    clearButton.hidden = false;
    const summary = node('section', undefined, 'panel');
    summary.append(node('h2', mother.name), fields([
      [care.maternalId, mother.maternalId], [care.age, mother.age], [care.phone, mother.phone],
      [care.language, mother.language === 'ha' ? care.hausa : care.english],
      [care.expectedDeliveryDate, date(mother.expectedDeliveryDate)], [care.signedUpAt, mother.facilityName],
      [provider.reason, record.reason], [provider.savedAt, date(record.openedAt, true)],
      [provider.expiresAt, date(record.until, true)],
    ]));
    const history = node('section', undefined, 'panel');
    history.append(node('h2', care.history));
    if (!visits.length) history.append(node('p', care.noVisits));
    for (const visit of visits) {
      const details = node('details', undefined, 'visit-entry');
      details.append(node('summary', date(visit.visitDate) + ' · ' + visit.facilityName), fields([
        [care.weeksPregnant, visit.weeksPregnant], [care.bloodPressure, visit.bloodPressure],
        [care.weight, visit.weight], [care.notes, visit.notes || undefined],
        [care.nextAppointment, date(visit.nextAppointment)],
      ]));
      history.append(details);
    }
    content.replaceChildren(summary, history);
    scheduleExpiry(record);
  }

  async function authorized(record) {
    if (!navigator.onLine) return true;
    try {
      const response = await fetch('/api/provider/check-offline-copy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        body: JSON.stringify({ grant: record.offlineGrant }),
      });
      return response.status === 204;
    } catch {
      // The network can fail before the OS detects that it is offline.
      return true;
    }
  }

  async function showSaved() {
    if (!shell || !active) return;
    const attempt = ++viewAttempt;
    try {
      const record = read(sessionStorage, snapshotKey);
      if (!stillValid(record)) { cleanupInvalid(); return; }
      const allowed = await authorized(record);
      if (!active || attempt !== viewAttempt) return;
      if (!allowed || !stillValid(record)) { clearRecord(); return; }
      if (shownId === record.id) return;
      if (!saveAudit(record)) { conceal(auditBlocked); return; }
      render(record);
      shownId = record.id;
      void flushAudit();
    } catch { conceal(auditBlocked); }
  }

  async function prepare(record) {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Offline shell unavailable.')), 12000)),
    ]);
    if (!registration || !ready.active || !active || !stillValid(record)) return;
    sessionStorage.setItem(snapshotKey, JSON.stringify(record));
    if (link) link.hidden = false;
    if (clearButton) clearButton.hidden = false;
    setStatus(status?.dataset.ready);
  }

  function enroll() {
    let record;
    try {
      record = JSON.parse(payload.dataset.payload);
    } finally {
      payload.remove();
    }
    const stamp = Date.parse(record.openedAt);
    record.until = Date.parse(record.expiresAt);
    if (!record.sessionKey || record.sessionKey !== sessionCookie() ||
        !(Date.now() < record.until) || !Number.isFinite(stamp)) {
      conceal(); return;
    }
    const prior = read(localStorage, markerKey);
    if (prior?.sessionKey === record.sessionKey && prior.openedAt >= stamp) { conceal(); return; }
    record.id = crypto.randomUUID();
    // Revoke the previous copy even if a full device cannot save the new one.
    discardLocal();
    localStorage.setItem(markerKey, JSON.stringify({
      sessionKey: record.sessionKey, id: record.id, openedAt: stamp, until: record.until,
    }));
    onlineRecord = { sessionKey: record.sessionKey, id: record.id, until: record.until };
    scheduleExpiry(onlineRecord);
    if (!navigator.serviceWorker) { setStatus(status?.dataset.unavailable); return; }
    setStatus(status?.dataset.preparing);
    void prepare(record).catch(() => setStatus(status?.dataset.unavailable));
  }

  if (payload) {
    try { enroll(); } catch { discardLocal(); setStatus(status?.dataset.unavailable); }
  } else {
    cleanupInvalid();
  }
  if (shell) void showSaved();
  void flushAudit();
  clearButton?.addEventListener('click', clearRecord);
  document.addEventListener('submit', (event) => {
    if (event.target.matches('form[action="/auth/logout"]')) revokeSession();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === markerKey || event.key === null) cleanupInvalid();
  });
  window.addEventListener('pagehide', () => {
    active = false;
    viewAttempt++;
    if (shell || clinical) conceal();
  });
  window.addEventListener('pageshow', (event) => {
    active = true;
    if (!event.persisted) return;
    cleanupInvalid();
    if (shell) void showSaved();
    if (onlineRecord) {
      // Reload through lookup so returning from history cannot create an unaudited disclosure.
      location.replace('/provider');
    }
  });
  function resume() {
    if (!active || document.visibilityState === 'hidden') return;
    cleanupInvalid();
    if (shell) void showSaved();
    void flushAudit();
  }
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
})();
