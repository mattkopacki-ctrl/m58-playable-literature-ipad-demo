import { h, btn, download } from './ui.mjs';
import { openLog, storageStatus, requestPersistence } from './core/db.mjs';
import { replay, apply, makeEvent, buildExport, parseExport } from './core/store.mjs';
import { seedEvents } from './core/seed.mjs';
import { MODULES } from './views/common.mjs';
import { libraryView, inboxView, worldsView, themesView } from './views/entities.mjs';
import { charactersView } from './views/characters.mjs';
import { plotsView } from './views/plots.mjs';
import { analyzerView } from './views/analyzer.mjs';
import { simulatorView } from './views/simulator.mjs';
import { intelligenceView } from './views/intelligence.mjs';
import { terminalView } from './views/terminal.mjs';

const VIEWS = { library: libraryView, inbox: inboxView, analyzer: analyzerView, characters: charactersView, worlds: worldsView,
  plots: plotsView, themes: themesView, simulator: simulatorView, intelligence: intelligenceView, terminal: terminalView };

const app = { log: null, events: [], state: replay([]), scratch: {}, storage: { label: 'starting…' }, queue: Promise.resolve() };
const $ = id => document.getElementById(id);

function setStatus(text) { $('status').textContent = text; }

function dispatch(type, payload, { silent = false } = {}) {
  // Serialise writes: each event gets the next seq only after the previous append finished.
  app.queue = app.queue.then(async () => {
    const ev = makeEvent(app.events.length + 1, type, payload);
    await app.log.append(ev);
    app.events.push(ev);
    app.state = apply(app.state, ev);
    const rej = app.state.rejected.at(-1);
    if (rej && rej.seq === ev.seq) setStatus(`Event #${ev.seq} rejected: ${rej.why}`);
    if (!silent) render();
  }).catch(err => { setStatus(`WRITE FAILED: ${err.message}. Nothing was saved for this action.`); });
  return app.queue;
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const [route, ...params] = path.split('/').filter(Boolean);
  return { route: VIEWS[route] ? route : 'intelligence', params, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function go(route, id) { location.hash = `#/${route}${id ? '/' + id : ''}`; }

function exportLog() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  download(`anamnesis-os-${stamp}.json`, JSON.stringify(buildExport(app.events), null, 2));
  setStatus(`Export of ${app.events.length} events requested. Verify the file in Files before relying on it.`);
}

async function importLog(file) {
  try {
    if (file.size > 25_000_000) throw new Error('file larger than 25 MB');
    const events = parseExport(JSON.parse(await file.text()));
    const next = replay(events);
    if (!confirm(`Replace the current log (${app.events.length} events) with ${events.length} imported events? Export first if unsure.`)) return;
    await app.log.replaceAll(events);
    app.events = events; app.state = next; app.scratch = {};
    setStatus(`Imported ${events.length} events (${next.rejected.length} rejected during replay).`);
    render();
  } catch (err) { setStatus(`Import rejected: ${err.message}`); }
}

async function refreshStorage() {
  const s = await storageStatus();
  const mb = v => v == null ? '?' : (v / 1048576).toFixed(1) + ' MB';
  app.storage = { ...s, label: `${app.log.kind === 'indexeddb' ? 'IndexedDB' : 'MEMORY ONLY (' + app.log.reason + ')'} · ${app.events.length} events · persisted: ${s.persisted == null ? 'unknown' : s.persisted ? 'yes' : 'no (best-effort)'} · used ${mb(s.usage)}` };
  $('lamp').className = `lamp ${app.log.kind === 'indexeddb' ? (s.persisted ? 'ok' : 'warn') : 'bad'}`;
  $('lamp').title = app.storage.label;
}

function render() {
  const { route, params, query } = parseRoute();
  for (const a of document.querySelectorAll('#nav a')) a.setAttribute('aria-current', a.dataset.route === route ? 'page' : 'false');
  const ctx = {
    state: app.state, events: app.events, params, query, scratch: (app.scratch[route] ||= {}), storage: app.storage,
    dispatch, go, status: setStatus, rerender: render, exportLog,
    persist: async () => { const ok = await requestPersistence(); await refreshStorage(); setStatus(ok ? 'Persistent storage granted.' : 'Browser declined persistent storage. Add to Home Screen and export regularly.'); render(); },
  };
  const scrollY = window.scrollY;
  const main = $('main');
  stashDrafts(main);
  let view;
  try { view = VIEWS[route](ctx); } catch (err) { view = h('div', { class: 'panel' }, h('h2', {}, 'View error'), h('pre', {}, String(err.stack || err))); console.error(err); }
  main.replaceChildren(view);
  main.dataset.route = route;
  $('title-route').textContent = MODULES.find(m => m[0] === route)?.[1] || '';
  $('evcount').textContent = `EV ${app.state.seq}`;
  app.renderKey = `${route}/${params[0] || ''}`;
  restoreDrafts(main);
  if (app.lastRoute === route) window.scrollTo(0, scrollY);
  app.lastRoute = route;
}

// ---- Draft protection: typed-but-unsaved form values survive re-renders and navigation.
app.drafts = {};
const formsIn = root => [...root.querySelectorAll('form.form')];
function readForm(form) {
  return [...form.querySelectorAll('[name]')].map(el => [el.name, el.type === 'checkbox' ? el.value : null, el.type === 'checkbox' ? el.checked : el.value]);
}
function stashDrafts(main) {
  if (!app.renderKey) return;
  formsIn(main).forEach((form, i) => {
    const key = `${app.renderKey}#${i}`;
    if (form.dataset.dirty === '1') app.drafts[key] = readForm(form); else delete app.drafts[key];
  });
}
function restoreDrafts(main) {
  let restored = 0;
  formsIn(main).forEach((form, i) => {
    const draft = app.drafts[`${app.renderKey}#${i}`];
    if (!draft) return;
    for (const [name, cbValue, v] of draft) {
      const el = cbValue == null ? form.querySelector(`[name="${CSS.escape(name)}"]:not([type=checkbox])`)
        : form.querySelector(`[name="${CSS.escape(name)}"][value="${CSS.escape(cbValue)}"]`);
      if (!el) continue;
      if (cbValue == null) { el.value = v; el.dispatchEvent(new Event('input')); } else el.checked = v;
    }
    markDirty(form); restored++;
  });
  if (restored) setStatus(`Unsaved draft restored in ${restored} form(s). Save to keep it, or Discard.`);
}
function markDirty(form) {
  if (form.dataset.dirty === '1') return;
  form.dataset.dirty = '1';
  const bar = h('div', { class: 'draft-bar', role: 'status' }, 'UNSAVED CHANGES ',
    btn('Discard', () => { form.dataset.dirty = '0'; delete app.drafts[`${app.renderKey}#${formsIn($('main')).indexOf(form)}`]; render(); }, 'small'));
  form.prepend(bar);
}
function wireDraftTracking() {
  const main = $('main');
  const onEdit = e => { const f = e.target.closest?.('form.form'); if (f && e.isTrusted) markDirty(f); };
  main.addEventListener('input', onEdit);
  main.addEventListener('change', onEdit);
  // Capture phase: a submitted form is clean before its own handler re-renders.
  main.addEventListener('submit', e => { e.target.dataset.dirty = '0'; e.target.querySelector('.draft-bar')?.remove(); }, true);
  window.addEventListener('beforeunload', e => {
    if (formsIn(main).some(f => f.dataset.dirty === '1') || Object.keys(app.drafts).length) { e.preventDefault(); e.returnValue = ''; }
  });
}

function firstRun() {
  const main = $('main');
  main.replaceChildren(h('section', { class: 'panel boot' },
    h('pre', { class: 'boot-art', 'aria-hidden': 'true' }, 'ANAMNESIS OS\n────────────\nnarrative engineering workstation'),
    h('p', {}, 'No project found in this browser. Choose how to start:'),
    h('div', { class: 'row' },
      btn('Load SAMPLE project', async () => { for (const [type, payload] of seedEvents()) await dispatch(type, payload, { silent: true }); await refreshStorage(); setStatus(`SAMPLE project loaded: ${app.events.length} events written to ${app.log.kind}.`); go('intelligence'); render(); }, 'primary'),
      btn('Start empty', async () => { await dispatch('system.note', { text: 'Empty project created.' }, { silent: true }); await refreshStorage(); setStatus('Empty project created.'); render(); }),
      h('label', { class: 'btn' }, 'Import backup…', h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', onchange: e => e.target.files[0] && importLog(e.target.files[0]) }))),
    h('p', { class: 'dim' }, 'Everything stays on this device (IndexedDB). No network, no AI calls, no tracking. Export backups regularly.')));
}

async function boot() {
  const nav = $('nav');
  nav.replaceChildren(...MODULES.map(([route, label, code]) => h('a', { href: `#/${route}`, 'data-route': route },
    h('span', { class: 'code', 'aria-hidden': 'true' }, code), h('span', { class: 'label' }, label))));
  $('export').addEventListener('click', exportLog);
  $('import').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importLog(f); });
  app.log = await openLog();
  try {
    app.events = (await app.log.all()).sort((a, b) => a.seq - b.seq);
  } catch (err) { setStatus('Could not read the log: ' + err.message); app.events = []; }
  app.state = replay(app.events);
  await refreshStorage();
  window.addEventListener('hashchange', render);
  wireDraftTracking();
  if (!app.events.length) firstRun(); else render();
  setStatus(app.log.kind === 'indexeddb' ? `Loaded ${app.events.length} events from IndexedDB.` : `WARNING: ${app.log.reason}. Changes will be lost on reload — export!`);
  window.__anamnesis = app; // inspection hook for tests and the curious
}

boot();

if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !new URLSearchParams(location.search).has('nosw')) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker not registered:', err.message));
}
