import { h, btn, badge, panel, table, fmtTime } from '../ui.mjs';
import { liveList } from '../core/store.mjs';
import { decide } from '../core/cognition.mjs';
import { situationPicker, decisionView } from './characters.mjs';
import { SITUATIONS } from '../core/seed.mjs';
import { parseOptions } from '../core/cognition.mjs';
import { uid } from '../core/rng.mjs';

function currentSituation(ctx) {
  const pick = ctx.scratch.situation || SITUATIONS[0].id;
  if (pick !== 'custom') return SITUATIONS.find(s => s.id === pick) || SITUATIONS[0];
  return { id: 'sit-custom-' + (ctx.scratch.customPrompt || '').length, prompt: ctx.scratch.customPrompt || 'Custom situation',
    tags: (ctx.scratch.customTags || '').split(/[,\s]+/).filter(Boolean), options: parseOptions(ctx.scratch.customOptions || '') };
}

export function simulatorView(ctx) {
  const chars = liveList(ctx.state, 'character');
  ctx.scratch.cast ||= chars.map(c => c.id);
  const cast = chars.filter(c => ctx.scratch.cast.includes(c.id));
  const castBox = h('fieldset', { class: 'checks' }, h('legend', {}, 'Cast'),
    chars.map(c => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: cast.includes(c), onchange: e => {
      ctx.scratch.cast = e.target.checked ? [...ctx.scratch.cast, c.id] : ctx.scratch.cast.filter(x => x !== c.id); ctx.rerender();
    } }), c.name)));
  const run = async () => {
    const sit = currentSituation(ctx);
    if (!cast.length) return ctx.status('Pick at least one character.');
    if (!sit.options.length) return ctx.status('Situation has no options.');
    const now = Number(ctx.scratch.storyTime ?? 48), seed = Number(ctx.scratch.seed ?? 0);
    const decisions = cast.map(c => decide(c, sit, { now, seed }));
    await ctx.dispatch('sim.run', { id: uid('run'), situation: sit, now, seed, decisions });
    ctx.status(`Simulation run recorded: ${decisions.length} decisions.`);
  };
  const runs = ctx.state.simruns.slice().reverse();
  const latest = runs[0];
  return h('div', { class: 'single' },
    panel('Scenario', situationPicker(ctx), castBox, h('div', { class: 'row' }, btn('Run simulation ▸', run, 'primary'))),
    latest ? panel(`Latest run · #${latest.seq} · hour ${latest.now} · seed ${latest.seed}`,
      h('p', {}, latest.situation.prompt),
      table(['Character', 'Choice', 'p', 'Margin', 'Top reason'], latest.decisions.map(d => {
        const top = d.ranking[0].terms.filter(t => t.source !== 'noise').sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
        return [d.characterName, d.chosenLabel, d.confidence, d.margin, top ? `${top.source}:${top.label} (${top.value})` : '—'];
      })),
      divergence(latest),
      latest.decisions.map(d => h('details', { class: 'option' }, h('summary', {}, `Inspect ${d.characterName}`), decisionView(d)))) : null,
    panel(`Run history (${runs.length})`, runs.length ? table(['#', 'When', 'Situation', 'Hour', 'Outcomes'], runs.map(r => [r.seq, fmtTime(r.at), r.situation.prompt.slice(0, 60), r.now,
      r.decisions.map(d => `${d.characterName.split(' ')[0]}→${d.chosenLabel}`).join('; ')])) : h('p', { class: 'dim' }, 'No runs yet.')));
}

function divergence(run) {
  const choices = new Set(run.decisions.map(d => d.chosenOptionId));
  return h('p', {}, choices.size > 1 ? badge(`DIVERGENT · ${choices.size} different choices`, 'warn') : badge('CONVERGENT · all chose the same', 'ok'),
    ' Divergence comes only from logged character inputs; same seed → same draws.');
}
