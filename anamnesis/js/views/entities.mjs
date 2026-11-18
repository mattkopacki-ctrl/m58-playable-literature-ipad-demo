import { h, field, input, textarea, select, btn, badge, formData, lines, panel } from '../ui.mjs';
import { workbench, saveEntity, editorHeader, refOptions } from './common.mjs';
import { EVIDENCE, EVIDENCE_LABEL, INBOX_STATUS, displayName } from '../core/schema.mjs';
import { analyzeText } from '../core/analyzer.mjs';
import { resolveRef } from '../core/store.mjs';

function simpleForm(ctx, kind, ent, fields, toPatch, extra = []) {
  const form = h('form', { class: 'form', onsubmit: e => { e.preventDefault(); saveEntity(ctx, kind, ent, toPatch(formData(form))); } },
    ...fields, h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, 'Save'), ...extra));
  return form;
}

export function libraryView(ctx) {
  return workbench(ctx, {
    kind: 'library', route: 'library', title: 'Library',
    sub: e => `${e.form} · ${analyzeText(e.text).words} words`,
    newData: () => ({ title: 'New manuscript', form: 'manuscript' }),
    editor: ent => h('div', {}, editorHeader(ctx, 'library', ent, [btn('Analyze ▸', () => ctx.go('analyzer', ent.id))]),
      simpleForm(ctx, 'library', ent, [
        field('Title', input('title', ent.title)),
        h('div', { class: 'grid2' }, field('Author', input('author', ent.author)),
          field('Form', select('form', ent.form, ['manuscript', 'reference', 'note', 'excerpt']))),
        field('Tags', input('tags', ent.tags.join(' ')), 'Space or comma separated'),
        field('Text', textarea('text', ent.text, 16, { class: 'prose' }), 'Paragraphs separated by a blank line.'),
      ], d => ({ ...d }))),
  });
}

export function inboxView(ctx) {
  const statusFilter = ctx.query.status || 'ALL';
  const filters = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by status' },
    ['ALL', ...INBOX_STATUS].map(s => h('a', { href: `#/inbox${ctx.params[0] ? '/' + ctx.params[0] : ''}?status=${s}`, class: `chip ${s === statusFilter ? 'on' : ''}` }, s)));
  return workbench(ctx, {
    kind: 'inbox', route: 'inbox', title: 'Research Inbox', extraTop: filters,
    filter: statusFilter === 'ALL' ? null : e => e.status === statusFilter,
    sub: e => `${e.status} · ${EVIDENCE_LABEL[e.evidence]}`,
    newData: () => ({ title: 'New finding', status: 'NEW' }),
    editor: ent => {
      const triage = INBOX_STATUS.map(s => btn(s, () => saveEntity(ctx, 'inbox', ent, { status: s }), s === ent.status ? 'on small' : 'small'));
      const opts = refOptions(ctx.state, ['character', 'world', 'plot', 'theme', 'library']);
      const linkBox = h('fieldset', { class: 'checks' }, h('legend', {}, 'Links to project entities'),
        opts.length ? opts.map(([v, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'links', value: v, checked: ent.links.includes(v) }), l)) : h('p', { class: 'dim' }, 'No entities yet.'));
      const broken = ent.links.filter(l => !resolveRef(ctx.state, l));
      return h('div', {}, editorHeader(ctx, 'inbox', ent),
        h('div', { class: 'row triage', role: 'group', 'aria-label': 'Triage status' }, h('span', { class: 'dim' }, 'Triage:'), ...triage),
        broken.length ? h('p', { class: 'warn' }, `Broken links: ${broken.join(', ')}`) : null,
        simpleForm(ctx, 'inbox', ent, [
          field('Title', input('title', ent.title)),
          h('div', { class: 'grid2' }, field('Source (citation)', input('source', ent.source)), field('URL', input('url', ent.url, { type: 'url', inputmode: 'url' }))),
          field('Claim', textarea('claim', ent.claim, 3), 'One sentence: what the source asserts.'),
          h('div', { class: 'grid2' },
            field('Evidence status', select('evidence', ent.evidence, EVIDENCE.map(e => [e, EVIDENCE_LABEL[e]]))),
            field('Status', select('status', ent.status, INBOX_STATUS))),
          field('Excerpt', textarea('excerpt', ent.excerpt, 3)),
          field('Notes / how it applies', textarea('notes', ent.notes, 3)),
          field('Tags', input('tags', ent.tags.join(' '))),
          linkBox,
        ], d => ({ ...d, links: d.links || [] })));
    },
  });
}

export function worldsView(ctx) {
  return workbench(ctx, {
    kind: 'world', route: 'worlds', title: 'Worlds', sub: e => e.genre || '—',
    newData: () => ({ name: 'New world' }),
    editor: ent => {
      const residents = Object.values(ctx.state.entities.character).filter(c => c.worldId === ent.id && !c.archived);
      return h('div', {}, editorHeader(ctx, 'world', ent),
        simpleForm(ctx, 'world', ent, [
          h('div', { class: 'grid2' }, field('Name', input('name', ent.name)), field('Genre', input('genre', ent.genre))),
          field('Summary', textarea('summary', ent.summary, 4)),
          field('Rules (one per line)', textarea('rules', ent.rules.join('\n'), 5), 'Hard constraints the simulation and manuscript must respect.'),
          field('Places (one per line)', textarea('places', ent.places.join('\n'), 5)),
          field('Tags', input('tags', ent.tags.join(' '))),
        ], d => ({ ...d, rules: lines(d.rules), places: lines(d.places) })),
        panel('Residents', residents.length ? h('ul', { class: 'plain' }, residents.map(c => h('li', {}, h('a', { href: `#/characters/${c.id}` }, c.name), ` — ${c.role}`))) : h('p', { class: 'dim' }, 'No characters placed here.')));
    },
  });
}

export function themesView(ctx) {
  return workbench(ctx, {
    kind: 'theme', route: 'themes', title: 'Themes', sub: e => e.motifs.join(' · ') || '—',
    newData: () => ({ name: 'New theme' }),
    editor: ent => {
      const beats = Object.values(ctx.state.entities.plot).filter(p => !p.archived)
        .flatMap(p => p.beats.filter(b => b.themeIds.includes(ent.id)).map(b => [p, b]));
      return h('div', {}, editorHeader(ctx, 'theme', ent),
        simpleForm(ctx, 'theme', ent, [
          field('Name', input('name', ent.name)),
          field('Thematic statement', textarea('statement', ent.statement, 3)),
          field('Dramatic question', textarea('question', ent.question, 2)),
          field('Motifs', input('motifs', ent.motifs.join(' ')), 'Recurring images or objects.'),
        ], d => d),
        panel('Carried by beats', beats.length ? h('ul', { class: 'plain' }, beats.map(([p, b]) => h('li', {}, h('a', { href: `#/plots/${p.id}` }, p.title), ` › ${b.title}`))) : h('p', { class: 'dim' }, 'Not yet carried by any beat.')));
    },
  });
}

export function evidenceBadge(e) {
  const cls = { ESTABLISHED: 'ok', SUPPORTED: 'ok', CONTESTED: 'warn', FICTIONAL: 'fic', SIMULATION: 'sim', UNREVIEWED: 'dim' }[e] || '';
  return badge(EVIDENCE_LABEL[e] || e, cls);
}

export { displayName };
