(() => {
  'use strict';
  const local = ['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'].includes(location.hostname) || location.hostname.endsWith('.localhost');
  const enabled = ['https:', 'http:'].includes(location.protocol) && !local;
  const markerKey = 'camsurfland-offer-return-v1';
  const historyKey = '__camsurflandOfferReturn';
  let currentScreen = null, visibleSince = null, viewed = false, suspended = false;
  let pending = null;
  const validScreen = screen => Number.isInteger(screen) && screen >= 1 && screen <= 3;

  function send(command, payload) {
    if (!enabled) return;
    try { window.va(command, payload); } catch { /* Collection must not interrupt the landing. */ }
  }
  function event(name, data) { send('event', { name, data }); }
  function beginVisible() {
    if (currentScreen === null || document.hidden || suspended) return;
    if (!viewed) {
      const path = `/onboarding/${currentScreen}`;
      send('pageview', { path, route: path });
      viewed = true;
    }
    if (visibleSince === null) visibleSince = performance.now();
  }
  function bucket(ms) {
    if (ms < 5000) return '<5s';
    if (ms < 15000) return '5-15s';
    if (ms < 30000) return '15-30s';
    if (ms < 60000) return '30-60s';
    if (ms < 120000) return '1-2m';
    return '>=2m';
  }
  function endVisible() {
    if (visibleSince === null) return;
    const duration = Math.max(0, Math.round(performance.now() - visibleSince));
    visibleSince = null;
    if (duration > 0) event(`screen_time_${currentScreen}`, { duration_ms: duration, duration_bucket: bucket(duration) });
  }
  function readMarker() {
    const candidates = [pending];
    try { candidates.push(history.state?.[historyKey]); } catch { /* History can be restricted. */ }
    try { candidates.push(JSON.parse(sessionStorage.getItem(markerKey))); } catch { /* Storage can be restricted. */ }
    return candidates.filter(candidate => candidate && Number.isFinite(candidate.at)
      && Date.now() >= candidate.at && Date.now() - candidate.at <= 86400000)
      .sort((a, b) => b.at - a.at || Number(!!b.departed) - Number(!!a.departed))[0] || null;
  }
  function saveMarker(value) {
    pending = value;
    try { if (value) sessionStorage.setItem(markerKey, JSON.stringify(value)); else sessionStorage.removeItem(markerKey); } catch { /* Memory still supports BFCache. */ }
    try {
      const current = history.state;
      if (current !== null && (typeof current !== 'object' || Array.isArray(current))) return;
      const state = { ...(current || {}) };
      if (value) state[historyKey] = value; else delete state[historyKey];
      history.replaceState(state, '', location.href);
    } catch { /* Browsers can freeze history before pagehide completes. */ }
  }
  function isHistoryReturn() {
    const navigation = performance.getEntriesByType?.('navigation')[0];
    if (navigation?.type === 'back_forward' || performance.navigation?.type === 2) return true;
    if (navigation?.type || typeof performance.navigation?.type === 'number') return false;
    try { return !!history.state?.[historyKey] && !!readMarker()?.departed; } catch { return false; }
  }
  function recordReturn() {
    const marker = readMarker();
    if (marker?.departed) event('offer_return', { screen: 3 });
    saveMarker(null);
  }
  function enter(screen) {
    if (!validScreen(screen)) return;
    if (currentScreen !== screen) {
      endVisible();
      currentScreen = screen;
      viewed = false;
      suspended = false;
    }
    beginVisible();
    if (screen === 2) observeEmail(document.getElementById('emailInput')?.value);
  }
  function cta(screen) { if (validScreen(screen)) event('cta_click', { screen }); }
  function emailStarted() { event('email_started', { screen: 2 }); }
  function emailEntered() { event('email_entered', { screen: 2 }); }
  let emailWasStarted = false, emailWasEntered = false;
  function observeEmail(value) {
    if (currentScreen !== 2 || typeof value !== 'string') return;
    const input = value.trim();
    if (input && !emailWasStarted) { emailWasStarted = true; emailStarted(); }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input) && !emailWasEntered) { emailWasEntered = true; emailEntered(); }
  }
  function back(screen) { if (validScreen(screen)) event('back_click', { screen }); }
  function emailSubmitted() { event('email_submit', { screen: 2 }); }
  function finish() { endVisible(); suspended = true; }
  function resume() { suspended = false; beginVisible(); }
  function prepareOutbound() { saveMarker({ at: Date.now(), departed: false }); finish(); }
  function outboundRedirect(returning = false) {
    if (returning) event('returning_redirect', { source: 'returning' });
    else event('outbound_redirect', { screen: 3 });
  }
  function redirectError(returning = false) {
    saveMarker(null);
    event('redirect_error', returning ? { source: 'returning' } : { screen: 3 });
    resume();
  }

  if (enabled) {
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    send('beforeSend', analyticsEvent => {
      try {
        const url = new URL(analyticsEvent.url, location.origin);
        url.search = ''; url.hash = '';
        return { ...analyticsEvent, url: url.href };
      } catch { return null; }
    });
    const script = document.createElement('script');
    script.src = '/_vercel/insights/script.js'; script.async = true;
    script.dataset.disableAutoTrack = '1';
    document.head.append(script);
  }
  // A returning visitor can leave automatically before entering any screen.
  if (isHistoryReturn()) recordReturn(); else saveMarker(null);
  document.addEventListener('visibilitychange', () => { if (document.hidden) endVisible(); else beginVisible(); });
  window.addEventListener('pagehide', () => {
    finish();
    if (pending) saveMarker({ ...pending, departed: true });
  });
  window.addEventListener('pageshow', e => {
    if (!e.persisted || !suspended) return;
    recordReturn(); viewed = false; resume();
  });
  window.LANDING_ANALYTICS = { enter, cta, back, observeEmail, emailStarted, emailEntered, emailSubmitted, prepareOutbound, outboundRedirect, redirectError, finish, resume };
})();
