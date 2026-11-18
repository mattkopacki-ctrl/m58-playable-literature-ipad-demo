// Controlled comparisons (T-027; OD-004). Every variant is computed in memory from a
// frozen starting point and thrown away. Nothing here writes to the log, touches live
// characters, or creates a branch: the only thing a caller may persist is the registered
// definition and the returned results.
import { replay, makeEvent } from './store.mjs';
import { normalize } from './schema.mjs';
import { previewScenario, knowledgeMatrix, seedFor } from './scenario.mjs';
import { compileScenario } from './studio.mjs';
import { OLD_HOUSE } from './oldhouse.mjs';
import { digest } from './rng.mjs';
import { EXPERIMENT_VERSION, structuralProblems, patchTarget } from './experiment-schema.mjs';

const BUILT_IN = { [OLD_HOUSE.id]: OLD_HOUSE };
const FIXED = '1970-01-01T00:00:00.000Z';
const r3 = x => Math.round(x * 1000) / 1000;
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export function scenarioChoices(state) {
  return [[OLD_HOUSE.id, `${OLD_HOUSE.name} (built-in)`], ...Object.values(state.entities.scenario).filter(e => !e.archived).map(e => [e.id, e.name])];
}

/**
 * The frozen starting point: the project exactly as it was just before this scenario first
 * ran, rebuilt from the (immutable) log prefix. If the scenario has never run, that is the
 * project now. A built-in scenario that is not installed is installed in the temporary copy only.
 */
export function resolveBase(events, scenarioId) {
  const first = events.findIndex(e => e.type === 'scenario.advance' && e.payload.scenarioId === scenarioId);
  const prefix = first < 0 ? events : events.slice(0, first);
  let state = replay(prefix);
  const builtIn = BUILT_IN[scenarioId];
  let sandboxInstall = false;
  if (builtIn && !builtIn.cast.every(id => state.entities.character[id])) {
    if (state.entities.world[builtIn.worldId] || builtIn.cast.some(id => state.entities.character[id])) throw new Error(`${builtIn.name} is only partly present in this project, so it cannot be used as a starting point.`);
    state = replay([...prefix, ...builtIn.installEvents().map(([t, p], i) => makeEvent(prefix.length + i + 1, t, p, FIXED))]);
    sandboxInstall = true;
  }
  let scenario = builtIn;
  if (!builtIn) {
    const ent = state.entities.scenario[scenarioId];
    if (!ent) throw new Error('That scenario does not exist at the starting point.');
    const c = compileScenario(ent, state);
    if (!c.scenario) throw new Error(`The scenario has problems to fix first: ${c.errors.join(' ')}`);
    scenario = c.scenario;
  }
  return { state, scenario, baseSeq: prefix.length, sandboxInstall, baseDigest: digest({ entities: state.entities, scenarios: state.scenarios, sandboxInstall }) };
}

function setPath(ch, path, value) {
  if (path === 'place') return { ...ch, place: String(value) };
  if (path === 'asleep') return { ...ch, asleep: value === true || value === 'true' };
  const [group, key] = path.split('.');
  return { ...ch, [group]: { ...ch[group], [key]: Number(value) } };
}

/** Problems that depend on the project (does the character exist, is the place real, ...). */
export function definitionProblems(def, base) {
  const out = structuralProblems(def);
  const { state, scenario } = base;
  if (def.ticks > scenario.maxTicks) out.push(`This scenario has ${scenario.maxTicks} minutes; the comparison asks for ${def.ticks}.`);
  if (def.researchItemId && !state.entities.inbox[def.researchItemId]) out.push('The linked research item does not exist at the starting point.');
  const places = state.entities.world[scenario.worldId]?.places || [];
  const options = scenario.situation({}).options;
  for (const p of def.variants.flatMap(v => v.patches)) {
    if (p.kind === 'character.set' || p.kind === 'belief.set') {
      if (!scenario.cast.includes(p.characterId)) out.push('The character being varied is not in this scenario’s cast.');
      if (p.kind === 'character.set' && p.path === 'place' && !places.includes(p.value)) out.push(`"${p.value}" is not a place in this world.`);
      if (p.kind === 'character.set' && /^(traits|values)\./.test(p.path) && !(Number(p.value) >= 0 && Number(p.value) <= 1)) out.push('Trait and value settings must be between 0 and 1.');
      if (p.kind === 'belief.set' && !p.claim) out.push('Name the claim whose confidence is varied.');
    }
    if (p.kind === 'event.remove' && !scenario.script[p.minute]?.[p.index]) out.push(`There is no scripted world event number ${p.index + 1} at minute ${p.minute}.`);
    if (p.kind === 'option.remove' && !options.some(o => o.id === p.optionId)) out.push('The action option being removed does not exist in this scenario.');
  }
  return [...new Set(out)];
}

/** Returns a patched copy. The base state and scenario are never modified. */
export function applyVariant(base, patches) {
  let state = base.state, scenario = base.scenario;
  for (const p of patches) {
    if (p.kind === 'character.set' || p.kind === 'belief.set') {
      const ch = state.entities.character[p.characterId];
      let next;
      if (p.kind === 'belief.set') {
        const has = ch.beliefs.some(b => b.claim.toLowerCase() === p.claim.toLowerCase());
        next = { ...ch, beliefs: has ? ch.beliefs.map(b => b.claim.toLowerCase() === p.claim.toLowerCase() ? { ...b, confidence: p.confidence } : b) : [...ch.beliefs, { claim: p.claim, confidence: p.confidence }] };
      } else next = setPath(ch, p.path, p.value);
      next = { ...ch, ...normalize('character', next) };
      state = { ...state, entities: { ...state.entities, character: { ...state.entities.character, [ch.id]: next } } };
      // Authored scenarios place the cast at minute 1; keep that consistent with the varied start.
      if (p.kind === 'character.set' && (p.path === 'place' || p.path === 'asleep') && scenario.start)
        scenario = { ...scenario, start: scenario.start.map(s => s.characterId === ch.id ? { ...s, place: next.place, asleep: next.asleep } : s) };
    } else if (p.kind === 'event.remove') {
      scenario = { ...scenario, script: { ...scenario.script, [p.minute]: scenario.script[p.minute].filter((_, i) => i !== p.index) } };
    } else if (p.kind === 'option.remove') {
      const inner = scenario.situation;
      scenario = { ...scenario, situation: world => { const s = inner(world); return { ...s, options: s.options.filter(o => o.id !== p.optionId) }; } };
    }
  }
  return { state, scenario };
}

const hasEffect = o => !!o?.effects && Object.keys(o.effects).length > 0;

/** Compact, comparable record of one in-memory run. */
function summarizeRun(run, scenario, seedOffset) {
  const cast = scenario.cast;
  const grid = [], kinds = [], feasible = [];
  for (const t of run.ticks) {
    const sim = t.events.find(e => e[0] === 'sim.run')[1];
    const opts = Object.fromEntries(sim.situation.options.map(o => [o.id, o]));
    grid.push(cast.map(id => t.actions.find(a => a.characterId === id)?.optionId || ''));
    kinds.push(cast.map(id => {
      const a = t.actions.find(x => x.characterId === id);
      if (!a || !a.optionId) return 'stuck';
      if (sim.decisions.find(d => d.characterId === id)?.inputs.character.asleep) return 'asleep';
      return hasEffect(opts[a.optionId]) ? 'active' : 'passive';
    }));
    feasible.push(cast.map(id => { const d = sim.decisions.find(x => x.characterId === id); return d ? d.ranking.filter(r => hasEffect(opts[r.optionId])).length : 0; }));
  }
  const labels = {};
  for (const t of run.ticks) for (const a of t.actions) labels[a.optionId || ''] = a.label;
  const matrix = knowledgeMatrix(run.state, scenario).filter(r => r.event.provenance === 'author');
  const hearsay = run.ticks.reduce((n, t) => n + t.conversations.length + t.actions.reduce((m, a) => m + (a.told?.length || 0), 0), 0);
  return { seedOffset, grid, kinds, feasible, labels, hearsay,
    knowledge: matrix.map(r => ({ event: `${r.event.clock} ${r.event.title}`, how: r.cells.map(c => c.how === 'perceived' || c.how === 'did it' ? 'perceived' : c.how === 'unaware' ? 'unaware' : 'told') })),
    beliefs: Object.fromEntries(cast.map(id => [id, Object.fromEntries(run.state.entities.character[id].beliefs.map(b => [b.claim, b.confidence]))])),
    places: cast.map(id => run.state.entities.character[id].place),
    // The digest covers every event the run produced, decisions and their term-by-term reasons included.
    runDigest: digest(run.ticks.map(t => t.events)) };
}

function aggregate(runs, cast, ticks) {
  const n = runs.length;
  const choice = Object.fromEntries(cast.map(id => [id, {}]));
  const first = Object.fromEntries(cast.map(id => [id, {}]));
  const kindsByTick = Array.from({ length: ticks }, () => ({ active: 0, passive: 0, asleep: 0, stuck: 0 }));
  const feasibleByTick = Array.from({ length: ticks }, () => 0);
  for (const r of runs) {
    r.grid.forEach((row, t) => row.forEach((opt, c) => {
      choice[cast[c]][opt] = (choice[cast[c]][opt] || 0) + 1;
      const f = (first[cast[c]][opt] ||= []);
      if (!r.grid.slice(0, t).some(prev => prev[c] === opt)) f.push(t + 1);
      kindsByTick[t][r.kinds[t][c]]++;
      feasibleByTick[t] += r.feasible[t][c];
    }));
  }
  const cells = n * cast.length;
  const labels = Object.assign({}, ...runs.map(r => r.labels));
  const events = runs[0]?.knowledge.map(k => k.event) || [];
  const claims = {};
  for (const r of runs) for (const id of cast) for (const [claim, c] of Object.entries(r.beliefs[id])) ((claims[id] ||= {})[claim] ||= []).push(c);
  return {
    runs: n, distinctRuns: new Set(runs.map(r => JSON.stringify(r.grid))).size, labels, // distinct sequences of actions, ignoring the size of the nudges
    choiceShare: Object.fromEntries(cast.map(id => [id, Object.fromEntries(Object.entries(choice[id]).map(([o, k]) => [o, r3(k / (n * ticks))]))])),
    firstMinute: Object.fromEntries(cast.map(id => [id, Object.fromEntries(Object.entries(first[id]).map(([o, list]) => [o, { reachedIn: list.length, of: n, meanMinute: r3(mean(list)) }]))])),
    byMinute: kindsByTick.map((k, t) => ({ minute: t + 1, activeShare: r3(k.active / cells), passiveShare: r3(k.passive / cells), asleepShare: r3(k.asleep / cells), stuckShare: r3(k.stuck / cells),
      meanActiveOptions: r3(feasibleByTick[t] / cells) })),
    passiveShare: r3(mean(kindsByTick.map(k => k.passive / cells))),
    hearsayMean: r3(mean(runs.map(r => r.hearsay))),
    knowledge: events.map((event, e) => ({ event, perceived: r3(mean(runs.map(r => r.knowledge[e]?.how.filter(h => h === 'perceived').length ?? 0))),
      told: r3(mean(runs.map(r => r.knowledge[e]?.how.filter(h => h === 'told').length ?? 0))), unaware: r3(mean(runs.map(r => r.knowledge[e]?.how.filter(h => h === 'unaware').length ?? 0))) })),
    endBeliefs: Object.fromEntries(Object.entries(claims).map(([id, cs]) => [id, Object.fromEntries(Object.entries(cs).map(([claim, list]) => [claim, r3(mean(list))]))])),
    endPlaces: Object.fromEntries(cast.map((id, c) => { const tally = {}; for (const r of runs) tally[r.places[c]] = (tally[r.places[c]] || 0) + 1; return [id, Object.fromEntries(Object.entries(tally).map(([p, k]) => [p, r3(k / n)]))]; })),
  };
}

/** Paired comparison: the same dice set in both variants, so a difference comes from the factor. */
function compare(control, variant, cast) {
  const perSeed = [], perChar = cast.map(() => 0);
  let firstDiff = null;
  variant.runs.forEach((run, i) => {
    const ref = control.runs[i];
    let diff = 0;
    run.grid.forEach((row, t) => row.forEach((opt, c) => {
      if (opt === ref.grid[t]?.[c]) return;
      diff++; perChar[c]++;
      if (!firstDiff || t + 1 < firstDiff.minute) firstDiff = { seedOffset: run.seedOffset, minute: t + 1, characterId: cast[c], control: ref.labels[ref.grid[t][c]] ?? ref.grid[t][c], variant: run.labels[opt] ?? opt };
    }));
    perSeed.push(diff);
  });
  const cells = (variant.runs[0]?.grid.length || 0) * cast.length;
  return { control: control.id, variant: variant.id, cellsPerRun: cells, differingCells: { mean: r3(mean(perSeed)), min: Math.min(...perSeed), max: Math.max(...perSeed) },
    shareDiffering: r3(mean(perSeed) / Math.max(1, cells)), seedsWithAnyDifference: perSeed.filter(d => d > 0).length, seeds: perSeed.length,
    byCharacter: Object.fromEntries(cast.map((id, c) => [id, r3(perChar[c] / Math.max(1, perSeed.length * (cells / cast.length)))])), firstDifference: firstDiff,
    passiveShareChange: r3(variant.aggregate.passiveShare - control.aggregate.passiveShare), hearsayChange: r3(variant.aggregate.hearsayMean - control.aggregate.hearsayMean) };
}

/**
 * Run every variant for every dice set, in memory. Pure: same definition + same log prefix
 * always returns the same results and the same digest. Throws if the definition has problems.
 */
export function runExperiment(def, events) {
  const base = resolveBase(events, def.scenarioId);
  const problems = definitionProblems(def, base);
  if (problems.length) throw new Error(problems.join(' '));
  const cast = base.scenario.cast;
  const variants = def.variants.map(v => {
    const runs = def.seeds.map(seedOffset => {
      const { state, scenario } = applyVariant(base, v.patches);
      return summarizeRun(previewScenario(state, scenario, def.ticks, { seedOffset }), scenario, seedOffset);
    });
    return { id: v.id, label: v.label, patches: v.patches, runs, aggregate: aggregate(runs, cast, def.ticks) };
  });
  const comparisons = variants.slice(1).map(v => compare(variants[0], v, cast));
  // Keep each run small in the stored result: its dice set, its digest and who did what each minute.
  // Anything else can be recomputed exactly with inspectRun().
  for (const v of variants) v.runs = v.runs.map(r => ({ seedOffset: r.seedOffset, runDigest: r.runDigest, grid: r.grid }));
  const core = { version: EXPERIMENT_VERSION, baseSeq: base.baseSeq, baseDigest: base.baseDigest, sandboxInstall: base.sandboxInstall, cast,
    castNames: Object.fromEntries(cast.map(id => [id, base.state.entities.character[id].name])), ticks: def.ticks, seeds: def.seeds,
    factor: patchTarget(def.variants.flatMap(v => v.patches)[0]), variants, comparisons };
  return { ...core, resultDigest: digest(core) };
}

/** Recompute one run in full (every event, every decision trace) for inspection. Writes nothing. */
export function inspectRun(def, events, variantId, seedOffset) {
  const base = resolveBase(events, def.scenarioId);
  const v = def.variants.find(x => x.id === variantId);
  if (!v) throw new Error('No such variant');
  const { state, scenario } = applyVariant(base, v.patches);
  return { ...previewScenario(state, scenario, def.ticks, { seedOffset }), scenario, base };
}

export { seedFor };
