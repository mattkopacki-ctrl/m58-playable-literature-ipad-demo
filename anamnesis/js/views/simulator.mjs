import { h, btn, badge, panel, table, fmtTime } from '../ui.mjs';
import { liveList } from '../core/store.mjs';
import { decide } from '../core/cognition.mjs';
import { situationPicker, decisionView } from './characters.mjs';
import { SITUATIONS } from '../core/seed.mjs';
import { parseOptions } from '../core/cognition.mjs';
import { uid } from '../core/rng.mjs';
import { OLD_HOUSE } from '../core/oldhouse.mjs';
import { stepScenario, scenarioStatus, inspectCharacter, knowledgeMatrix } from '../core/scenario.mjs';

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
    oldHousePanel(ctx),
    panel('Free scenario · one situation, chosen cast', situationPicker(ctx), castBox, h('div', { class: 'row' }, btn('Run simulation ▸', run, 'primary'))),
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

function oldHousePanel(ctx) {
  const sc = OLD_HOUSE, st = scenarioStatus(ctx.state, sc);
  const title = `${sc.name} · five characters · SAMPLE scenario`;
  if (!st.installed) {
    const partial = !!ctx.state.entities.world[sc.worldId];
    return panel(title, h('p', {}, 'Mara, Daniel, Elise, Thomas and June. At 02:13 something knocks three times on the inside of the locked basement door. Each minute everyone decides what to do from what they themselves perceived or were told.'),
      partial ? h('p', { class: 'warn' }, 'The Old House world exists but its cast is incomplete, so it cannot be installed again in this project.')
        : btn('Install Old House ▸', async () => { for (const [t, p] of sc.installEvents()) await ctx.dispatch(t, p, { silent: true }); ctx.status('Old House installed: 5 characters at 02:13.'); ctx.rerender(); }, 'primary'));
  }
  const advance = async n => {
    try {
      let state = ctx.state, last;
      for (let i = 0; i < n; i++) {
        last = stepScenario(i === 0 ? ctx.state : state, sc);
        for (const [t, p] of last.events) await ctx.dispatch(t, p, { silent: true });
        state = last.state;
      }
      ctx.status(`Old House advanced to ${last.clock}.`);
    } catch (err) { ctx.status(err.message); }
    ctx.rerender();
  };
  const cast = sc.cast.map(id => inspectCharacter(ctx.state, id));
  const matrix = knowledgeMatrix(ctx.state, sc);
  const acts = ctx.state.actions.filter(a => a.scenarioId === sc.id);
  const lastRun = [...ctx.state.simruns].reverse().find(r => r.scenarioId === sc.id);
  return panel(title,
    h('div', { class: 'metrics' },
      h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, st.clock), h('div', { class: 'metric-k' }, `tick ${st.tick} of ${sc.maxTicks} · paused`)),
      ...Object.entries(st.facts).map(([k, v]) => h('div', { class: 'metric' }, h('div', { class: 'metric-v small' }, String(v)), h('div', { class: 'metric-k' }, k.replace(/([A-Z])/g, ' $1'))))),
    h('div', { class: 'row' }, btn('Advance one minute ▸', () => advance(1), 'primary', { disabled: st.done ? 'disabled' : null }),
      btn('Run to 02:20', () => advance(sc.maxTicks - st.tick), '', { disabled: st.done ? 'disabled' : null }),
      st.done ? badge('END OF SCRIPTED WINDOW', 'dim') : null),
    h('h3', {}, 'Residents'),
    table(['Character', 'State', 'Place', 'Last action', ''], cast.map(c => [c.name, c.asleep ? badge('ASLEEP', 'dim') : badge('AWAKE', 'ok'), c.place, c.lastAction, h('a', { href: `#/characters/${c.id}` }, 'inspect ›')])),
    h('h3', {}, 'Who knows what'),
    matrix.length ? table(['World event', ...cast.map(c => c.name.split(' ')[0])], matrix.map(r => [`${r.event.clock} ${r.event.title}`,
      ...r.cells.map(c => h('span', { title: c.text, class: c.how === 'unaware' ? 'dim' : '' }, c.how === 'unaware' ? '—' : c.how))]))
      : h('p', { class: 'dim' }, 'Nothing has happened yet. Advance one minute.'),
    h('details', { class: 'option' }, h('summary', {}, `Author view · world record (${matrix.length}) — characters never read this`),
      table(['Time', 'Event', 'Truth', 'From', 'Each perceiver got'], matrix.map(r => [r.event.clock, r.event.title, r.event.truth, r.event.provenance === 'author' ? 'author script' : `action by ${ctx.state.entities.character[r.event.causedBy]?.name || '?'}`,
        h('ul', { class: 'plain' }, r.event.perceptions.map(p => h('li', {}, `${p.characterName.split(' ')[0]} (${p.channel}): ${p.text}`)))]))),
    acts.length ? h('details', { class: 'option' }, h('summary', {}, `Action log (${acts.length})`),
      table(['Time', 'Who', 'Action', 'Where'], acts.slice().reverse().map(a => [a.storyTime ? clock(a.storyTime) : '', a.characterName, a.label + (a.told?.length ? ` (woke ${a.told.map(t => t.characterName.split(' ')[0]).join(', ')})` : ''), a.from === a.to ? a.to : `${a.from} → ${a.to}`]))) : null,
    lastRun ? h('details', { class: 'option' }, h('summary', {}, `Why they chose · decisions at tick ${lastRun.tick}`), lastRun.decisions.map(d => h('details', { class: 'option' }, h('summary', {}, `${d.characterName} → ${d.chosenLabel}`), decisionView(d)))) : null,
    h('p', { class: 'dim' }, 'Deterministic: the same project state always produces the same minute. The cause of the knocking is unknown and nothing here decides it. A run cannot be rewound yet (that waits on branching).'));
}
const clock = hrs => { const m = Math.round(hrs * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
