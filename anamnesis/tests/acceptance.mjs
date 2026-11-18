// Acceptance run for the experimental mechanisms P1 and P3 (OD-005), against the criteria fixed
// beforehand in Drive doc 13. Deterministic: same code -> same output. Writes nothing to any log.
//
//   node tests/acceptance.mjs            prints a plain-text report
//   node tests/acceptance.mjs --json     prints the full result as JSON
//
// IMPORTANT: the comparisons use a SYNTHETIC TEST FIXTURE (js/core/fixtures.mjs), not approved
// story content. Thresholds below are copied from doc 13 and must not be edited to make a run pass.
import { runExperiment, inspectRun } from '../js/core/experiment.mjs';
import { normalizeExperiment } from '../js/core/experiment-schema.mjs';
import { verifyDecision, updateBelief, EXPERIENCE_CREDIBILITY } from '../js/core/cognition.mjs';
import { apply, makeEvent } from '../js/core/store.mjs';
import { digest } from '../js/core/rng.mjs';
import { FIXTURES } from '../js/core/fixtures.mjs';

// Old House, 8 minutes, dice sets 0-19, both switches off, measured at commit 3b8fcb5 (before any P1/P3 code).
export const FROZEN_3B8FCB5 = ['8229f4c4642efa28', '33ce8364d8b00388', '7878662af31b47e6', '41a32b298e834de5', '789bf6f035fdb7fc', '41fe0959035672a5', '02427b9758e6109b', '7bdeeda59783ad61', 'f2284b04a27e7d28', 'bad565696eb836c5',
  'edbfe24f26de1de3', '7d613a06eef5e57a', 'b48ae30c78de22c8', '6522ead2a1009016', '7144140175f959c5', '49757574c057fbe8', 'c68cd89586318e71', '6d27d2ed79cc3671', '61500c81c364a9d5', '8ebedf0eea555b0a'];
export const THRESHOLDS = { A1: 0.40, A2: 1.5, A3overall: 0.10, A3character: 0.20, B5seeds: 10, G8seconds: 5 }; // doc 13
export const BASELINE = { acting: [0.39, 0.19, 0.16, 0.16], optionsAt8: 0.94 }; // doc 13 §1

const SEEDS = Array.from({ length: 20 }, (_, i) => i);
const HEATING = 'The noises are just the heating';
const THOMAS = 'oh-thomas', DANIEL = 'oh-daniel';
const FIX = 'fixture:oldhouse-p1p3';
const def = (title, scenarioId, key) => normalizeExperiment({ title, scenarioId, ticks: 8, seeds: SEEDS, hypothesis: `Switching ${key} on changes behaviour as doc 12 predicts.`, prediction: 'See doc 12 section 3.',
  variants: [{ id: 'A', label: 'off (control)', patches: [] }, { id: 'B', label: 'on', patches: [{ kind: 'mechanism.set', key, value: true }] }] });
export const DEFS = {
  'C-P1': def('C-P1 · repeatable actions off → on', FIX, 'repeatableActions'),
  'C-P3': def('C-P3 · experience-driven beliefs off → on', FIX, 'experienceBeliefs'),
  'C-P1xP3 (P3 held on; P1 off → on)': def('C-P1×P3 a', FIX + '+p3', 'repeatableActions'),
  'C-P1xP3 (P1 held on; P3 off → on)': def('C-P1×P3 b', FIX + '+p1', 'experienceBeliefs'),
  'C-null P1': def('C-null · P1 on, no declarations', 'oldhouse', 'repeatableActions'),
  'C-null P3': def('C-null · P3 on, no declarations', 'oldhouse', 'experienceBeliefs'),
};

const r3 = x => Math.round(x * 1000) / 1000;
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const check = (id, name, pass, detail) => ({ id, name, pass: !!pass, detail });
const flat = run => run.ticks.flatMap(t => t.events);
const full = (d, v) => SEEDS.map(s => inspectRun(d, [], v, s));

/** Gates that are checked the same way in every comparison. */
function commonGates(d, res, runsA, runsB) {
  const out = [];
  // G3 replay
  let decisions = 0, bad = 0, stateOk = true;
  for (const run of [...runsA, ...runsB]) {
    for (const t of run.ticks) for (const dec of t.events.find(e => e[0] === 'sim.run')[1].decisions) { decisions++; if (!verifyDecision(dec).ok) bad++; }
    let s = run.base.state;
    for (const [type, payload] of flat(run)) s = apply(s, makeEvent(s.seq + 1, type, payload, '1970-01-01T00:00:00.000Z'), { sandbox: true });
    if (s.rejected.length !== run.base.state.rejected.length || digest(s.entities) !== digest(run.state.entities)) stateOk = false;
  }
  const again = runExperiment(d, []);
  out.push(check('G3', 'Replay: every decision verifies; events replay to the same state; re-run reproduces digests',
    bad === 0 && stateOk && again.resultDigest === res.resultDigest && again.measures.digest === res.measures.digest,
    `${decisions} decisions, ${bad} failed; state replay ${stateOk ? 'identical' : 'DIFFERENT'}; result digest ${res.resultDigest} re-run ${again.resultDigest}; measures digest ${res.measures.digest} re-run ${again.measures.digest}`));
  // G4 privacy
  let truthLeaks = 0, keyHolders = new Set(), unheld = 0, nonPerceiver = 0;
  for (const run of [...runsA, ...runsB]) {
    const truths = run.state.worldEvents.map(e => e.truth).filter(Boolean);
    for (const ch of run.scenario.cast.map(id => run.state.entities.character[id])) {
      for (const m of ch.memories) { if (truths.some(t => m.text.includes(t))) truthLeaks++; if (m.tags.includes('key')) keyHolders.add(ch.id); }
    }
    for (const u of run.ticks.flatMap(t => t.beliefUpdates)) {
      const ch = run.state.entities.character[u.characterId];
      const mem = ch.memories.find(m => m.id === u.source.ref);
      if (!mem) { unheld++; continue; }
      const we = run.state.worldEvents.find(e => e.id === mem.originId);
      if (we && !we.perceptions.some(p => p.characterId === ch.id)) nonPerceiver++;
    }
  }
  out.push(check('G4', 'Privacy: no memory holds world truth; only Daniel knows the key; no update without the character’s own perception',
    truthLeaks === 0 && [...keyHolders].join() === DANIEL && unheld === 0 && nonPerceiver === 0,
    `truth leaks ${truthLeaks}; key known by ${[...keyHolders].join(', ')}; updates citing a memory not held ${unheld}; updates for non-perceivers ${nonPerceiver}`));
  // G5 in character
  const ooc = res.measures.variants.B.outOfCharacter;
  out.push(check('G5', 'In character: 0 of 20 runs with a must-not-happen action', ooc.every(r => r.runs === 0), ooc.map(r => `${r.label}: ${r.runs}/${r.of}`).join('; ')));
  // G6 explained
  let sumBad = 0, noReason = 0;
  for (const run of runsB) {
    for (const t of run.ticks) for (const dec of t.events.find(e => e[0] === 'sim.run')[1].decisions) for (const r of dec.ranking) {
      if (Math.abs(r.total - r3(r.terms.reduce((s, x) => s + x.value, 0))) > 0.0011) sumBad++;
      if (r.terms.some(x => !x.why)) noReason++;
    }
    for (const u of run.ticks.flatMap(t => t.beliefUpdates)) if (!u.terms?.length || u.terms.some(x => !x.why) || !u.source?.ref) noReason++;
  }
  out.push(check('G6', 'Explained: every total equals the sum of its named terms; every term and belief update carries its reason', sumBad === 0 && noReason === 0, `totals not matching their terms ${sumBad}; terms or updates without a reason ${noReason}`));
  return out;
}

function controlIsBaseline(runsA, res) {
  const digests = runsA.map(r => digest(flat(r)));
  const same = digests.every((x, i) => x === FROZEN_3B8FCB5[i]);
  const acting = res.variants[0].aggregate.byMinute.slice(4).map(m => m.activeShare);
  return check('G1', 'Off is identical: control arm (declarations present, switches off) equals the 3b8fcb5 logs for dice sets 0–19', same,
    `${digests.filter((x, i) => x === FROZEN_3B8FCB5[i]).length}/20 log digests equal; acting share minutes 5–8 ${acting.map(x => Math.round(x * 100) + '%').join(' / ')} (doc 13: 39/19/16/16); useful options at minute 8: ${res.variants[0].aggregate.byMinute[7].meanActiveOptions} (doc 13: 0.94)`);
}

function p1Criteria(res, runsA, runsB, scenario) {
  const B = res.variants[1].aggregate, M = res.measures.variants.B, A = res.variants[0];
  const out = [];
  const late = mean(B.byMinute.slice(4).map(m => m.activeShare));
  const lateA = mean(A.aggregate.byMinute.slice(4).map(m => m.activeShare));
  out.push(check('A1', `Late activity: mean acting share minutes 5–8 ≥ ${THRESHOLDS.A1 * 100}%`, late >= THRESHOLDS.A1, `${r3(late * 100)}% (control ${r3(lateA * 100)}%); by minute ${B.byMinute.slice(4).map(m => Math.round(m.activeShare * 100) + '%').join(' / ')}`));
  out.push(check('A2', `Options stay open: useful options per character at minute 8 ≥ ${THRESHOLDS.A2}`, B.byMinute[7].meanActiveOptions >= THRESHOLDS.A2, `${B.byMinute[7].meanActiveOptions} (control ${A.aggregate.byMinute[7].meanActiveOptions})`));
  const worst = Object.entries(M.loopIndex.byCharacter).sort((a, b) => b[1].index - a[1].index)[0];
  out.push(check('A3', `No loops: loop index ≤ ${THRESHOLDS.A3overall * 100}% overall and ≤ ${THRESHOLDS.A3character * 100}% for any character`,
    M.loopIndex.overall.index <= THRESHOLDS.A3overall && worst[1].index <= THRESHOLDS.A3character,
    `overall ${r3(M.loopIndex.overall.index * 100)}% (A-B-A ${r3(M.loopIndex.overall.aba * 100)}%, same again ${r3(M.loopIndex.overall.sameAgain * 100)}%); highest ${worst[0]} ${r3(worst[1].index * 100)}%; control overall ${r3(res.measures.variants.A.loopIndex.overall.index * 100)}%`));
  const caps = Object.entries(scenario.repeatOptions).map(([opt, r]) => ({ opt, cap: r.maxUses, max: M.maxUses[opt]?.uses || 0 }));
  out.push(check('A4', 'Caps hold: no character exceeds any option’s use cap', caps.every(c => c.max <= c.cap), caps.map(c => `${c.opt} max ${c.max} of cap ${c.cap}`).join('; ')));
  let early = 0;
  res.variants[1].runs.forEach((r, i) => { for (let t = 0; t < 2; t++) if (JSON.stringify(r.grid[t]) !== JSON.stringify(A.runs[i].grid[t])) early++; });
  out.push(check('A5', 'Early minutes unchanged: minutes 1–2 identical to the control in all 20 dice sets', early === 0, `${early} differing minute(s)`));
  let repeats = 0, uncaused = 0;
  for (const run of runsB) for (const id of run.scenario.cast) for (const [opt, rule] of Object.entries(scenario.repeatOptions)) {
    if (!rule.reopenOn) continue;
    const times = run.ticks.filter(t => t.actions.some(a => a.characterId === id && a.optionId === opt)).map(t => t.events[0][1].storyTime);
    const mems = run.state.entities.character[id].memories;
    for (let k = 1; k < times.length; k++) { repeats++; if (!mems.some(m => m.at > times[k - 1] && m.at <= times[k] && m.tags.some(x => rule.reopenOn.includes(x)))) uncaused++; }
  }
  out.push(check('A6', 'Reopening is caused: every repeat of a reopenOn option follows a newer memory with a listed tag', uncaused === 0, `${repeats} repeat(s) of reopenOn options; ${uncaused} without a newer tagged memory`));
  return out;
}

function p3Criteria(res, runsA, runsB) {
  const out = [];
  const cast = res.cast, ti = cast.indexOf(THOMAS);
  let b1bad = 0, close = 0, far = 0, b2bad = 0, updates = 0, danielHeat = 0, notHeld = 0, bounds = 0, dup = 0;
  const finals = [];
  for (const run of runsB) {
    const ups = run.ticks.flatMap(t => t.beliefUpdates);
    const thomas = run.state.entities.character[THOMAS];
    const knock2 = run.state.worldEvents.find(e => e.title === 'One knock, softer');
    const per = knock2?.perceptions.find(p => p.characterId === THOMAS);
    const final = thomas.beliefs.find(b => b.claim === HEATING).confidence;
    finals.push(final);
    const heatIds = run.state.worldEvents.filter(e => e.title === 'Heating test').map(e => e.id);
    if (per && (per.channel === 'saw and heard' || per.channel === 'heard close')) { close++; if (!(final < 0.85)) b1bad++; }
    else { far++; if (ups.some(u => u.characterId === THOMAS && u.claim === HEATING && !heatIds.some(h => u.source.ref === `mem-${h}-${THOMAS}`))) b1bad++; }
    for (const u of ups) {
      updates++;
      if (u.direction < 0 && u.after > u.before) b1bad++;
      const again = updateBelief({ id: u.characterId, name: u.characterName, beliefs: [{ claim: u.claim, confidence: u.before }] }, u.claim, { direction: u.direction, strength: u.strength, credibility: EXPERIENCE_CREDIBILITY, source: u.source });
      if (again.after !== u.after || JSON.stringify(again.terms) !== JSON.stringify(u.terms) || u.credibility !== EXPERIENCE_CREDIBILITY || u.isNew) b2bad++;
      if (u.characterId === DANIEL && heatIds.some(h => u.source.ref.startsWith(`mem-${h}-`))) danielHeat++;
      if (!run.state.entities.character[u.characterId].memories.some(m => m.id === u.source.ref)) notHeld++;
      if (u.after < 0.02 || u.after > 0.98) bounds++;
    }
    const seen = new Set();
    for (const u of ups) { const k = `${u.tick}|${u.characterId}|${u.claim}`; if (seen.has(k)) dup++; seen.add(k); }
    for (const id of cast) for (const b of run.state.entities.character[id].beliefs) if (b.confidence < 0.02 || b.confidence > 0.98) bounds++;
  }
  out.push(check('B1', 'Direction: where Thomas perceives the second knock closely his “just the heating” confidence ends below 0.85; elsewhere it changes only through his own heating test; no contradicting evidence raises a belief',
    b1bad === 0, `perceived closely in ${close}/20 runs, not in ${far}; violations ${b1bad}; his final confidence ranges ${Math.min(...finals)}–${Math.max(...finals)} (mean ${r3(mean(finals))})`));
  out.push(check('B2', 'Size is the rule’s: every update equals what the existing belief rule gives for its inputs, exactly', b2bad === 0, `${updates} update(s) recomputed; ${b2bad} mismatch(es)`));
  out.push(check('B3', 'No leak: Daniel has no update from the heating test; no update cites a memory the character does not hold', danielHeat === 0 && notHeld === 0, `Daniel heating-test updates ${danielHeat}; updates citing a memory not held ${notHeld}`));
  let early = 0, untraceable = 0;
  res.variants[1].runs.forEach((r, i) => { for (let t = 0; t < 3; t++) r.grid[t].forEach((opt, c) => {
    if (opt === res.variants[0].runs[i].grid[t][c]) return;
    early++;
    if (!runsB[i].ticks.slice(0, t).some(tk => tk.beliefUpdates.some(u => u.characterId === cast[c] && /^mem-we-.*-a\d+-/.test(u.source.ref)))) untraceable++;
  }); });
  out.push(check('B4', 'Early minutes unchanged: minutes 1–3 identical to the control, except after a character’s own heating-test update', untraceable === 0, `${early} differing character-minute(s) in minutes 1–3; ${untraceable} not traceable to a heating-test update`));
  const atDoor = places => places.slice(4).filter(p => p[ti] === 'Basement stairs').length;
  const pa = res.measures.variants.A.placesByMinute.map(atDoor), pb = res.measures.variants.B.placesByMinute.map(atDoor);
  const higher = pb.filter((x, i) => x > pa[i]).length, lower = pb.filter((x, i) => x < pa[i]).length;
  out.push(check('B5', `Behaviour follows belief: Thomas spends more minutes at the basement door after 02:16 than in the control in ≥ ${THRESHOLDS.B5seeds} of 20 dice sets`, higher >= THRESHOLDS.B5seeds,
    `higher in ${higher}/20, lower in ${lower}/20, equal in ${20 - higher - lower}/20; minutes at the door after 02:16, mean: on ${r3(mean(pb))}, control ${r3(mean(pa))}`));
  out.push(check('B6', 'Bounded: every confidence within 0.02–0.98; at most one update per character per claim per minute', bounds === 0 && dup === 0, `out of bounds ${bounds}; duplicate same-minute updates ${dup}`));
  const sixty = updateBelief({ id: 'x', name: 'x', beliefs: [{ claim: 'c', confidence: 0.6 }] }, 'c', { direction: -1, strength: 0.7, credibility: EXPERIENCE_CREDIBILITY });
  const ninety = updateBelief({ id: 'x', name: 'x', beliefs: [{ claim: 'c', confidence: 0.9 }] }, 'c', { direction: -1, strength: 0.7, credibility: EXPERIENCE_CREDIBILITY });
  const shift = u => Math.abs(u.terms.find(t => t.label === 'log-odds shift').value);
  out.push(check('B7', 'Perseverance visible: the same contrary evidence shifts a belief held at 0.9 less than one held at 0.6', shift(ninety) < shift(sixty), `log-odds shift ${shift(sixty)} at 0.6, ${shift(ninety)} at 0.9`));
  return out;
}

export function runAcceptance() {
  const report = { generated: 'deterministic; no timestamp', fixture: FIXTURES[FIX].name, thresholds: THRESHOLDS, comparisons: {} };
  for (const [name, d] of Object.entries(DEFS)) {
    const t0 = performance.now();
    const res = runExperiment(d, []);
    const seconds = (performance.now() - t0) / 1000;
    const runsA = full(d, 'A'), runsB = full(d, 'B');
    const scenario = runsB[0].scenario, key = d.variants[1].patches[0].key;
    const checks = [];
    if (name.startsWith('C-null')) {
      const c = res.comparisons[0];
      checks.push(check('G2', 'Null: switch on with no declarations gives zero differing character-minutes in all dice sets', c.seedsWithAnyDifference === 0 && c.differingCells.max === 0, `${c.seedsWithAnyDifference}/20 dice sets differ; ${res.measures.variants.B.beliefUpdates.total} belief update(s)`));
      checks.push(controlIsBaseline(runsA, res));
    } else {
      const held = runsA[0].scenario.mechanisms || {};
      if (!held.repeatableActions && !held.experienceBeliefs) checks.push(controlIsBaseline(runsA, res));
      checks.push(...(key === 'repeatableActions' ? p1Criteria(res, runsA, runsB, scenario) : p3Criteria(res, runsA, runsB)));
    }
    checks.push(...commonGates(d, res, runsA, runsB));
    checks.push(check('G8', `Performance: 20 × 2 runs of 8 minutes in under ${THRESHOLDS.G8seconds} s (this machine)`, seconds < THRESHOLDS.G8seconds, `${seconds.toFixed(2)} s`));
    const c = res.comparisons[0];
    report.comparisons[name] = { title: d.title, scenario: d.scenarioId, factor: res.factor, held: runsA[0].scenario.mechanisms || { repeatableActions: false, experienceBeliefs: false }, resultDigest: res.resultDigest, measuresDigest: res.measures.digest, seconds: Math.round(seconds * 100) / 100,
      differing: { seeds: c.seedsWithAnyDifference, meanCells: c.differingCells.mean, of: c.cellsPerRun, first: c.firstDifference }, checks,
      actingByMinute: { A: res.variants[0].aggregate.byMinute.map(m => m.activeShare), B: res.variants[1].aggregate.byMinute.map(m => m.activeShare) },
      optionsByMinute: { A: res.variants[0].aggregate.byMinute.map(m => m.meanActiveOptions), B: res.variants[1].aggregate.byMinute.map(m => m.meanActiveOptions) },
      loopIndex: { A: res.measures.variants.A.loopIndex, B: res.measures.variants.B.loopIndex }, maxUses: res.measures.variants.B.maxUses,
      beliefUpdates: { total: res.measures.variants.B.beliefUpdates.total, byCharacter: res.measures.variants.B.beliefUpdates.byCharacter, notApplied: res.measures.variants.B.beliefUpdates.notApplied },
      thomasHeatingByMinute: { A: res.measures.variants.A.beliefByMinute[THOMAS]?.[HEATING], B: res.measures.variants.B.beliefByMinute[THOMAS]?.[HEATING] },
      choiceShare: { A: res.variants[0].aggregate.choiceShare, B: res.variants[1].aggregate.choiceShare }, labels: res.variants[1].aggregate.labels };
  }
  report.failed = Object.entries(report.comparisons).flatMap(([n, c]) => c.checks.filter(x => !x.pass).map(x => `${n}: ${x.id}`));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rep = runAcceptance();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rep, null, 1));
  else {
    console.log(`ANAMNESIS · P1/P3 acceptance run (doc 13 thresholds, unchanged)\nFixture: ${rep.fixture}\n`);
    for (const [n, c] of Object.entries(rep.comparisons)) {
      console.log(`== ${n} · ${c.scenario} · result ${c.resultDigest} · measures ${c.measuresDigest}`);
      console.log(`   B differs from A in ${c.differing.seeds}/20 dice sets, mean ${c.differing.meanCells} of ${c.differing.of} character-minutes`);
      for (const k of c.checks) console.log(`   ${k.pass ? 'PASS' : 'FAIL'} ${k.id.padEnd(3)} ${k.name}\n          ${k.detail}`);
      console.log('');
    }
    console.log(rep.failed.length ? `FAILED CRITERIA (${rep.failed.length}): ${rep.failed.join(' | ')}` : 'All criteria passed.');
  }
}
