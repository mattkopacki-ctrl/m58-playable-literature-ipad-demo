// Experimental mechanisms P1 (repeatable actions) and P3 (experience-driven beliefs), OD-005.
// Tests follow the lists in Drive doc 12 §1.8 and §2.9 and the gates in doc 13.
// Anything named FIXTURE is a synthetic test fixture, not approved story content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, makeEvent, apply } from '../js/core/store.mjs';
import { decide, verifyDecision, feasibility, repeatAvailability, experienceUpdates, updateBelief, engineId, ENGINE_VERSION, REPEAT_COEF, EXPERIENCE_CREDIBILITY } from '../js/core/cognition.mjs';
import { stepScenario, previewScenario, perceptionEvidence, buildWorldEvent, scenarioStatus } from '../js/core/scenario.mjs';
import { OLD_HOUSE } from '../js/core/oldhouse.mjs';
import { FIXTURES, FIXTURE_LABEL } from '../js/core/fixtures.mjs';
import { compileScenario, scenarioDataFromBuiltIn } from '../js/core/studio.mjs';
import { normalize } from '../js/core/schema.mjs';
import { normalizeExperiment, structuralProblems } from '../js/core/experiment-schema.mjs';
import { runExperiment, resolveBase, definitionProblems, scenarioChoices, loopCounts } from '../js/core/experiment.mjs';
import { digest } from '../js/core/rng.mjs';
import { runAcceptance, FROZEN_3B8FCB5 } from './acceptance.mjs';

const FIXED = '1970-01-01T00:00:00.000Z';
const FIX = FIXTURES['fixture:oldhouse-p1p3'];
const HEAT = 'The noises are just the heating', BASE = 'Something is in the basement';
const P1 = { repeatableActions: true, experienceBeliefs: false }, P3 = { repeatableActions: false, experienceBeliefs: true }, BOTH = { repeatableActions: true, experienceBeliefs: true };
const install = () => replay(OLD_HOUSE.installEvents().map(([t, p], i) => makeEvent(i + 1, t, p, FIXED)));
const sandbox = (scenario, mechanisms, seedOffset = 0, state = install(), ticks = 8) => previewScenario(state, scenario, ticks, { seedOffset, mechanisms });
const live = (scenario, seedOffset = 0, opts = {}) => { let s = install(); const evs = []; for (let i = 0; i < 8; i++) { const r = stepScenario(s, scenario, { seedOffset, ...opts }); evs.push(...r.events); s = r.state; } return { s, evs }; };
const grid = run => run.ticks.map(t => FIX.cast.map(id => t.actions.find(a => a.characterId === id)?.optionId || ''));
const person = (memories = [], beliefs = []) => ({ id: 'c1', name: 'Test Person', place: 'Room', asleep: false, traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
  values: {}, goals: [], fears: [], memories, beliefs });
const mem = (id, at, tags) => ({ id, text: id, at, tags, valence: 0, arousal: 0.3, rehearsals: [], source: 'seen' });
const RULE = { tag: 'listened', cooldown: 2, maxUses: 3, reopenOn: ['knock'] };
const H = m => 2 + m / 60; // story hour for 02:mm

// ---------------------------------------------------------------- switches (doc 12 §0, OD-005)

test('OD-005 off by default: a scenario full of repeat and evidence declarations runs exactly like the 3b8fcb5 Old House (G1)', () => {
  const got = FROZEN_3B8FCB5.map((_, seed) => digest(live(FIX, seed).evs));
  assert.deepEqual(got, FROZEN_3B8FCB5);
  assert.deepEqual(FROZEN_3B8FCB5.map((_, seed) => digest(live(OLD_HOUSE, seed).evs)), FROZEN_3B8FCB5);
  // The same holds in the sandbox with both switches off.
  assert.equal(digest(sandbox(FIX, undefined, 3).ticks.flatMap(t => t.events)), FROZEN_3B8FCB5[3]);
});

test('OD-005 never live: a live step ignores the switches wherever they are asked for', () => {
  const on = { ...FIX, mechanisms: BOTH };
  for (const run of [live(on, 2), live(FIX, 2, { mechanisms: BOTH }), live(on, 2, { mechanisms: BOTH })]) {
    assert.equal(digest(run.evs), FROZEN_3B8FCB5[2]);
    assert.ok(!run.evs.some(([t, p]) => t === 'belief.update' || p.mechanisms || p.situation?.mechanisms));
    assert.deepEqual(scenarioStatus(run.s, FIX).mechanisms, { repeatableActions: false, experienceBeliefs: false });
  }
});

test('OD-005 never live: the saved log refuses a run made under a mechanism, and experience updates', () => {
  const run = sandbox(FIX, BOTH, 0);
  const events = run.ticks.flatMap(t => t.events);
  assert.ok(events.some(([t]) => t === 'belief.update'), 'the sandbox run did produce experience updates');
  let s = install();
  const start = s.seq;
  for (const [type, payload] of events) s = apply(s, makeEvent(s.seq + 1, type, payload, FIXED)); // ordinary apply = what the saved log does
  assert.ok(s.rejected.some(r => r.type === 'scenario.advance' && /never in a saved run/.test(r.why)));
  assert.ok(s.rejected.some(r => r.type === 'belief.update' && /only in Preview and comparisons/.test(r.why)));
  assert.equal(s.scenarios.oldhouse, undefined, 'the run never started');
  assert.equal(s.beliefUpdates.length, 0);
  assert.equal(s.seq, start + events.length);
  // The reducer also refuses experience creating a belief, even inside the sandbox.
  const u = { ...updateBelief(install().entities.character['oh-june'], HEAT, { direction: 1, strength: 0.5, credibility: 0.9, source: { type: 'experience', ref: 'm' } }) };
  const s2 = apply(install(), makeEvent(99, 'belief.update', u, FIXED), { sandbox: true });
  assert.match(s2.rejected.at(-1).why, /already holds/);
});

test('switches are pinned at minute 1 and recorded on the run and on every decision (doc 12 S2, S3; P1 test 6)', () => {
  let r = stepScenario(install(), FIX, { sandbox: true, mechanisms: P1 });
  assert.deepEqual(r.events[0][1].mechanisms, P1);
  // Asking for something else later, or changing the scenario, has no effect.
  r = stepScenario(r.state, { ...FIX, mechanisms: BOTH }, { sandbox: true, mechanisms: P3 });
  assert.deepEqual(r.mechanisms, P1);
  assert.deepEqual(r.events[0][1].mechanisms, P1, 'every minute of the run states the switches it ran under');
  const sim = r.events.find(e => e[0] === 'sim.run')[1];
  assert.deepEqual(sim.situation.mechanisms, P1);
  assert.ok(sim.decisions.every(d => d.engine === `${ENGINE_VERSION}+p1` && d.inputs.engine === d.engine));
  // A run started with both off cannot gain one mid-run.
  let off = stepScenario(install(), FIX, { sandbox: true });
  off = stepScenario(off.state, FIX, { sandbox: true, mechanisms: BOTH });
  assert.deepEqual(off.mechanisms, { repeatableActions: false, experienceBeliefs: false });
  assert.equal(engineId(null), ENGINE_VERSION); assert.equal(engineId(BOTH), `${ENGINE_VERSION}+p1+p3`); assert.equal(engineId(P3), `${ENGINE_VERSION}+p3`);
});

// ---------------------------------------------------------------- P1 (doc 12 §1.8)

test('P1 availability: open when unused, closed in the cooldown, open after it, closed at the cap (test 2)', () => {
  const rule = { tag: 'listened', cooldown: 2, maxUses: 3 };
  assert.deepEqual(repeatAvailability(person(), rule, H(13)), { ok: true, why: '', uses: 0 });
  const once = person([mem('a', H(13), ['listened'])]);
  assert.deepEqual(repeatAvailability(once, rule, H(14)), { ok: false, why: 'done 1 minute(s) ago; possible again at 02:15', uses: 1 });
  assert.equal(repeatAvailability(once, rule, H(15)).ok, true);
  const thrice = person([mem('a', H(13), ['listened']), mem('b', H(15), ['listened']), mem('c', H(17), ['listened'])]);
  assert.deepEqual(repeatAvailability(thrice, rule, H(30)), { ok: false, why: 'done 3 of 3 times', uses: 3 });
  // Through the engine: the reason reaches the decision's excluded list; with the switch off the old once-only reason stands.
  const option = { id: 'opt-listen', label: 'Listen', tags: [], repeat: rule, requires: { lacks: ['listened'] } };
  assert.deepEqual(feasibility(once, option, H(14), {}, P1), { ok: false, why: 'done 1 minute(s) ago; possible again at 02:15' });
  assert.deepEqual(feasibility(once, option, H(15), {}, P1), { ok: true, why: '' });
  for (const m of [undefined, null, P3]) assert.deepEqual(feasibility(once, option, H(15), {}, m), { ok: false, why: 'already done: listened' });
});

test('P1 reopenOn: closed until something new with a listed tag has been perceived since the last use (test 3)', () => {
  const before = person([mem('k1', H(13), ['knock']), mem('a', H(14), ['listened'])]);
  assert.deepEqual(repeatAvailability(before, RULE, H(16)), { ok: false, why: 'nothing new since last time (knock)', uses: 1 });
  const sameMinute = person([mem('a', H(14), ['listened']), mem('k', H(14), ['knock'])]);
  assert.equal(repeatAvailability(sameMinute, RULE, H(16)).ok, false, 'a knock in the same minute as the last use is not new');
  const after = person([mem('k1', H(13), ['knock']), mem('a', H(14), ['listened']), mem('k2', H(16), ['knock'])]);
  assert.equal(repeatAvailability(after, RULE, H(16)).ok, true);
  const future = person([mem('a', H(14), ['listened']), mem('k2', H(18), ['knock'])]);
  assert.equal(repeatAvailability(future, RULE, H(16)).ok, false, 'a memory from the future does not count');
});

test('P1 scoring: one named repetition term of -0.15 per earlier use; totals still equal the sum of terms (test 4, G6)', () => {
  const options = [{ id: 'opt-listen', label: 'Listen', tags: ['truth'], repeat: { tag: 'listened', cooldown: 2, maxUses: 5 }, requires: { lacks: ['listened'] } }, { id: 'opt-stay', label: 'Stay', tags: [] }];
  const sit = m => ({ id: 'sit-x', prompt: 'p', tags: [], world: {}, options, ...(m ? { mechanisms: m } : {}) });
  for (const uses of [0, 1, 2]) {
    const ch = person(Array.from({ length: uses }, (_, i) => mem('u' + i, H(10 + i * 3), ['listened'])));
    const d = decide(ch, sit(P1), { now: H(30), seed: 1 });
    const row = d.ranking.find(r => r.optionId === 'opt-listen');
    const rep = row.terms.filter(t => t.source === 'repetition');
    if (!uses) assert.equal(rep.length, 0);
    else { assert.equal(rep.length, 1); assert.equal(rep[0].value, Math.round(-REPEAT_COEF * uses * 1000) / 1000); assert.match(rep[0].why, new RegExp(`already done ${uses} time`)); }
    for (const r of d.ranking) assert.ok(Math.abs(r.total - r.terms.reduce((s, t) => s + t.value, 0)) < 0.0011);
    assert.ok(verifyDecision(d).ok);
  }
  assert.equal(REPEAT_COEF, 0.15, 'doc 13 stop condition: this coefficient is not a tuning knob');
  // Switch off: the option is simply closed after one use and no repetition term exists anywhere.
  const off = decide(person([mem('u', H(10), ['listened'])]), sit(null), { now: H(30), seed: 1 });
  assert.deepEqual(off.excluded.map(e => e.why), ['already done: listened']);
  assert.ok(!off.ranking.some(r => r.terms.some(t => t.source === 'repetition')));
  assert.equal(off.engine, ENGINE_VERSION);
});

test('P1 replay: decisions made with the switch on verify; tampering is caught; records made with it off still verify (test 5)', () => {
  const run = sandbox(FIX, P1, 4);
  const decisions = run.ticks.flatMap(t => t.events.find(e => e[0] === 'sim.run')[1].decisions);
  assert.ok(decisions.some(d => d.ranking.some(r => r.terms.some(t => t.source === 'repetition'))), 'the run exercises the repetition term');
  assert.ok(decisions.some(d => d.excluded.some(e => /possible again at|of \d times|nothing new since/.test(e.why))), 'the run exercises the new closed reasons');
  for (const d of decisions) assert.ok(verifyDecision(d).ok);
  const tampered = structuredClone(decisions.find(d => d.inputs.situation.options.some(o => o.repeat)));
  tampered.inputs.situation.mechanisms = { repeatableActions: false, experienceBeliefs: false };
  const again = decide(tampered.inputs.character, tampered.inputs.situation, tampered.inputs);
  assert.equal(again.engine, ENGINE_VERSION, 'the engine id follows the stored switches');
  for (const d of live(OLD_HOUSE, 4).evs.filter(e => e[0] === 'sim.run').flatMap(e => e[1].decisions)) { assert.equal(d.engine, ENGINE_VERSION); assert.ok(verifyDecision(d).ok); }
});

test('P1 bounds: no cap is exceeded under 50 dice sets; once-only actions stay once-only; cooldowns are respected (tests 8, 9; A4)', () => {
  let repeats = 0;
  for (let seed = 0; seed < 50; seed++) {
    const g = grid(sandbox(FIX, P1, seed));
    FIX.cast.forEach((id, c) => {
      const mine = g.map(row => row[c]);
      for (const [opt, rule] of Object.entries(FIX.repeatOptions)) {
        const at = mine.flatMap((o, t) => (o === opt ? [t] : []));
        assert.ok(at.length <= rule.maxUses, `${id} took ${opt} ${at.length} times (cap ${rule.maxUses}) with dice set ${seed}`);
        for (let k = 1; k < at.length; k++) { repeats++; assert.ok(at[k] - at[k - 1] >= rule.cooldown, `${id} repeated ${opt} inside its cooldown with dice set ${seed}`); }
      }
      for (const once of ['opt-heating', 'opt-wake']) assert.ok(mine.filter(o => o === once).length <= 1, `${id} took the once-only ${once} twice`);
    });
  }
  assert.ok(repeats > 50, `repeats do happen (${repeats})`);
});

test('P1 loop index is computed as doc 13 defines it', () => {
  assert.deepEqual(loopCounts(['a', 'b', 'a', 'b', 'c', 'c'], ['active', 'passive', 'active', 'passive', 'active', 'active']), { awake: 6, aba: 2, same: 1 });
  assert.deepEqual(loopCounts(['s', 's', 'x', 'x'], ['asleep', 'asleep', 'passive', 'passive']), { awake: 2, aba: 0, same: 0 }, 'waiting twice is not a loop; sleeping minutes are not counted');
});

// ---------------------------------------------------------------- P3 (doc 12 §2.9)

test('P3 rule: an experience update is exactly the existing belief rule at first-hand credibility (tests 2, 9; B2, B7)', () => {
  const thomas = install().entities.character['oh-thomas'];
  const { updates, skipped } = experienceUpdates(thomas, [{ memoryId: 'm1', evidence: [{ claim: HEAT, direction: -1, strength: 0.7 }, { claim: BASE, direction: 1, strength: 0.6 }] }]);
  const expected = updateBelief(thomas, HEAT, { direction: -1, strength: 0.7, credibility: 0.9, source: { type: 'experience', ref: 'm1' } });
  assert.deepEqual(updates, [expected]);
  assert.equal(expected.before, 0.85); assert.equal(expected.after, 0.714); assert.equal(expected.isNew, false);
  assert.deepEqual(expected.terms.map(t => t.label), ['prior confidence', 'evidence', 'credibility', 'perseverance', 'log-odds shift']);
  assert.equal(EXPERIENCE_CREDIBILITY, 0.9);
  // Held beliefs only (OD-005): Thomas does not hold the basement claim, so nothing happens and nothing is created.
  assert.deepEqual(skipped.map(s => [s.claim, s.why]), [[BASE, 'claim not held; experience does not create beliefs']]);
  // Perseverance: the same contrary evidence moves a belief held at 0.6 further than one held at 0.9.
  const shift = c => Math.abs(experienceUpdates(person([], [{ claim: 'c', confidence: c }]), [{ memoryId: 'm', evidence: [{ claim: 'c', direction: -1, strength: 0.7 }] }]).updates[0].terms.at(-1).value);
  assert.ok(shift(0.9) < shift(0.6));
});

test('P3 one update per claim per minute: the strongest entry wins, the rest are listed; later evidence that minute is skipped (test 6; B6)', () => {
  const ch = person([], [{ claim: 'c', confidence: 0.6 }]);
  const items = [{ memoryId: 'm1', evidence: [{ claim: 'c', direction: 1, strength: 0.2 }] }, { memoryId: 'm2', evidence: [{ claim: 'C ', direction: -1, strength: 0.5 }, { claim: 'c', direction: 1, strength: 0.5 }] }];
  const { updates } = experienceUpdates(ch, items);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].source.ref, 'm2'); assert.equal(updates[0].direction, -1); assert.equal(updates[0].strength, 0.5);
  assert.deepEqual(updates[0].notApplied, [{ memoryId: 'm1', direction: 1, strength: 0.2, why: 'not applied (same claim, same minute)' }, { memoryId: 'm2', direction: 1, strength: 0.5, why: 'not applied (same claim, same minute)' }]);
  const later = experienceUpdates(ch, items, ['c']);
  assert.equal(later.updates.length, 0); assert.equal(later.skipped.length, 3);
  // In a run: never two updates for the same character, claim and minute.
  for (let seed = 0; seed < 20; seed++) {
    const seen = new Set();
    for (const t of sandbox(FIX, BOTH, seed).ticks) for (const u of t.beliefUpdates) { const k = `${t.tick}|${u.characterId}|${u.claim}`; assert.ok(!seen.has(k)); seen.add(k); assert.ok(u.after >= 0.02 && u.after <= 0.98); }
  }
});

test('P3 in a run: Thomas at the door for the second knock moves from 0.85 by the rule; sleepers, the unaware and non-holders do not move (tests 2, 3, 4; B3)', () => {
  const s0 = install();
  const thomas = s0.entities.character['oh-thomas'];
  const atDoor = { ...s0, entities: { ...s0.entities, character: { ...s0.entities.character, 'oh-thomas': { ...thomas, place: 'Basement stairs' } } } };
  const run = previewScenario(atDoor, { ...FIX, situation: w => { const s = FIX.situation(w); return { ...s, options: s.options.filter(o => ['opt-stay', 'opt-sleep'].includes(o.id)) }; } }, 8, { mechanisms: P3 });
  const ups = run.ticks.flatMap(t => t.beliefUpdates);
  const tu = ups.filter(u => u.characterId === 'oh-thomas');
  assert.equal(tu.length, 1);
  assert.deepEqual([tu[0].tick, tu[0].claim, tu[0].before, tu[0].after, tu[0].direction, tu[0].strength, tu[0].credibility], [4, HEAT, 0.85, 0.714, -1, 0.7, 0.9]);
  assert.deepEqual(tu[0].source, { type: 'experience', ref: 'mem-we-oldhouse-t4-1-oh-thomas' });
  assert.equal(tu[0].terms.length, 5);
  // Nobody moves, so: Mara (landing, heard faintly: no evidence), Daniel and June (own rooms: not perceived), Elise (asleep upstairs).
  assert.deepEqual(ups.map(u => u.characterId), ['oh-thomas']);
  const knock2 = run.state.worldEvents.find(e => e.id === 'we-oldhouse-t4-1');
  assert.deepEqual(knock2.notPerceivedBy.sort(), ['oh-daniel', 'oh-elise', 'oh-june']);
  assert.equal(run.state.entities.character['oh-elise'].asleep, true);
  // No one gained a belief they did not start with.
  for (const id of FIX.cast) assert.deepEqual(run.state.entities.character[id].beliefs.map(b => b.claim), s0.entities.character[id].beliefs.map(b => b.claim));
  // Evidence lives only on a perception: the world-event record and memories carry no evidence field.
  assert.ok(!JSON.stringify(run.ticks.flatMap(t => t.worldEvents)).includes('"evidence"'));
  assert.ok(!JSON.stringify(run.state.entities.character).includes('"evidence"'));
});

test('P3 perception only: evidence follows the channel a character actually perceived through, never a channel they were not in', () => {
  const tpl = FIX.script[4][0];
  const chars = ['oh-mara', 'oh-thomas', 'oh-elise'].map(id => install().entities.character[id]); // landing (faint), kitchen (close), asleep upstairs
  const we = buildWorldEvent(tpl, { id: 'we-x', storyTime: H(16), characters: chars });
  const ev = perceptionEvidence(tpl, we);
  assert.deepEqual(ev.map(e => [e.characterId, e.memoryId, e.evidence.map(x => x.strength)]), [['oh-thomas', 'mem-we-x-oh-thomas', [0.4, 0.3]]]);
  assert.deepEqual(perceptionEvidence(OLD_HOUSE.script[4][0], we), [], 'the built-in Old House declares no evidence');
});

test('P3 hidden truth: replacing every event’s truth with a sentinel changes no belief and no action (test 5; G4)', () => {
  const SENT = '§TRUTH-SENTINEL§';
  const blind = { ...FIX, script: Object.fromEntries(Object.entries(FIX.script).map(([k, list]) => [k, list.map(e => ({ ...e, truth: SENT }))])),
    situation: w => { const s = FIX.situation(w); return { ...s, options: s.options.map(o => (o.effects?.emits ? { ...o, effects: { ...o.effects, emits: { ...o.effects.emits, truth: SENT } } } : o)) }; } };
  for (const seed of [0, 7, 13]) {
    const a = sandbox(FIX, BOTH, seed), b = sandbox(blind, BOTH, seed);
    assert.deepEqual(b.ticks.map(t => t.beliefUpdates), a.ticks.map(t => t.beliefUpdates));
    assert.deepEqual(grid(b), grid(a));
    assert.deepEqual(b.ticks.at(-1).beliefs, a.ticks.at(-1).beliefs);
    assert.ok(b.state.worldEvents.every(e => e.truth === SENT));
    assert.ok(!JSON.stringify(b.state.entities.character).includes(SENT), 'no character holds any truth text');
    assert.ok(!JSON.stringify(b.ticks.flatMap(t => t.beliefUpdates)).includes(SENT), 'no belief update saw it');
    const decisions = b.ticks.flatMap(t => t.events.find(e => e[0] === 'sim.run')[1].decisions);
    assert.ok(!JSON.stringify(decisions.map(d => [d.inputs.character, d.ranking, d.excluded])).includes(SENT), 'no character snapshot, score or reason saw it');
  }
});

test('P3 ordering: scripted evidence reaches that minute’s decisions; evidence from an action reaches the next minute’s (test 7)', () => {
  let checkedScripted = 0, checkedAction = 0;
  for (let seed = 0; seed < 20; seed++) {
    const run = sandbox(FIX, P3, seed);
    run.ticks.forEach((t, i) => {
      const sim = t.events.find(e => e[0] === 'sim.run')[1];
      const simAt = t.events.findIndex(e => e[0] === 'sim.run');
      t.events.forEach(([type, u], at) => {
        if (type !== 'belief.update') return;
        const conf = d => d?.inputs.character.beliefs.find(b => b.claim === u.claim)?.confidence;
        const mine = sim.decisions.find(d => d.characterId === u.characterId);
        if (at < simAt) { checkedScripted++; assert.equal(conf(mine), u.after, 'decided this minute on the updated belief'); }
        else {
          checkedAction++;
          assert.equal(conf(mine), u.before, 'this minute’s decision was made before the action’s evidence');
          const next = run.ticks[i + 1]?.events.find(e => e[0] === 'sim.run')[1].decisions.find(d => d.characterId === u.characterId);
          if (next && !run.ticks[i + 1].events.slice(0, run.ticks[i + 1].events.findIndex(e => e[0] === 'sim.run')).some(e => e[0] === 'belief.update' && e[1].characterId === u.characterId && e[1].claim === u.claim))
            assert.equal(conf(next), u.after, 'the next minute’s decision sees it');
        }
      });
    });
  }
  assert.ok(checkedScripted > 10 && checkedAction > 10, `both paths exercised (${checkedScripted}, ${checkedAction})`);
});

test('P3 replay and independence: with both switches on every decision verifies, runs repeat exactly, and P1’s bounds still hold (tests 8, 10; G3, G7)', () => {
  for (const seed of [0, 5, 11]) {
    const a = sandbox(FIX, BOTH, seed), b = sandbox(FIX, BOTH, seed);
    assert.equal(digest(a.ticks.map(t => t.events)), digest(b.ticks.map(t => t.events)));
    assert.deepEqual(a.state.entities, b.state.entities);
    for (const d of a.ticks.flatMap(t => t.events.find(e => e[0] === 'sim.run')[1].decisions)) { assert.ok(verifyDecision(d).ok); assert.equal(d.engine, `${ENGINE_VERSION}+p1+p3`); }
    const g = grid(a);
    FIX.cast.forEach((_, c) => { for (const [opt, rule] of Object.entries(FIX.repeatOptions)) assert.ok(g.filter(row => row[c] === opt).length <= rule.maxUses); });
    // P3 does not alter what P1 alone does to the first two minutes, and P1 does not alter P3's updates' arithmetic.
    assert.deepEqual(g.slice(0, 2), grid(sandbox(FIX, undefined, seed)).slice(0, 2));
    for (const u of a.ticks.flatMap(t => t.beliefUpdates)) assert.equal(u.after, updateBelief({ id: 'x', name: 'x', beliefs: [{ claim: u.claim, confidence: u.before }] }, u.claim, { direction: u.direction, strength: u.strength, credibility: 0.9 }).after);
  }
});

// ---------------------------------------------------------------- authoring (schema, Studio checker)

const authored = over => {
  const data = scenarioDataFromBuiltIn(FIX);
  let s = install();
  s = apply(s, makeEvent(s.seq + 1, 'entity.create', { kind: 'scenario', id: 'scenario-t', data: { ...data, ...over?.(data) } }, FIXED));
  return { s, ent: s.entities.scenario['scenario-t'] };
};

test('authoring: scenarios without the new fields are stored exactly as before; with them, the fields round-trip', () => {
  const plain = normalize('scenario', scenarioDataFromBuiltIn(OLD_HOUSE));
  assert.ok(!('mechanisms' in plain) && plain.options.every(o => !('repeat' in o)) && !JSON.stringify(plain).includes('vidence'));
  const { ent } = authored();
  assert.deepEqual(ent.options.find(o => o.id === 'opt-listen').repeat, { tag: 'listened', cooldown: 2, maxUses: 3, reopenOn: ['knock'] });
  assert.deepEqual(ent.options.find(o => o.id === 'opt-listen').effects.remember.evidence, [{ claim: BASE, direction: 1, strength: 0.3 }]);
  assert.deepEqual(ent.options.find(o => o.id === 'opt-heating').effects.emits.actorEvidence, [{ claim: HEAT, direction: 1, strength: 0.1 }]);
  assert.equal(ent.events.find(e => e.minute === 4).channels[0].evidence.length, 2);
  assert.ok(!('mechanisms' in ent), 'both switches off is stored as no field at all');
  const many = normalize('scenario', { events: [{ channels: [{ evidence: Array.from({ length: 9 }, (_, i) => ({ claim: 'c' + i, direction: 5, strength: 7 })) }] }] });
  assert.equal(many.events[0].channels[0].evidence.length, 4, 'at most four entries');
  assert.deepEqual(many.events[0].channels[0].evidence[0], { claim: 'c0', direction: 1, strength: 1 });
});

test('authoring: an authored copy of the fixture behaves like the fixture, switch for switch; a live Run of it ignores the switches', () => {
  const { s, ent } = authored(() => ({ mechanisms: BOTH }));
  assert.deepEqual(ent.mechanisms, BOTH);
  const c = compileScenario(ent, s);
  assert.deepEqual(c.errors, []);
  for (const seed of [0, 9]) {
    const mine = previewScenario(s, c.scenario, 8, { seedOffset: seed }), ref = sandbox(FIX, BOTH, seed);
    assert.deepEqual(mine.ticks.map(t => c.scenario.cast.map(id => t.actions.find(a => a.characterId === id)?.optionId || '')), grid(ref));
    assert.deepEqual(mine.ticks.at(-1).beliefs, ref.ticks.at(-1).beliefs);
  }
  let w = s; const evs = [];
  for (let i = 0; i < 8; i++) { const r = stepScenario(w, c.scenario); evs.push(...r.events); w = r.state; }
  assert.ok(!evs.some(([t, p]) => t === 'belief.update' || p.mechanisms || p.situation?.mechanisms || JSON.stringify(p).includes('"repeat"')));
  const offCopy = authored();
  const offRun = previewScenario(offCopy.s, compileScenario(offCopy.ent, offCopy.s).scenario, 8, {});
  assert.deepEqual(evs.filter(e => e[0] === 'world.act').map(e => e[1].optionId), offRun.ticks.flatMap(t => t.actions.map(a => a.optionId)));
});

test('authoring checker: repeat and evidence mistakes are refused or warned about in plain words (P1 test 7; doc 12 §2.6.4)', () => {
  const edit = fn => { const { s, ent } = authored(d => { const o = structuredClone(d); fn(o); return o; }); return compileScenario(ent, s); };
  const opt = (d, id) => d.options.find(o => o.id === id);
  assert.deepEqual(edit(() => {}).errors, []);
  assert.ok(edit(d => { opt(d, 'opt-listen').repeat.tag = 'heard'; }).errors.some(e => /repeat tag "heard" must be one of the tags the option writes/.test(e)));
  assert.ok(edit(d => { opt(d, 'opt-listen').requires.lacks = []; }).errors.some(e => /must also be listed under "not yet done"/.test(e)));
  assert.ok(edit(d => { opt(d, 'opt-listen').repeat.cooldown = 1; }).errors.some(e => /cooldown must be 2 to 240 minutes \(it is 1\)/.test(e)));
  assert.ok(edit(d => { delete opt(d, 'opt-listen').repeat.maxUses; }).errors.some(e => /needs a use cap of 1 to 20 \(it is 0\)\. There is no unlimited setting/.test(e)));
  assert.ok(edit(d => { opt(d, 'opt-listen').repeat.maxUses = 21; }).errors.some(e => /use cap of 1 to 20/.test(e)));
  assert.ok(edit(d => { opt(d, 'opt-watch').repeat.reopenOn = ['thunder']; }).warnings.some(e => /reopens on "thunder", but no world event or action ever writes that tag/.test(e)));
  assert.ok(edit(d => { d.events[1].channels[0].evidence = [{ claim: 'The moon is cheese', direction: 1, strength: 0.5 }]; }).warnings.some(e => /will do nothing, because no cast member holds that belief/.test(e)));
  assert.ok(edit(d => { d.mechanisms = P1; d.options.forEach(o => delete o.repeat); }).warnings.some(e => /no option declares a repeat rule/.test(e)));
});

// ---------------------------------------------------------------- comparisons (doc 12 S4, doc 13)

const cmp = (scenarioId, key, over = {}) => normalizeExperiment({ title: 't', hypothesis: 'h', prediction: 'p', scenarioId, ticks: 8, seeds: [0, 1, 2],
  variants: [{ id: 'A', label: 'off', patches: [] }, { id: 'B', label: 'on', patches: [{ kind: 'mechanism.set', key, value: true }] }], ...over });

test('comparisons: mechanism.set is one factor, the control stays off, and nonsense is refused', () => {
  const d = cmp('fixture:oldhouse-p1p3', 'repeatableActions');
  assert.deepEqual(structuralProblems(d), []);
  assert.deepEqual(d.variants[1].patches, [{ kind: 'mechanism.set', key: 'repeatableActions', value: true }]);
  assert.ok(structuralProblems(cmp('oldhouse', 'timeTravel')).some(p => /not an experimental mechanism/.test(p)));
  const flipped = normalizeExperiment({ ...d, variants: [{ id: 'A', patches: [{ kind: 'mechanism.set', key: 'repeatableActions', value: true }] }, { id: 'B', patches: [] }] });
  assert.ok(structuralProblems(flipped).some(p => /first variant is the control/.test(p)));
  const two = normalizeExperiment({ ...d, variants: [{ id: 'A', patches: [] }, { id: 'B', patches: [{ kind: 'mechanism.set', key: 'repeatableActions', value: true }] }, { id: 'C', patches: [{ kind: 'mechanism.set', key: 'experienceBeliefs', value: true }] }] });
  assert.ok(structuralProblems(two).some(p => /more than one thing/.test(p)));
  const held = cmp('fixture:oldhouse-p1p3+p1', 'repeatableActions');
  assert.ok(definitionProblems(held, resolveBase([], held.scenarioId)).some(p => /already on/.test(p)));
  assert.throws(() => runExperiment(held, []), /already on/);
});

test('comparisons: fixtures are offered with their label, run from the Old House starting point, and leave the project untouched', () => {
  const choices = scenarioChoices(install());
  assert.equal(choices.filter(([id]) => id.startsWith('fixture:')).length, 3);
  assert.ok(choices.filter(([id]) => id.startsWith('fixture:')).every(([, name]) => name.startsWith(FIXTURE_LABEL)));
  // A project where the Old House has already been run live: the comparison still starts from before that run.
  const events = OLD_HOUSE.installEvents().map(([t, p], i) => makeEvent(i + 1, t, p, FIXED));
  let s = replay(events);
  for (let i = 0; i < 8; i++) for (const [t, p] of stepScenario(s, OLD_HOUSE).events) { const ev = makeEvent(s.seq + 1, t, p, FIXED); events.push(ev); s = apply(s, ev); }
  const before = digest(replay(events));
  const res = runExperiment(cmp('fixture:oldhouse-p1p3', 'repeatableActions'), events);
  assert.equal(res.baseSeq, OLD_HOUSE.installEvents().length);
  assert.equal(digest(replay(events)), before);
  assert.equal(res.measures.fixture, FIXTURE_LABEL);
  assert.equal(res.factor, 'mechanism.set|repeatableActions');
  assert.deepEqual(res.measures.variants.A.mechanisms, { repeatableActions: false, experienceBeliefs: false });
  assert.deepEqual(res.measures.variants.B.mechanisms, P1);
  assert.ok(res.comparisons[0].seedsWithAnyDifference > 0);
  // The result is recordable through the ordinary log, and nothing else is written.
  let st = replay(events);
  st = apply(st, makeEvent(st.seq + 1, 'experiment.register', { id: 'exp-1', def: cmp('fixture:oldhouse-p1p3', 'repeatableActions'), baseSeq: res.baseSeq, baseDigest: res.baseDigest }, FIXED));
  st = apply(st, makeEvent(st.seq + 1, 'experiment.result', { experimentId: 'exp-1', results: res }, FIXED));
  assert.equal(st.rejected.length, 0);
  assert.equal(digest(st.entities), digest(replay(events).entities));
});

test('comparisons: results recorded by earlier builds still reproduce (the digested core is unchanged)', () => {
  const d = normalizeExperiment({ title: 'Thomas and the heating', hypothesis: 'h', prediction: 'p', scenarioId: 'oldhouse', ticks: 8, seeds: [0, 1, 2, 3, 4],
    variants: [{ id: 'A', label: 'as written', patches: [] }, { id: 'B', label: 'doubts', patches: [{ kind: 'belief.set', characterId: 'oh-thomas', claim: HEAT, confidence: 0.2 }] }] });
  assert.equal(runExperiment(d, []).resultDigest, 'e7fc3440c47ff9cc'); // computed with the build at commit 3b8fcb5
});

// ---------------------------------------------------------------- the predefined acceptance run (doc 13)

test('acceptance run (doc 13, thresholds unchanged): P1 passes every criterion; P3 passes all but B5, which is recorded as failed', () => {
  const rep = runAcceptance();
  // B5 ("behaviour follows belief") fails: with these trial declarations no action changes in any run.
  // This is the outcome doc 13 anticipated as possible. It is pinned here as a finding, not hidden and not tuned away.
  assert.deepEqual(rep.failed, ['C-P3: B5', 'C-P1xP3 (P1 held on; P3 off → on): B5']);
  const ids = n => rep.comparisons[n].checks.map(c => c.id);
  assert.deepEqual(ids('C-P1'), ['G1', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'G3', 'G4', 'G5', 'G6', 'G8']);
  assert.deepEqual(ids('C-P3'), ['G1', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'G3', 'G4', 'G5', 'G6', 'G8']);
  assert.deepEqual(ids('C-null P1'), ['G2', 'G1', 'G3', 'G4', 'G5', 'G6', 'G8']);
  assert.equal(rep.comparisons['C-P3'].differing.seeds, 0);
  assert.deepEqual(rep.thresholds, { A1: 0.40, A2: 1.5, A3overall: 0.10, A3character: 0.20, B5seeds: 10, G8seconds: 5 });
});
