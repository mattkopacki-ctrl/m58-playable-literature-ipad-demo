import { h, btn, badge, panel } from '../ui.mjs';
import { EVIDENCE_LABEL } from '../core/schema.mjs';
import { liveList } from '../core/store.mjs';
import { normalize, displayName } from '../core/schema.mjs';
import { uid, stableStringify } from '../core/rng.mjs';

export const MODULES = [
  ['library', 'Library', 'LIB'], ['inbox', 'Research Inbox', 'INB'], ['analyzer', 'Analyzer', 'ANL'],
  ['characters', 'Characters', 'CHR'], ['worlds', 'Worlds', 'WLD'], ['plots', 'Plots', 'PLT'],
  ['themes', 'Themes', 'THM'], ['simulator', 'Simulator', 'SIM'], ['intelligence', 'Intelligence', 'INT'],
  ['terminal', 'Terminal', 'TRM'],
];

export const ROUTE_KIND = { library: 'library', inbox: 'inbox', characters: 'character', worlds: 'world', plots: 'plot', themes: 'theme' };

/** Two-pane workbench: list on the left, editor on the right. */
export function workbench(ctx, { kind, route, title, sub, filter, newData, editor, extraTop }) {
  let items = liveList(ctx.state, kind);
  if (filter) items = items.filter(filter);
  const selected = ctx.params[0] && ctx.state.entities[kind][ctx.params[0]];
  const archived = Object.values(ctx.state.entities[kind]).filter(e => e.archived);
  const list = h('nav', { class: 'list', 'aria-label': `${title} list` },
    h('div', { class: 'list-head' }, h('h2', {}, title), btn('+ New', async () => {
      const id = uid(kind);
      await ctx.dispatch('entity.create', { kind, id, data: newData() });
      ctx.go(route, id);
    }, 'primary')),
    extraTop || null,
    items.length ? h('ul', {}, items.map(e => h('li', {},
      h('a', { href: `#/${route}/${e.id}`, class: selected?.id === e.id ? 'active' : '' },
        h('span', { class: 'li-title' }, displayName(kind, e)),
        sub ? h('span', { class: 'li-sub' }, sub(e)) : null,
        e.sample ? badge('SAMPLE', 'dim') : null)))) : h('p', { class: 'empty' }, 'Nothing here yet. Tap + New.'),
    archived.length ? h('details', { class: 'archived' }, h('summary', {}, `Archived (${archived.length})`),
      h('ul', {}, archived.map(e => h('li', {}, h('span', {}, displayName(kind, e)), ' ',
        btn('Restore', () => ctx.dispatch('entity.restore', { kind, id: e.id }), 'small')))) ) : null);
  const body = selected && !selected.archived ? editor(selected)
    : h('div', { class: 'placeholder' }, h('p', {}, `Select an item or create one.`), h('p', { class: 'dim' }, `${items.length} active · ${archived.length} archived`));
  return h('div', { class: 'workbench' }, list, h('div', { class: 'editor' }, body));
}

/** Save only when something changed; returns true if an event was written. */
export async function saveEntity(ctx, kind, ent, patch) {
  const before = normalize(kind, ent);
  const after = normalize(kind, { ...ent, ...patch });
  if (stableStringify(before) === stableStringify(after)) { ctx.status('No changes to save.'); return false; }
  await ctx.dispatch('entity.update', { kind, id: ent.id, patch });
  ctx.status(`Saved ${displayName(kind, after)} (rev ${ent.rev + 1}).`);
  return true;
}

export function editorHeader(ctx, kind, ent, extra = []) {
  return h('div', { class: 'editor-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, `${kind.toUpperCase()} · ${ent.id} · rev ${ent.rev}`),
      h('h2', {}, displayName(kind, ent))),
    h('div', { class: 'row' }, ...extra,
      btn('Archive', async () => { await ctx.dispatch('entity.archive', { kind, id: ent.id }); ctx.status('Archived (tombstoned, restorable).'); }, 'danger')));
}

export function refOptions(state, kinds) {
  return kinds.flatMap(k => liveList(state, k).map(e => [`${k}:${e.id}`, `${k} · ${displayName(k, e)}`]));
}

/** Backlinks: research items that link to this entity, with evidence status. */
export function researchPanel(ctx, kind, id) {
  const ref = `${kind}:${id}`;
  const items = liveList(ctx.state, 'inbox').filter(i => i.links.includes(ref));
  const cls = { ESTABLISHED: 'ok', SUPPORTED: 'ok', CONTESTED: 'warn', FICTIONAL: 'fic', SIMULATION: 'sim', UNREVIEWED: 'dim' };
  return panel(`Linked research (${items.length})`, items.length ? h('ul', { class: 'plain research-links' }, items.map(i => h('li', {},
    h('a', { href: `#/inbox/${i.id}` }, i.title), ' ', badge(EVIDENCE_LABEL[i.evidence], cls[i.evidence]), ' ', badge(i.status, 'dim'),
    i.claim ? h('div', { class: 'dim' }, i.claim) : null))) : h('p', { class: 'dim' }, 'No research items link here. Link them from the Research Inbox.'));
}
