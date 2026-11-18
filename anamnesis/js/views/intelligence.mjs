import { h, field, input, textarea, select, btn, badge, formData, panel, table, fmtTime } from '../ui.mjs';
import { computeIntel } from '../core/intel.mjs';
import { liveList, resolveRef } from '../core/store.mjs';
import { EVIDENCE, EVIDENCE_LABEL, displayName } from '../core/schema.mjs';
import { saveEntity } from './common.mjs';
import { evidenceBadge } from './entities.mjs';
import { uid } from '../core/rng.mjs';
import { STAGE_LABEL } from '../core/research.mjs';

const ROUTE = { character: 'characters', world: 'worlds', plot: 'plots', theme: 'themes', inbox: 'inbox', library: 'library' };

export function intelligenceView(ctx) {
  const intel = computeIntel(ctx.state);
  const notes = liveList(ctx.state, 'intel');
  const order = { ERROR: 0, WARN: 1, INFO: 2 };
  const findings = intel.findings.slice().sort((a, b) => order[a.level] - order[b.level]);
  const total = Object.values(intel.evidence).reduce((a, b) => a + b, 0);
  return h('div', { class: 'single' },
    panel('Project status', h('div', { class: 'metrics' }, Object.entries(intel.counts).map(([k, v]) =>
      h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, String(v)), h('div', { class: 'metric-k' }, k)))),
      h('p', { class: 'dim' }, `Storage: ${ctx.storage.label}`),
      h('div', { class: 'row' }, btn('Request persistent storage', () => ctx.persist(), 'small'))),
    panel(`Health checks (${findings.length})`, findings.length ? h('ul', { class: 'findings' }, findings.map(f => {
      const ent = f.ref && resolveRef(ctx.state, f.ref);
      const [k] = (f.ref || '').split(':');
      return h('li', { class: `lvl-${f.level}` }, badge(f.level, f.level === 'ERROR' ? 'bad' : f.level === 'WARN' ? 'warn' : 'dim'), ' ', h('span', { class: 'dim' }, `${f.area} · `), f.text, ' ',
        ent ? h('a', { href: `#/${ROUTE[k]}/${ent.id}` }, 'open ›') : null);
    })) : h('p', {}, badge('ALL CLEAR', 'ok'))),
    panel('Research evidence mix', table(['Evidence status', 'Items', 'Share'], EVIDENCE.map(e => [evidenceBadge(e), intel.evidence[e], total ? `${Math.round(intel.evidence[e] / total * 100)}%` : '—']))),
    panel('Research progression', table(['Stage', 'Items'], Object.entries(intel.stages).map(([k, v]) => [STAGE_LABEL[k], v])),
      h('p', { class: 'dim' }, 'Eligible for promotion is a status only. No source changes any weight or rule automatically.')),
    panel(`Intelligence notes (${notes.length})`,
      btn('+ New note', async () => { await ctx.dispatch('entity.create', { kind: 'intel', id: uid('intel'), data: { title: 'New note' } }); }, 'small'),
      notes.map(n => noteForm(ctx, n))),
    panel('Event log (latest 25)', table(['#', 'When', 'Type', 'Subject'], ctx.events.slice(-25).reverse().map(ev => [ev.seq, fmtTime(ev.at), ev.type,
      ev.payload.kind ? `${ev.payload.kind}:${ev.payload.id}` : (ev.payload.speakerName ? `${ev.payload.speakerName} → ${ev.payload.listenerName}` : '') || ev.payload.characterName || ev.payload.decisionId || ev.payload.characterId || ev.payload.id || '']))),
    ctx.state.rejected.length ? panel('Rejected events', table(['#', 'Type', 'Why'], ctx.state.rejected.map(r => [r.seq, r.type, r.why]))) : null);
}

function noteForm(ctx, n) {
  const form = h('form', { class: 'form note', onsubmit: e => { e.preventDefault(); saveEntity(ctx, 'intel', n, formData(form)); } },
    h('div', { class: 'grid2' }, field('Title', input('title', n.title)),
      h('div', { class: 'grid2' }, field('Form', select('form', n.form, ['finding', 'hypothesis', 'risk', 'question'])),
        field('Evidence', select('evidence', n.evidence, EVIDENCE.map(e => [e, EVIDENCE_LABEL[e]]))))),
    field('Body', textarea('body', n.body, 3)), field('Tags', input('tags', n.tags.join(' '))),
    h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary small' }, 'Save note'),
      btn('Archive', () => ctx.dispatch('entity.archive', { kind: 'intel', id: n.id }), 'small danger'),
      n.sample ? badge('SAMPLE', 'dim') : null));
  return h('details', { class: 'option' }, h('summary', {}, `${displayName('intel', n)} `, evidenceBadge(n.evidence)), form);
}
