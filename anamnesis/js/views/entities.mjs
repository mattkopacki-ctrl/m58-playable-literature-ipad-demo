import { h, field, input, textarea, select, btn, badge, formData, lines, panel } from '../ui.mjs';
import { workbench, saveEntity, editorHeader, refOptions, researchPanel } from './common.mjs';
import { EVIDENCE, EVIDENCE_LABEL, INBOX_STATUS, displayName } from '../core/schema.mjs';
import { analyzeText } from '../core/analyzer.mjs';
import { resolveRef } from '../core/store.mjs';
import { RESEARCH_STAGES, STAGE_LABEL, TEST_RESULTS, ANNOTATION_CATEGORIES, stageCheck } from '../core/research.mjs';
import { digest } from '../core/rng.mjs';
import { table, fmtTime } from '../ui.mjs';

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
      ], d => ({ ...d })), researchPanel(ctx, 'library', ent.id)),
  });
}

export function inboxView(ctx) {
  const statusFilter = ctx.query.status || 'ALL';
  const filters = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by status' },
    ['ALL', ...INBOX_STATUS].map(s => h('a', { href: `#/inbox${ctx.params[0] ? '/' + ctx.params[0] : ''}?status=${s}`, class: `chip ${s === statusFilter ? 'on' : ''}` }, s)));
  return workbench(ctx, {
    kind: 'inbox', route: 'inbox', title: 'Research Inbox', extraTop: filters,
    filter: statusFilter === 'ALL' ? null : e => e.status === statusFilter,
    sub: e => `${STAGE_LABEL[e.stage]} · ${e.status} · ${EVIDENCE_LABEL[e.evidence]}`,
    newData: () => ({ title: 'New finding', status: 'NEW' }),
    editor: ent => {
      const triage = INBOX_STATUS.map(s => btn(s, () => saveEntity(ctx, 'inbox', ent, { status: s }), s === ent.status ? 'on small' : 'small'));
      const opts = refOptions(ctx.state, ['character', 'world', 'plot', 'theme', 'library']);
      const linkBox = h('fieldset', { class: 'checks' }, h('legend', {}, 'Links to project entities'),
        opts.length ? opts.map(([v, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'links', value: v, checked: ent.links.includes(v) }), l)) : h('p', { class: 'dim' }, 'No entities yet.'));
      const broken = ent.links.filter(l => !resolveRef(ctx.state, l));
      return h('div', {}, editorHeader(ctx, 'inbox', ent),
        h('div', { class: 'row triage', role: 'group', 'aria-label': 'Triage status' }, h('span', { class: 'dim' }, 'Triage:'), ...triage),
        stageRow(ctx, ent),
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
          h('fieldset', {}, h('legend', {}, 'Hypothesis and test'),
            field('Hypothesis', textarea('hypothesis', ent.hypothesis, 2), 'What you expect to be true in a story or simulation if this finding holds.'),
            field('How it was tested', textarea('test', ent.test, 2), 'For example: a controlled comparison of two variants, or a simulation run and what was measured.'),
            field('Test result', select('testResult', ent.testResult, TEST_RESULTS))),
          h('fieldset', {}, h('legend', {}, 'Original (preserved)'),
            ent.original ? h('div', {}, h('p', { class: 'mono dim' }, `captured ${fmtTime(ent.capturedAt)} · ${ent.original.length} characters · digest ${digest(ent.original)} · read-only`),
              h('pre', { class: 'original' }, ent.original))
              : field('Paste the source text', textarea('original', '', 5, { class: 'prose' }), 'Saved once, then kept unchanged with its capture time. Work on it through the excerpt, annotations and hypothesis.')),
          field('Tags', input('tags', ent.tags.join(' '))),
          linkBox,
        ], d => ({ ...d, links: d.links || [] })),
        annotationPanel(ctx, ent));
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
        panel('Residents', residents.length ? h('ul', { class: 'plain' }, residents.map(c => h('li', {}, h('a', { href: `#/characters/${c.id}` }, c.name), ` — ${c.role}`))) : h('p', { class: 'dim' }, 'No characters placed here.')), researchPanel(ctx, 'world', ent.id));
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
        panel('Carried by beats', beats.length ? h('ul', { class: 'plain' }, beats.map(([p, b]) => h('li', {}, h('a', { href: `#/plots/${p.id}` }, p.title), ` › ${b.title}`))) : h('p', { class: 'dim' }, 'Not yet carried by any beat.')), researchPanel(ctx, 'theme', ent.id));
    },
  });
}

export function evidenceBadge(e) {
  const cls = { ESTABLISHED: 'ok', SUPPORTED: 'ok', CONTESTED: 'warn', FICTIONAL: 'fic', SIMULATION: 'sim', UNREVIEWED: 'dim' }[e] || '';
  return badge(EVIDENCE_LABEL[e] || e, cls);
}

export { displayName };

function stageRow(ctx, ent) {
  const at = RESEARCH_STAGES.indexOf(ent.stage);
  const next = RESEARCH_STAGES[at + 1];
  const gate = next ? stageCheck(ent, ent.stage, next) : null;
  return h('div', { class: 'stage-row' },
    h('div', { class: 'row triage', role: 'group', 'aria-label': 'Research stage' }, h('span', { class: 'dim' }, 'Stage:'),
      ...RESEARCH_STAGES.map((s, i) => btn(`${i + 1} ${STAGE_LABEL[s]}`, async () => {
        const g = stageCheck(ent, ent.stage, s);
        if (!g.ok) return ctx.status(`Cannot move to ${STAGE_LABEL[s]}: ${g.why.join('; ')}.`);
        await saveEntity(ctx, 'inbox', ent, { stage: s });
      }, `small ${s === ent.stage ? 'on' : ''}`, { 'aria-pressed': String(s === ent.stage) }))),
    next ? h('p', { class: 'dim' }, gate.ok ? `Ready for ${STAGE_LABEL[next]}.` : `To reach ${STAGE_LABEL[next]}: ${gate.why.join('; ')}. Save the form before changing stage.`)
      : h('p', { class: 'dim' }, 'Eligible for promotion. This is a status only: nothing in the simulation changes automatically, and promotion is an owner decision.'));
}

function annotationPanel(ctx, ent) {
  const form = h('form', { class: 'form', onsubmit: e => {
    e.preventDefault();
    const d = formData(form);
    if (!d.note.trim()) return ctx.status('Annotation needs a note.');
    saveEntity(ctx, 'inbox', ent, { annotations: [...ent.annotations, { category: d.category, note: d.note, quote: d.quote }] });
  } },
  h('div', { class: 'grid2' }, field('Category', select('category', 'character', ANNOTATION_CATEGORIES)), field('Note', input('note', ''))),
  field('Quote from the source (optional)', input('quote', '')),
  h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn' }, '+ Add annotation')));
  return panel(`Annotations · reverse engineering (${ent.annotations.length})`,
    ent.annotations.length ? table(['Category', 'Note', 'Quote', ''], ent.annotations.map((a, i) => [a.category, a.note, a.quote || '—',
      btn('Remove', () => saveEntity(ctx, 'inbox', ent, { annotations: ent.annotations.filter((_, j) => j !== i) }), 'small danger')])) : h('p', { class: 'dim' }, 'None yet. Tag what the source shows: characters, desires, conflict, events, causality, world rules, narrative questions, emotional shifts, motifs, themes.'),
    form);
}
