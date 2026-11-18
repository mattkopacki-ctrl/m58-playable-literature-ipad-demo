// Controlled comparisons (T-027; OD-004). Drafts live in memory only. Registering locks
// the definition; running computes every variant in memory and records only the results.
import { h, field, input, textarea, select, btn, badge, formData, panel, table, fmtTime } from '../ui.mjs';
import { runExperiment, resolveBase, definitionProblems, inspectRun, scenarioChoices } from '../core/experiment.mjs';
import { normalizeExperiment, PATCH_KINDS, VERDICTS } from '../core/experiment-schema.mjs';
import { TRAITS, VALUES } from '../core/schema.mjs';
import { clockOf } from '../core/scenario.mjs';
import { decisionView } from './characters.mjs';
import { uid } from '../core/rng.mjs';

const HEAT = 'The noises are just the heating';
export const OLD_HOUSE_EXAMPLE = {
  title: 'Old House · Thomas and the heating', scenarioId: 'oldhouse', ticks: 8, seedCount: 20, researchItemId: '',
  hypothesis: 'A belief a character holds changes which action they take first. (Design hypothesis about this engine, not a claim about people.)',
  prediction: 'If Thomas is unsure that the noises are the heating (0.2 instead of 0.85), he will not start by testing the heating, and will go to the basement door sooner.',
  kind: 'belief.set', characterId: 'oh-thomas', claim: HEAT, value: '0.2', path: 'values.safety', eventKey: '1:0', optionId: '',
  labelA: 'As written (0.85)', labelB: 'Thomas doubts it (0.2)',
};
const BLANK = { title: '', scenarioId: 'oldhouse', ticks: 8, seedCount: 20, researchItemId: '', hypothesis: '', prediction: '', kind: 'character.set', characterId: '', claim: '', value: '',
  path: 'values.safety', eventKey: '1:0', optionId: '', labelA: 'As written', labelB: 'Changed' };

const pct = x => `${Math.round(x * 100)}%`;
const short = n => String(n || '').split(' ')[0];

function draftToDef(d) {
  let patch;
  if (d.kind === 'character.set') patch = { kind: d.kind, characterId: d.characterId, path: d.path, value: d.path === 'asleep' ? d.value === 'true' : d.path === 'place' ? d.value : Number(d.value) };
  else if (d.kind === 'belief.set') patch = { kind: d.kind, characterId: d.characterId, claim: d.claim, confidence: Number(d.value) };
  else if (d.kind === 'event.remove') { const [m, i] = String(d.eventKey).split(':').map(Number); patch = { kind: d.kind, minute: m, index: i }; }
  else patch = { kind: d.kind, optionId: d.optionId };
  return normalizeExperiment({ title: d.title, hypothesis: d.hypothesis, prediction: d.prediction, researchItemId: d.researchItemId, scenarioId: d.scenarioId, ticks: Number(d.ticks),
    seeds: Array.from({ length: Math.max(0, Math.min(50, Number(d.seedCount) || 0)) }, (_, i) => i),
    variants: [{ id: 'A', label: d.labelA, patches: [] }, { id: 'B', label: d.labelB, patches: [patch] }] });
}

function describePatch(p, names) {
  if (!p) return 'nothing (as written)';
  if (p.kind === 'character.set') return `${names[p.characterId] || p.characterId}: ${p.path.replace('.', ' → ')} set to ${p.value}`;
  if (p.kind === 'belief.set') return `${names[p.characterId] || p.characterId}: confidence in “${p.claim}” set to ${p.confidence}`;
  if (p.kind === 'event.remove') return `scripted world event ${p.index + 1} at minute ${p.minute} removed`;
  return `action option “${p.optionId}” removed`;
}

// ---------- list panel (shown in the Simulator)
export function experimentsPanel(ctx) {
  const list = Object.values(ctx.state.experiments).sort((a, b) => b.seq - a.seq);
  return panel(`Controlled comparisons (${list.length})`,
    h('p', { class: 'dim' }, 'Test a hypothesis fairly: run the same scenario twice with exactly one thing changed, on the same dice, and measure what differs. Everything is computed in memory. The live story, its characters and its log are never changed; only the definition and the results are saved.'),
    h('div', { class: 'row' },
      btn('+ New comparison', () => { ctx.scratch.expDraft = { ...BLANK }; ctx.go('simulator', 'exp-new'); }, 'primary'),
      btn('Load the Old House example', () => { ctx.scratch.expDraft = { ...OLD_HOUSE_EXAMPLE }; ctx.go('simulator', 'exp-new'); })),
    list.length ? table(['Comparison', 'Scenario', 'Runs recorded', 'Reproduced', 'Conclusion'], list.map(e => {
      const again = e.results.filter(r => r.reproduced !== null);
      return [h('a', { href: `#/simulator/exp-${e.id}` }, e.def.title), e.def.scenarioId, String(e.results.length),
        !again.length ? '—' : again.every(r => r.reproduced) ? badge('YES', 'ok') : badge('NO', 'bad'), e.conclusions.at(-1)?.verdict || '—'];
    })) : h('p', { class: 'dim' }, 'No comparisons registered yet.'));
}

// ---------- draft editor
export function experimentDraftView(ctx) {
  const d = (ctx.scratch.expDraft ||= { ...BLANK });
  let base = null, baseError = '';
  try { base = resolveBase(ctx.events, d.scenarioId); } catch (err) { baseError = err.message; }
  const cast = base ? base.scenario.cast.map(id => base.state.entities.character[id]) : [];
  const names = Object.fromEntries(cast.map(c => [c.id, c.name]));
  if (base && !cast.some(c => c.id === d.characterId)) d.characterId = cast[0]?.id || '';
  const who = cast.find(c => c.id === d.characterId);
  const places = base ? (base.state.entities.world[base.scenario.worldId]?.places || []) : [];
  const events = base ? Object.entries(base.scenario.script).flatMap(([m, l]) => l.map((e, i) => [`${m}:${i}`, `${clockOf(base.scenario.t0 + (m - 1) / 60)} · ${e.title}`])) : [];
  const options = base ? base.scenario.situation({}).options.map(o => [o.id, o.label]) : [];
  if (events.length && !events.some(e => e[0] === d.eventKey)) d.eventKey = events[0][0];
  if (options.length && !options.some(o => o[0] === d.optionId)) d.optionId = options[0][0];
  const def = draftToDef(d);
  const problems = base ? definitionProblems(def, base) : [baseError];
  const sync = () => Object.assign(d, formData(form));
  const live = (el, rerender = true) => { el.addEventListener('change', () => { sync(); if (rerender) ctx.rerender(); }); return el; };
  const current = () => {
    if (!who) return '';
    if (d.kind === 'belief.set') return `Now: ${who.beliefs.find(b => b.claim.toLowerCase() === d.claim.toLowerCase())?.confidence ?? 'not held (would start at this value)'}`;
    if (d.path === 'asleep') return `Now: ${who.asleep}`; if (d.path === 'place') return `Now: ${who.place}`;
    const [g, k] = d.path.split('.'); return `Now: ${who[g]?.[k]}`;
  };
  const valueControl = d.kind === 'character.set' && d.path === 'asleep' ? select('value', d.value === 'true' ? 'true' : 'false', [['true', 'starts asleep'], ['false', 'starts awake']])
    : d.kind === 'character.set' && d.path === 'place' ? select('value', places.includes(d.value) ? d.value : places[0] || '', places.map(p => [p, p]))
      : input('value', d.value, { inputmode: 'decimal' });
  const form = h('form', { class: 'form', onsubmit: e => e.preventDefault(), oninput: () => sync() },
    field('Title', input('title', d.title)),
    field('Hypothesis', textarea('hypothesis', d.hypothesis, 2), 'What you think is true. It stays a hypothesis whatever the result.'),
    field('Prediction (written before running)', textarea('prediction', d.prediction, 2), 'The direction you expect. It is locked with the definition, so the result cannot be fitted afterwards.'),
    h('div', { class: 'grid2' }, field('Scenario', live(select('scenarioId', d.scenarioId, scenarioChoices(ctx.state)))),
      field('Linked research item (optional)', select('researchItemId', d.researchItemId, [['', '— none —'], ...Object.values(ctx.state.entities.inbox).filter(i => !i.archived).map(i => [i.id, i.title])]))),
    h('fieldset', {}, h('legend', {}, 'The one thing that differs'),
      field('Kind of change', live(select('kind', d.kind, Object.entries(PATCH_KINDS)))),
      d.kind === 'character.set' || d.kind === 'belief.set' ? field('Character', live(select('characterId', d.characterId, cast.map(c => [c.id, c.name])))) : null,
      d.kind === 'character.set' ? field('Setting', live(select('path', d.path, [...TRAITS.map(t => [`traits.${t}`, `trait · ${t}`]), ...VALUES.map(v => [`values.${v}`, `value · ${v}`]), ['asleep', 'starts asleep / awake'], ['place', 'starting place']]))) : null,
      d.kind === 'belief.set' ? field('Claim', live(select('claim', who?.beliefs.some(b => b.claim === d.claim) ? d.claim : (d.claim = who?.beliefs[0]?.claim || ''), (who?.beliefs || []).map(b => [b.claim, b.claim]))), 'Beliefs this character holds at the start.') : null,
      d.kind === 'event.remove' ? field('Scripted world event to remove', select('eventKey', d.eventKey, events)) : null,
      d.kind === 'option.remove' ? field('Action option to remove', select('optionId', d.optionId, options)) : null,
      d.kind === 'character.set' || d.kind === 'belief.set' ? field('Value in variant B', valueControl, current()) : null,
      h('div', { class: 'grid2' }, field('Variant A (control) label', input('labelA', d.labelA), 'A is always the scenario as written.'), field('Variant B label', input('labelB', d.labelB)))),
    h('div', { class: 'grid2' }, field('Minutes to run', input('ticks', String(d.ticks), { type: 'number', min: 1, max: base?.scenario.maxTicks || 240, inputmode: 'numeric' })),
      field('Dice sets (1–50)', input('seedCount', String(d.seedCount), { type: 'number', min: 1, max: 50, inputmode: 'numeric' }), 'Each dice set is run in both variants, so differences come from the change, not from luck.')),
    problems.length ? h('div', { class: 'checklist' }, h('p', {}, badge(`${problems.length} TO FIX`, 'bad')), h('ul', { class: 'plain' }, problems.map(p => h('li', {}, p)))) : h('p', {}, badge('READY TO REGISTER', 'ok')),
    base ? h('p', { class: 'dim' }, `Starting point: the project as it was just before this scenario first ran (event ${base.baseSeq})${base.sandboxInstall ? '; the built-in scenario is not installed here, so it is set up in the temporary copy only' : ''}. Changing: ${describePatch(def.variants[1].patches[0], names)}.`) : null,
    h('div', { class: 'row' },
      btn('Check', () => { sync(); ctx.rerender(); }),
      btn('Register (locks the definition) ▸', async () => {
        sync();
        const def2 = draftToDef(d);
        try {
          const b = resolveBase(ctx.events, def2.scenarioId);
          const probs = definitionProblems(def2, b);
          if (probs.length) { ctx.status(`Not registered: ${probs[0]}`); return ctx.rerender(); }
          const id = uid('exp').slice(4);
          await ctx.dispatch('experiment.register', { id, def: def2, baseSeq: b.baseSeq, baseDigest: b.baseDigest, sandboxInstall: b.sandboxInstall }, { silent: true });
          if (!ctx.getState().experiments[id]) return ctx.rerender();
          ctx.scratch.expDraft = null;
          ctx.status('Comparison registered. Its definition can no longer be edited.');
          ctx.go('simulator', `exp-${id}`);
        } catch (err) { ctx.status('Not registered: ' + err.message); ctx.rerender(); }
      }, 'primary')));
  form.classList.remove('form'); form.classList.add('form-plain'); // a draft is not project data: keep it out of the unsaved-changes guard
  return h('div', { class: 'single' }, h('p', {}, h('a', { href: '#/simulator' }, '‹ Simulator')),
    panel('New controlled comparison · draft (not saved until registered)', form));
}

// ---------- registered experiment
function shareTable(res, a, b) {
  const rows = [];
  for (const id of res.cast) {
    const opts = [...new Set([...Object.keys(a.aggregate.choiceShare[id]), ...Object.keys(b.aggregate.choiceShare[id])])];
    opts.map(o => ({ o, x: a.aggregate.choiceShare[id][o] || 0, y: b.aggregate.choiceShare[id][o] || 0 })).filter(r => Math.abs(r.x - r.y) >= 0.005)
      .sort((p, q) => Math.abs(q.y - q.x) - Math.abs(p.y - p.x)).forEach(r => rows.push([short(res.castNames[id]), a.aggregate.labels[r.o] || b.aggregate.labels[r.o] || r.o || '(none)', pct(r.x), pct(r.y),
        h('span', { class: r.y - r.x >= 0 ? 'pos' : 'neg' }, `${r.y - r.x >= 0 ? '+' : '−'}${Math.abs(Math.round((r.y - r.x) * 100))} pts`)]));
  }
  return rows.length ? table(['Character', 'Action', a.label, b.label, 'Change'], rows) : h('p', { class: 'dim' }, 'No action was chosen at a different rate.');
}

export function experimentView(ctx, exp) {
  const def = exp.def, latest = exp.results.at(-1), res = latest?.results;
  const names = res?.castNames || {};
  const sc = ctx.scratch;
  const run = async () => {
    ctx.status('Running every variant in memory…');
    await new Promise(r => setTimeout(r, 20));
    try {
      const results = runExperiment(def, ctx.events);
      await ctx.dispatch('experiment.result', { experimentId: exp.id, results }, { silent: true });
      const e2 = ctx.getState().experiments[exp.id].results.at(-1);
      ctx.status(e2.reproduced === false ? 'Result recorded, but it does NOT match the first recorded result.' : e2.reproduced ? 'Re-run reproduced the first result exactly (same digest).' : `Result recorded (digest ${results.resultDigest}).`);
    } catch (err) { ctx.status('Run failed: ' + err.message); }
    ctx.rerender();
  };
  const A = res?.variants[0], B = res?.variants[1], cmp = res?.comparisons[0];
  const fd = cmp?.firstDifference;
  const why = sc.why?.[exp.id];
  const insp = sc.insp?.[exp.id];
  const item = ctx.state.entities.inbox[def.researchItemId];
  const last = exp.conclusions.at(-1);

  const results = !res ? panel('Results', h('p', { class: 'dim' }, 'Not run yet.')) : panel(`Results · ${res.seeds.length} dice sets × ${res.variants.length} variants × ${res.ticks} minutes`,
    h('div', { class: 'metrics' },
      h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, `${cmp.seedsWithAnyDifference}/${cmp.seeds}`), h('div', { class: 'metric-k' }, 'dice sets where B differs from A')),
      h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, String(cmp.differingCells.mean)), h('div', { class: 'metric-k' }, `of ${cmp.cellsPerRun} character-minutes differ (mean)`), h('div', { class: 'metric-n' }, `range ${cmp.differingCells.min}–${cmp.differingCells.max}`)),
      h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, `${A.aggregate.distinctRuns} / ${B.aggregate.distinctRuns}`), h('div', { class: 'metric-k' }, 'distinct stories in A / B'), h('div', { class: 'metric-n' }, 'how much the dice alone matter')),
      h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, `${cmp.hearsayChange >= 0 ? '+' : ''}${cmp.hearsayChange}`), h('div', { class: 'metric-k' }, 'change in things passed on by word of mouth'))),
    fd ? h('p', { id: 'first-diff' }, 'First difference: at ', h('strong', {}, `minute ${fd.minute}`), `, ${names[fd.characterId]} chose “${fd.variant}” in B where A had “${fd.control}” (dice set ${fd.seedOffset}). `,
      btn(why ? 'Hide why' : 'Show why', () => {
        if (why) { delete sc.why[exp.id]; return ctx.rerender(); }
        try {
          const pick = v => inspectRun(def, ctx.events, v, fd.seedOffset).ticks[fd.minute - 1].events.find(e => e[0] === 'sim.run')[1].decisions.find(x => x.characterId === fd.characterId);
          (sc.why ||= {})[exp.id] = { a: pick('A'), b: pick('B') };
        } catch (err) { ctx.status(err.message); }
        ctx.rerender();
      }, 'small')) : h('p', {}, badge('NO DIFFERENCE IN ANY DICE SET', 'dim'), ' The change had no effect on anyone’s actions in this window.'),
    why ? h('div', { class: 'preview', id: 'why' }, h('h3', {}, `Why · ${names[fd.characterId]} at minute ${fd.minute}, dice set ${fd.seedOffset} (recomputed in memory)`),
      h('details', { class: 'option', open: true }, h('summary', {}, `A · ${A.label}`), why.a ? decisionView(why.a) : 'no decision'),
      h('details', { class: 'option', open: true }, h('summary', {}, `B · ${B.label}`), why.b ? decisionView(why.b) : 'no decision')) : null,
    h('h3', {}, 'Who changed, and how much'),
    table(['Character', 'Share of their minutes that differ'], res.cast.map(id => [names[id], pct(cmp.byCharacter[id])])),
    h('h3', {}, 'Actions chosen at a different rate'), shareTable(res, A, B),
    h('h3', {}, 'Who knew what at the end (mean number of characters)'),
    table(['World event', `${A.label}: perceived / told / unaware`, `${B.label}: perceived / told / unaware`], A.aggregate.knowledge.map(k => {
      const kb = B.aggregate.knowledge.find(x => x.event === k.event);
      return [k.event, `${k.perceived} / ${k.told} / ${k.unaware}`, kb ? `${kb.perceived} / ${kb.told} / ${kb.unaware}` : 'event removed'];
    })),
    h('h3', {}, 'Activity by minute'),
    table(['Minute', `${A.label}: acting`, 'waiting', `${B.label}: acting`, 'waiting', 'Useful options open (A / B)'], A.aggregate.byMinute.map((m, i) => {
      const n = B.aggregate.byMinute[i];
      return [m.minute, pct(m.activeShare), pct(m.passiveShare), pct(n.activeShare), pct(n.passiveShare), `${m.meanActiveOptions} / ${n.meanActiveOptions}`];
    })),
    h('p', { class: 'dim' }, '“Acting” = chose an option that does something (move, tell, test, wake…). “Waiting” = chose an option with no effect. Sleeping characters are counted separately.'),
    h('h3', {}, 'Inspect one run'),
    h('div', { class: 'row' },
      field('Variant', select('iv', insp?.variant || 'B', res.variants.map(v => [v.id, `${v.id} · ${v.label}`]))), field('Dice set', select('is', String(insp?.seed ?? fd?.seedOffset ?? res.seeds[0]), res.seeds.map(s => [String(s), String(s)]))),
      btn('Recompute and show', e => {
        const wrap = e.target.closest('.row');
        const variant = wrap.querySelector('[name=iv]').value, seed = Number(wrap.querySelector('[name=is]').value);
        try { const r = inspectRun(def, ctx.events, variant, seed); (sc.insp ||= {})[exp.id] = { variant, seed, ticks: r.ticks, cast: r.scenario.cast, t0: r.scenario.t0 }; } catch (err) { ctx.status(err.message); }
        ctx.rerender();
      }, 'small')),
    insp ? h('div', { class: 'preview', id: 'inspect' }, table(['Time', ...insp.cast.map(id => short(names[id])), 'World events'], insp.ticks.map(t => [t.clock,
      ...insp.cast.map(id => { const a = t.actions.find(x => x.characterId === id); return a ? `${a.label}${a.to !== a.from ? ` → ${a.to}` : ''}` : '—'; }),
      t.worldEvents.map(e => e.title).join('; ') || '—']))) : null);

  return h('div', { class: 'single' }, h('p', {}, h('a', { href: '#/simulator' }, '‹ Simulator')),
    h('div', { class: 'editor-head' }, h('div', {}, h('div', { class: 'eyebrow' }, `CONTROLLED COMPARISON · ${exp.id} · registered ${fmtTime(exp.registeredAt)} · locked`), h('h2', {}, def.title))),
    panel('Definition (locked)',
      table(['Item', 'Value'], [
        ['Hypothesis', def.hypothesis], ['Prediction (before running)', def.prediction],
        ['Scenario', def.scenarioId], ['Variant A (control)', `${def.variants[0].label} — nothing changed`],
        ...def.variants.slice(1).map(v => [`Variant ${v.id}`, `${v.label} — ${describePatch(v.patches[0], names)}`]),
        ['Run', `${def.ticks} minutes × ${def.seeds.length} dice sets (${def.seeds[0]}–${def.seeds.at(-1)}), the same sets in every variant`],
        ['Starting point', `project as of event ${exp.baseSeq}${exp.sandboxInstall ? ' + scenario installed in the temporary copy only' : ''} · digest ${exp.baseDigest}`],
        ['Linked research item', item ? h('a', { href: `#/inbox/${item.id}` }, item.title) : '— none —'],
      ]),
      h('div', { class: 'row' }, btn(exp.results.length ? 'Run again (checks it reproduces) ▸' : 'Run in memory ▸', run, 'primary')),
      h('p', { class: 'dim' }, 'Running computes temporary copies and discards them. Nothing in the live project changes; only the result below is recorded.')),
    results,
    panel(`Record (${exp.results.length} result${exp.results.length === 1 ? '' : 's'})`,
      exp.results.length ? table(['#', 'When', 'Result digest', 'Reproduced first result'], exp.results.map(r => [r.seq, fmtTime(r.at), h('span', { class: 'mono' }, r.results.resultDigest),
        r.reproduced === null ? 'first run' : r.reproduced ? badge('YES', 'ok') : badge('NO — INVESTIGATE', 'bad')])) : h('p', { class: 'dim' }, 'No results recorded.')),
    panel('Limits of what this shows',
      h('ul', { class: 'plain dim' },
        h('li', {}, 'It shows how this engine behaves with these settings. It is not evidence about real people.'),
        h('li', {}, 'Character settings and engine weights are tuned by feel (simulation technique), so sizes of effects are not meaningful outside this model.'),
        h('li', {}, 'Dice sets only vary the small random nudge in each decision. They are not independent samples of anything in the world, so no significance test is reported.'),
        h('li', {}, 'One scenario, a short window, one changed factor. A different scenario could show a different result.'))),
    panel('Conclusion',
      last ? h('p', {}, badge(last.verdict, last.verdict === 'SUPPORTED' ? 'ok' : last.verdict === 'REFUTED' ? 'bad' : 'warn'), ` ${last.note} `, h('span', { class: 'dim' }, `(${fmtTime(last.at)}, on result ${last.resultDigest})`)) : null,
      exp.results.length ? (() => {
        const f = h('form', { class: 'form-plain', onsubmit: async e => {
          e.preventDefault(); const d = formData(f);
          await ctx.dispatch('experiment.conclude', { experimentId: exp.id, verdict: d.verdict, note: d.note }, { silent: true });
          const rej = ctx.getState().rejected.at(-1);
          ctx.status(rej && rej.seq === ctx.getState().seq ? `Not recorded: ${rej.why}` : 'Conclusion recorded.'); ctx.rerender();
        } }, h('div', { class: 'grid2' }, field('Was the prediction borne out?', select('verdict', 'INCONCLUSIVE', VERDICTS)), field('Note (what you saw, in your words)', input('note', ''))),
        h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn' }, 'Record conclusion')));
        return f;
      })() : h('p', { class: 'dim' }, 'Run the comparison first.'),
      last && item ? h('div', { class: 'row' }, btn('Copy this conclusion into the research item', async () => {
        await ctx.dispatch('entity.update', { kind: 'inbox', id: item.id, patch: { test: `Controlled comparison “${def.title}” (${exp.id}), ${def.seeds.length} dice sets, result digest ${last.resultDigest}. ${last.note}`, testResult: last.verdict } }, { silent: true });
        const rej = ctx.getState().rejected.at(-1);
        ctx.status(rej && rej.seq === ctx.getState().seq ? `Not copied: ${rej.why}` : 'Copied into the research item’s test and test result. Its stage was not changed.'); ctx.rerender();
      }, 'small'), h('span', { class: 'dim' }, 'Never automatic. It fills the item’s test fields; moving its stage is still your decision.')) : null));
}
