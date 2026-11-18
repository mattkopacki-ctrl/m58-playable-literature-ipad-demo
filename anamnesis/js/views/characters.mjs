import { h, field, input, textarea, select, slider, btn, badge, formData, panel, table, parseWeighted, formatWeighted, lines, fmtTime } from '../ui.mjs';
import { workbench, saveEntity, editorHeader } from './common.mjs';
import { TRAITS, VALUES } from '../core/schema.mjs';
import { liveList } from '../core/store.mjs';
import { decide, verifyDecision, explain, parseOptions, memoryActivation } from '../core/cognition.mjs';
import { SITUATIONS } from '../core/seed.mjs';
import { uid } from '../core/rng.mjs';

export function charactersView(ctx) {
  return workbench(ctx, {
    kind: 'character', route: 'characters', title: 'Characters', sub: e => e.role || '—',
    newData: () => ({ name: 'New character' }),
    editor: ent => h('div', {}, editorHeader(ctx, 'character', ent), characterForm(ctx, ent), memoryPanel(ctx, ent), decisionLab(ctx, ent), decisionHistory(ctx, ent)),
  });
}

function characterForm(ctx, ent) {
  const worlds = [['', '— none —'], ...liveList(ctx.state, 'world').map(w => [w.id, w.name])];
  const form = h('form', { class: 'form', onsubmit: e => {
    e.preventDefault();
    const d = formData(form);
    saveEntity(ctx, 'character', ent, {
      name: d.name, role: d.role, summary: d.summary, worldId: d.worldId,
      traits: Object.fromEntries(TRAITS.map(t => [t, Number(d['trait-' + t])])),
      values: Object.fromEntries(VALUES.map(v => [v, Number(d['value-' + v])])),
      goals: parseWeighted(d.goals), fears: parseWeighted(d.fears),
      beliefs: lines(d.beliefs).map(l => { const [claim, c] = l.split('|').map(s => s.trim()); return { claim, confidence: c === undefined ? 0.5 : Number(c) }; }),
    });
  } },
  h('div', { class: 'grid2' }, field('Name', input('name', ent.name)), field('Role', input('role', ent.role))),
  field('World', select('worldId', ent.worldId, worlds)),
  field('Summary', textarea('summary', ent.summary, 3)),
  h('div', { class: 'grid2' },
    h('fieldset', { class: 'sliders' }, h('legend', {}, 'Traits (Big Five, 0–1)'), TRAITS.map(t => slider('trait-' + t, ent.traits[t], t))),
    h('fieldset', { class: 'sliders' }, h('legend', {}, 'Values (weight 0–1)'), VALUES.map(v => slider('value-' + v, ent.values[v], v)))),
  field('Goals', textarea('goals', formatWeighted(ent.goals), 3), 'One per line: text | weight | tags. Prefix a tag with ! to mean "blocks".'),
  field('Fears', textarea('fears', formatWeighted(ent.fears), 3), 'One per line: text | weight | tags'),
  field('Beliefs', textarea('beliefs', ent.beliefs.map(b => `${b.claim} | ${b.confidence}`).join('\n'), 3), 'One per line: claim | confidence'),
  h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, 'Save character')));
  return panel('Profile', form);
}

function memoryPanel(ctx, ent) {
  const now = Number(ctx.scratch.storyTime ?? 48);
  const cues = (ctx.scratch.cues ?? 'cellar dark').split(/[,\s]+/).filter(Boolean);
  const rows = ent.memories.map(m => {
    const a = memoryActivation(m, now, cues);
    return [m.text, String(m.at), m.tags.join(' '), String(m.valence), Number.isFinite(a.total) ? a.total.toFixed(2) : '—',
      a.retrievable ? badge('REACHABLE', 'ok') : badge('BELOW THRESHOLD', 'dim'),
      btn('Recall', () => ctx.dispatch('memory.recall', { characterId: ent.id, memoryId: m.id, storyTime: now, cues }).then(() => ctx.status('Recall logged as a rehearsal.')), 'small', { disabled: m.at > now ? 'disabled' : null })];
  });
  const addForm = h('form', { class: 'form inline', onsubmit: e => {
    e.preventDefault();
    const d = formData(addForm);
    if (!d.text.trim()) return ctx.status('Memory needs text.');
    saveEntity(ctx, 'character', ent, { memories: [...ent.memories, { id: uid('mem'), text: d.text, at: Number(d.at), tags: d.tags, valence: Number(d.valence), arousal: Number(d.arousal), rehearsals: [] }] });
  } },
  field('Memory', input('text', '')), field('Story hour', input('at', String(now), { inputmode: 'decimal' })),
  field('Tags', input('tags', '')), field('Valence −1…1', input('valence', '0', { inputmode: 'decimal' })),
  field('Arousal 0…1', input('arousal', '0.3', { inputmode: 'decimal' })), h('button', { type: 'submit', class: 'btn' }, '+ Add memory'));
  const ctl = h('div', { class: 'row' },
    field('Story hour (now)', input('now', String(now), { inputmode: 'decimal', onchange: e => { ctx.scratch.storyTime = Number(e.target.value) || 0; ctx.rerender(); } })),
    field('Current cues', input('cues', cues.join(' '), { onchange: e => { ctx.scratch.cues = e.target.value; ctx.rerender(); } })));
  return panel('Memory traces · ACT-R activation (simulation technique)',
    h('p', { class: 'dim' }, 'A = ln Σ t^−0.5 over encoding + rehearsals, plus 0.5 per matching cue and 0.3×arousal. Threshold −0.5. Recall writes a rehearsal event; nothing is edited in place.'),
    ctl, rows.length ? table(['Memory', 'Hour', 'Tags', 'Val', 'A', 'State', ''], rows) : h('p', { class: 'dim' }, 'No memories.'), addForm);
}

function situationFromScratch(ctx) {
  const pick = ctx.scratch.situation || SITUATIONS[0].id;
  if (pick !== 'custom') return SITUATIONS.find(s => s.id === pick) || SITUATIONS[0];
  return { id: 'sit-custom-' + (ctx.scratch.customPrompt || '').length, prompt: ctx.scratch.customPrompt || 'Custom situation',
    tags: (ctx.scratch.customTags || '').split(/[,\s]+/).filter(Boolean), options: parseOptions(ctx.scratch.customOptions || '') };
}

export function situationPicker(ctx) {
  const pick = ctx.scratch.situation || SITUATIONS[0].id;
  const sel = select('situation', pick, [...SITUATIONS.map(s => [s.id, s.prompt]), ['custom', 'Custom situation…']]);
  sel.addEventListener('change', () => { ctx.scratch.situation = sel.value; ctx.scratch.result = null; ctx.rerender(); });
  const custom = pick === 'custom' ? h('div', { class: 'custom' },
    field('Prompt', input('cp', ctx.scratch.customPrompt || '', { oninput: e => { ctx.scratch.customPrompt = e.target.value; } })),
    field('Situation tags', input('ct', ctx.scratch.customTags || '', { oninput: e => { ctx.scratch.customTags = e.target.value; } })),
    field('Options', textarea('co', ctx.scratch.customOptions || 'Run [flee safety]\nHide [solitude safety]\nFight [confront risk]', 4, { oninput: e => { ctx.scratch.customOptions = e.target.value; } }), 'One per line: Label [tag, tag]. Tags: values (truth, safety…), !value to violate, risk social solitude rule break-rule help confront novel flee approach.'))
    : null;
  const sit = situationFromScratch(ctx);
  return h('div', {}, field('Situation', sel), custom,
    pick !== 'custom' ? h('ul', { class: 'plain dim' }, sit.options.map(o => h('li', {}, `${o.label} [${o.tags.join(', ')}]`))) : null,
    h('div', { class: 'row' },
      field('Story hour', input('sh', String(ctx.scratch.storyTime ?? 48), { inputmode: 'decimal', oninput: e => { ctx.scratch.storyTime = Number(e.target.value) || 0; } })),
      field('Seed', input('seed', String(ctx.scratch.seed ?? 0), { inputmode: 'numeric', oninput: e => { ctx.scratch.seed = Number(e.target.value) || 0; } }))));
}

export function decisionView(rec) {
  return h('div', { class: 'decision' },
    h('p', { class: 'verdict' }, '▶ ', rec.characterName, ' chooses ', h('strong', {}, `“${rec.chosenLabel}”`), ` · p=${rec.confidence} · margin ${rec.margin}`),
    h('p', { class: 'dim' }, explain(rec)),
    ...rec.ranking.map((r, i) => h('details', { class: 'option', open: i === 0 ? true : null },
      h('summary', {}, `${i === 0 ? '★ ' : ''}${r.label} — total ${r.total} · p ${r.probability}`),
      table(['Source', 'Term', 'Value', 'Why'], r.terms.map(t => [t.source, t.label, h('span', { class: t.value >= 0 ? 'pos' : 'neg' }, (t.value >= 0 ? '+' : '') + t.value), t.why])))),
    h('p', { class: 'mono dim' }, `engine ${rec.engine} · inputs ${rec.inputsDigest} · output ${rec.outputDigest} · status SIMULATION TECHNIQUE`));
}

function decisionLab(ctx, ent) {
  const run = () => {
    try {
      const sit = situationFromScratch(ctx);
      ctx.scratch.result = decide(ent, sit, { now: Number(ctx.scratch.storyTime ?? 48), seed: Number(ctx.scratch.seed ?? 0) });
      ctx.scratch.resultFor = ent.id;
      ctx.rerender();
    } catch (err) { ctx.status('Decision failed: ' + err.message); }
  };
  const res = ctx.scratch.resultFor === ent.id ? ctx.scratch.result : null;
  return panel('Decision Lab · inspectable choice',
    situationPicker(ctx),
    h('div', { class: 'row' }, btn('Decide ▸', run, 'primary'),
      res ? btn('Record decision', async () => { await ctx.dispatch('decision.record', { id: uid('dec'), ...res }); ctx.scratch.result = null; ctx.status('Decision recorded in the log.'); }) : null),
    res ? decisionView(res) : h('p', { class: 'dim' }, 'Decide computes a ranked, term-by-term breakdown. Nothing is stored until you record it.'));
}

function decisionHistory(ctx, ent) {
  const recs = ctx.state.decisions.filter(d => d.characterId === ent.id).slice().reverse();
  return panel(`Recorded decisions (${recs.length})`, recs.length ? h('div', {}, recs.map(r => {
    const last = r.verifications.at(-1);
    return h('details', { class: 'option' },
      h('summary', {}, `#${r.seq} · ${fmtTime(r.at)} · “${r.chosenLabel}” `, last ? badge(last.ok ? 'VERIFIED' : 'MISMATCH', last.ok ? 'ok' : 'warn') : badge('UNVERIFIED', 'dim')),
      h('p', {}, r.prompt),
      btn('Verify by replay', async () => { const v = verifyDecision(r); await ctx.dispatch('decision.verify', { decisionId: r.id, ...v }); ctx.status(v.detail); }, 'small'),
      decisionView(r));
  })) : h('p', { class: 'dim' }, 'None yet.'));
}
