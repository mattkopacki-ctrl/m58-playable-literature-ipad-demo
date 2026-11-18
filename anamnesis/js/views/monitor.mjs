import { h, btn, badge, panel, table, select, field, fmtTime } from '../ui.mjs';
import { replay, EXPORT_FORMAT } from '../core/store.mjs';
import { ENGINE_VERSION, verifyDecision } from '../core/cognition.mjs';
import { digest } from '../core/rng.mjs';
import { OLD_HOUSE } from '../core/oldhouse.mjs';
import { scenarioStatus } from '../core/scenario.mjs';
import { sha256Hex } from '../core/ingest.mjs';

/** Every imported research item's original file is stored and unchanged. Reads only. */
export async function verifyOriginalFiles(state, getOriginal) {
  const items = Object.values(state.entities.inbox).filter(i => i.file);
  const missing = [], mismatch = [];
  for (const i of items) {
    const o = await getOriginal(i.file.sha256);
    if (!o) missing.push(i.file.name); else if (await sha256Hex(new Uint8Array(o.bytes)) !== i.file.sha256) mismatch.push(i.file.name);
  }
  return { total: items.length, missing, mismatch, ok: !missing.length && !mismatch.length };
}

const mb = v => v == null ? 'unknown' : (v / 1048576).toFixed(2) + ' MB';

/** Check the stored log against what is on screen. Reads only; writes nothing. */
export async function verifyLog(readLog, liveState) {
  const stored = (await readLog()).sort((a, b) => a.seq - b.seq);
  const gap = stored.findIndex((ev, i) => ev.seq !== i + 1);
  if (gap >= 0) return { ok: false, detail: `sequence gap at position ${gap + 1}`, count: stored.length };
  const a = digest(replay(stored)), b = digest(liveState);
  return { ok: a === b, detail: a === b ? `stored log replays to the state on screen (digest ${a})` : `MISMATCH: stored ${a}, on screen ${b}`, count: stored.length };
}

export function verifyAllDecisions(state) {
  const all = [...state.decisions, ...state.simruns.flatMap(r => r.decisions.map(d => ({ ...d, seq: r.seq })))];
  const failed = all.filter(d => !verifyDecision(d).ok).map(d => `#${d.seq} ${d.characterName}: ${d.chosenLabel}`);
  return { total: all.length, failed };
}

export function monitorView(ctx) {
  const s = ctx.state, st = ctx.storage, sc = ctx.scratch;
  const byType = {};
  for (const ev of ctx.events) byType[ev.type] = (byType[ev.type] || 0) + 1;
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...types.map(t => t[1]));
  const bytes = new Blob([JSON.stringify(ctx.events)]).size;
  if (sc.sw === undefined) {
    sc.sw = 'checking…';
    (async () => {
      try {
        const keys = globalThis.caches ? await caches.keys() : [];
        sc.sw = navigator.serviceWorker?.controller ? `active · cache ${keys.join(', ') || 'none'}` : (keys.length ? `installed, not yet controlling this page · cache ${keys.join(', ')}` : 'not active (online only)');
      } catch { sc.sw = 'unavailable'; }
      if (location.hash.startsWith('#/monitor')) ctx.rerender();
    })();
  }
  const oh = scenarioStatus(s, OLD_HOUSE);
  const row = (k, v) => [k, v];
  return h('div', { class: 'single' },
    panel('Storage',
      table(['Item', 'Value'], [
        row('Backend', st.backend === 'indexeddb' ? badge('INDEXEDDB', 'ok') : badge('MEMORY ONLY — NOT SAVED', 'bad')),
        row('Protected from browser clean-up', st.persisted == null ? 'unknown' : st.persisted ? badge('YES', 'ok') : badge('NO (BEST-EFFORT)', 'warn')),
        row('Events in log', String(ctx.events.length)), row('Log size', mb(bytes)),
        row('Imported research files', String(Object.values(s.entities.inbox).filter(i => i.file).length) + ' (originals stored separately, by SHA-256)'),
        row('Browser storage used / allowed', `${mb(st.usage)} / ${mb(st.quota)}`),
        row('Last export from this browser', ctx.lastExport() ? fmtTime(ctx.lastExport()) : badge('NEVER', 'warn')),
      ]),
      h('div', { class: 'row' }, btn('Request protected storage', () => ctx.persist(), 'small'), btn('Export backup', () => { ctx.exportLog(); ctx.rerender(); }, 'small')),
      h('p', { class: 'dim' }, 'The browser may clear unprotected storage under pressure or after long disuse. Export regularly and check the file.')),
    panel('Integrity',
      h('div', { class: 'row' },
        btn('Verify stored log', async () => { sc.log = await verifyLog(ctx.readLog, ctx.getState()); ctx.status(sc.log.detail); ctx.rerender(); }, 'primary'),
        btn('Verify every decision by replay', () => { sc.dec = verifyAllDecisions(s); ctx.status(`${sc.dec.total - sc.dec.failed.length} of ${sc.dec.total} decisions verified.`); ctx.rerender(); }),
        btn('Verify original files', async () => { sc.files = await verifyOriginalFiles(ctx.getState(), ctx.getOriginal); ctx.status(`${sc.files.total - sc.files.missing.length - sc.files.mismatch.length} of ${sc.files.total} original files verified.`); ctx.rerender(); })),
      sc.log ? h('p', { id: 'verify-log' }, badge(sc.log.ok ? 'LOG OK' : 'LOG MISMATCH', sc.log.ok ? 'ok' : 'bad'), ` ${sc.log.count} events · ${sc.log.detail}`) : h('p', { class: 'dim' }, 'Not checked this session.'),
      sc.dec ? h('div', { id: 'verify-dec' }, h('p', {}, badge(sc.dec.failed.length ? 'DECISION MISMATCH' : 'DECISIONS OK', sc.dec.failed.length ? 'bad' : 'ok'), ` ${sc.dec.total - sc.dec.failed.length} of ${sc.dec.total} recomputed identically`),
        sc.dec.failed.length ? h('ul', { class: 'plain' }, sc.dec.failed.map(f => h('li', {}, f))) : null) : null,
      sc.files ? h('div', { id: 'verify-files' }, h('p', {}, badge(sc.files.ok ? 'ORIGINALS OK' : 'ORIGINALS PROBLEM', sc.files.ok ? 'ok' : 'bad'), ` ${sc.files.total - sc.files.missing.length - sc.files.mismatch.length} of ${sc.files.total} imported files present and unchanged`),
        [...sc.files.missing.map(n => `missing: ${n}`), ...sc.files.mismatch.map(n => `changed: ${n}`)].length ? h('ul', { class: 'plain' }, [...sc.files.missing.map(n => h('li', {}, `missing: ${n}`)), ...sc.files.mismatch.map(n => h('li', {}, `hash mismatch: ${n}`))]) : null) : null,
      s.rejected.length ? table(['#', 'Type', 'Why rejected'], s.rejected.map(r => [r.seq, r.type, r.why])) : h('p', {}, badge('NO REJECTED EVENTS', 'ok')),
      h('p', { class: 'dim' }, 'These checks read and recompute. They never write to the log.')),
    panel('Processes',
      table(['Process', 'State'], [
        row('Background work', 'none · everything runs when you press a button'),
        row('Old House scenario', oh.installed ? `PAUSED at ${oh.clock} · tick ${oh.tick} of ${OLD_HOUSE.maxTicks}` : 'not installed'),
        row('Network or AI calls', 'none'),
        row('Offline shell (service worker)', sc.sw),
      ])),
    panel('Events by type',
      types.length ? h('div', { class: 'hbars', role: 'img', 'aria-label': 'Event counts by type; values in the table below' },
        types.map(([t, n]) => h('div', { class: 'hbar-row', title: `${t}: ${n}` }, h('span', { class: 'hbar-label' }, t), h('span', { class: 'hbar-track' }, h('span', { class: 'hbar', style: { width: `${(n / max) * 100}%` } })), h('span', { class: 'hbar-n' }, String(n))))) : h('p', { class: 'dim' }, 'No events.'),
      table(['Record', 'Count'], [['Decisions recorded', s.decisions.length], ['Simulation runs', s.simruns.length], ['World events', s.worldEvents.length], ['Character actions', s.actions.length],
        ['Conversations', s.conversations.length], ['Belief updates', s.beliefUpdates.length], ['Recalls', s.recalls.length]])),
    panel('Versions', table(['Component', 'Version'], [row('Build', 'ANAMNESIS OS Build 001'), row('Decision engine', ENGINE_VERSION), row('Experimental mechanisms', 'P1 repeatable actions · P3 experience-driven beliefs · OFF. Preview and comparisons only; never in a saved run (OD-005)'), row('Export format', EXPORT_FORMAT), row('Database', 'anamnesis-os · stores "events" and "originals" · schema 2')])),
    panel('Appearance', field('Theme', (() => { const sel = select('theme', ctx.theme.get(), ctx.theme.list); sel.addEventListener('change', () => { ctx.theme.set(sel.value); ctx.rerender(); }); return sel; })()),
      h('p', { class: 'dim' }, 'Stored in this browser only.')));
}
