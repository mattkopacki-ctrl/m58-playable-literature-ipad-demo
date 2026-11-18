import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, makeEvent, apply, emptyState, buildExport, parseExport, liveList } from '../js/core/store.mjs';
import { decide, verifyDecision, baseLevel, memoryActivation, parseOptions, explain } from '../js/core/cognition.mjs';
import { analyzeText, syllables } from '../js/core/analyzer.mjs';
import { computeIntel } from '../js/core/intel.mjs';
import { seedEvents, SITUATIONS } from '../js/core/seed.mjs';
import { hashUnit, digest } from '../js/core/rng.mjs';
import { normalize } from '../js/core/schema.mjs';

const seeded = () => seedEvents().map(([type, payload], i) => makeEvent(i + 1, type, payload, '2026-11-18T00:00:00.000Z'));

test('seed replays without rejections', () => {
  const s = replay(seeded());
  assert.equal(s.rejected.length, 0);
  assert.equal(liveList(s, 'character').length, 3);
  assert.equal(s.seq, seeded().length);
});

test('replay is deterministic', () => {
  assert.deepEqual(replay(seeded()), replay(seeded()));
});

test('update merges, increments rev, never drops identity', () => {
  let s = replay(seeded());
  s = apply(s, makeEvent(s.seq + 1, 'entity.update', { kind: 'character', id: 'character-theo', patch: { role: 'Engineer' } }));
  const t = s.entities.character['character-theo'];
  assert.equal(t.role, 'Engineer');
  assert.equal(t.rev, 2);
  assert.equal(t.name, 'Theo Marsh');
});

test('duplicate create and missing update are rejected, not thrown', () => {
  let s = replay(seeded());
  s = apply(s, makeEvent(s.seq + 1, 'entity.create', { kind: 'world', id: 'world-harrow', data: {} }));
  s = apply(s, makeEvent(s.seq + 1, 'entity.update', { kind: 'world', id: 'nope', patch: {} }));
  assert.equal(s.rejected.length, 2);
});

test('archive is a tombstone, restore brings it back', () => {
  let s = replay(seeded());
  s = apply(s, makeEvent(s.seq + 1, 'entity.archive', { kind: 'theme', id: 'theme-house' }));
  assert.equal(liveList(s, 'theme').length, 1);
  assert.ok(s.entities.theme['theme-house']);
  s = apply(s, makeEvent(s.seq + 1, 'entity.restore', { kind: 'theme', id: 'theme-house' }));
  assert.equal(liveList(s, 'theme').length, 2);
});

test('export round-trips and rejects gaps', () => {
  const evs = seeded();
  assert.deepEqual(parseExport(JSON.parse(JSON.stringify(buildExport(evs)))), evs);
  const gap = buildExport([evs[0], evs[2]]);
  assert.throws(() => parseExport(gap), /gap/);
  assert.throws(() => parseExport({ format: 'x', events: [] }), /Not an ANAMNESIS/);
});

test('decisions are deterministic, explained and verifiable', () => {
  const s = replay(seeded());
  const ines = s.entities.character['character-ines'];
  const a = decide(ines, SITUATIONS[0], { now: 48, seed: 1 });
  const b = decide(ines, SITUATIONS[0], { now: 48, seed: 1 });
  assert.deepEqual(a, b);
  assert.equal(verifyDecision(JSON.parse(JSON.stringify(a))).ok, true);
  for (const r of a.ranking) {
    const sum = r.terms.reduce((x, t) => x + t.value, 0);
    assert.ok(Math.abs(sum - r.total) < 0.01, 'total equals sum of terms');
  }
  assert.match(explain(a), /Ines Varga/);
});

test('character differences drive divergent choices (Ines avoids the cellar, Theo goes down)', () => {
  const s = replay(seeded());
  const ines = decide(s.entities.character['character-ines'], SITUATIONS[0], { now: 48, seed: 0 });
  const theo = decide(s.entities.character['character-theo'], SITUATIONS[0], { now: 48, seed: 0 });
  assert.notEqual(ines.chosenOptionId, 'opt-1');
  assert.equal(theo.chosenOptionId, 'opt-1');
  const fear = ines.ranking.find(r => r.optionId === 'opt-1').terms.find(t => t.source === 'fear');
  assert.ok(fear && fear.value < 0, 'Ines has a logged fear term on the cellar option');
});

test('tampered decision fails verification', () => {
  const s = replay(seeded());
  const rec = decide(s.entities.character['character-theo'], SITUATIONS[1], { now: 10, seed: 3 });
  const bad = structuredClone(rec);
  bad.inputs.character.values.truth = 0;
  assert.equal(verifyDecision(bad).ok, false);
});

test('ACT-R base level: recent and repeated rehearsal raise activation', () => {
  assert.ok(baseLevel([0], 1) > baseLevel([0], 100));
  assert.ok(baseLevel([0, 50, 90], 100) > baseLevel([0], 100));
  assert.equal(baseLevel([], 10), -Infinity);
  const m = { at: 0, rehearsals: [], tags: ['cellar'], arousal: 0.5, valence: -1 };
  assert.ok(memoryActivation(m, 10, ['cellar']).total > memoryActivation(m, 10, []).total);
  assert.equal(memoryActivation(m, -1, []).base, -Infinity, 'future memories are not retrievable');
});

test('analyzer metrics', () => {
  const r = analyzeText('The door opened. “Who is there?” she whispered.\n\nNothing. The dark cellar was silent.', { names: ['Ines Varga'] });
  assert.equal(r.paragraphs, 2);
  assert.equal(r.sentences, 4);
  assert.ok(r.dialogueRatio > 0);
  assert.ok(r.paragraphStats[1].tension > 0);
  assert.equal(r.mentions['Ines Varga'], 0);
  assert.equal(syllables('the'), 1);
  assert.equal(analyzeText('').words, 0);
});

test('intel finds untriaged research and unverified decisions', () => {
  let s = replay(seeded());
  const d = decide(s.entities.character['character-daniel'], SITUATIONS[2], { now: 60, seed: 0 });
  s = apply(s, makeEvent(s.seq + 1, 'decision.record', { id: 'dec-1', ...d }));
  const intel = computeIntel(s);
  assert.ok(intel.findings.some(f => /awaiting triage/.test(f.text)));
  assert.ok(intel.findings.some(f => /not yet replay-verified/.test(f.text)));
  assert.equal(intel.counts.decisions, 1);
  assert.equal(intel.evidence.ESTABLISHED, 1);
});

test('memory.recall appends a rehearsal (recall is a logged event)', () => {
  let s = replay(seeded());
  s = apply(s, makeEvent(s.seq + 1, 'memory.recall', { characterId: 'character-ines', memoryId: 'mem-ines-1', storyTime: 30, cues: ['cellar'] }));
  assert.deepEqual(s.entities.character['character-ines'].memories[0].rehearsals.at(-1), 30);
  assert.equal(s.recalls.length, 1);
});

test('helpers', () => {
  assert.equal(hashUnit('a', 1), hashUnit('a', 1));
  assert.notEqual(digest({ a: 1, b: 2 }), digest({ a: 2, b: 1 }));
  assert.equal(digest({ a: 1, b: 2 }), digest({ b: 2, a: 1 }));
  assert.deepEqual(parseOptions('Run [risk, flee]\nStay'), [{ id: 'opt-1', label: 'Run', tags: ['risk', 'flee'], beliefs: [] }, { id: 'opt-2', label: 'Stay', tags: [], beliefs: [] }]);
  assert.equal(normalize('character', { traits: { openness: 9 } }).traits.openness, 1);
  assert.equal(normalize('inbox', { evidence: 'BOGUS' }).evidence, 'UNREVIEWED');
});

import { runCommand, tokenize, findEntity } from '../js/core/terminal.mjs';

test('terminal commands', () => {
  const s = replay(seeded());
  assert.deepEqual(tokenize('new character "Mara Quill"'), ['new', 'character', 'Mara Quill']);
  assert.equal(findEntity(s, 'character', 'ines').id, 'character-ines');
  const ls = runCommand('ls chars', { state: s });
  assert.match(ls.out[0], /3 character/);
  const nw = runCommand('new world Saltmarsh', { state: s });
  assert.equal(nw.actions[0].payload.data.name, 'Saltmarsh');
  const d = runCommand('decide theo 1 48 0 --record', { state: s });
  assert.equal(d.actions[0].event, 'decision.record');
  assert.match(d.out.join('\n'), /Go down with a lamp/);
  const t = runCommand('triage context FILED', { state: s });
  assert.equal(t.actions[0].payload.patch.status, 'FILED');
  assert.match(runCommand('bogus', { state: s }).out[0], /unknown command/);
  assert.equal(runCommand('go sim', { state: s }).actions[0].route, 'simulator');
});

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

test('service worker shell lists every shipped file', () => {
  const root = new URL('..', import.meta.url).pathname;
  const walk = d => readdirSync(join(root, d)).flatMap(f => { const p = join(d, f); return statSync(join(root, p)).isDirectory() ? walk(p) : [p]; });
  const shipped = ['index.html', 'manifest.webmanifest', ...['css', 'js', 'icons'].flatMap(walk)].map(p => './' + p).sort();
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/'(\.\/[^']+)'/g)].map(m => m[1]).filter(p => p !== './').sort();
  assert.deepEqual(listed, shipped);
});

import { updateBelief, buildConversation, attributeSource, memoryCredibility } from '../js/core/cognition.mjs';

test('belief update: direction, perseverance asymmetry, new claims, bounds', () => {
  const s = replay(seeded());
  const theo = s.entities.character['character-theo']; // "mechanical explanation" held at 0.9
  const claim = 'Everything here has a mechanical explanation';
  const ev = { strength: 0.6, credibility: 0.8 };
  const up = updateBelief(theo, claim, { ...ev, direction: 1 });
  const down = updateBelief(theo, claim, { ...ev, direction: -1 });
  assert.ok(up.after > up.before && down.after < down.before);
  const shift = t => Math.abs(t.terms.find(x => x.label === 'log-odds shift').value);
  assert.ok(shift(down) < shift(up), 'contrary evidence is discounted by entrenchment');
  assert.equal(down.terms.find(x => x.label === 'perseverance').value, 0.6);
  const fresh = updateBelief(theo, 'Daniel was on the landing', { direction: 1, strength: 0.5, credibility: 0.5 });
  assert.equal(fresh.before, 0.5); assert.equal(fresh.isNew, true);
  assert.equal(updateBelief(theo, claim, { direction: 1, strength: 1, credibility: 0 }).after, 0.9, 'zero credibility changes nothing');
  let c = theo; for (let i = 0; i < 20; i++) { const u = updateBelief(c, claim, { direction: 1, strength: 1, credibility: 1 }); c = { ...c, beliefs: [{ claim, confidence: u.after }] }; }
  assert.ok(c.beliefs[0].confidence <= 0.98);
  assert.deepEqual(updateBelief(theo, claim, { ...ev, direction: -1 }), down, 'deterministic');
  assert.throws(() => updateBelief(theo, '  ', ev), /claim/);
});

test('belief.update event changes the holder only and is logged', () => {
  let s = replay(seeded());
  const bu = updateBelief(s.entities.character['character-theo'], 'The house is wrong', { direction: 1, strength: 0.7, credibility: 0.9 });
  s = apply(s, makeEvent(s.seq + 1, 'belief.update', bu));
  assert.equal(s.entities.character['character-theo'].beliefs.find(b => b.claim === 'The house is wrong').confidence, bu.after);
  assert.equal(s.entities.character['character-ines'].beliefs[0].confidence, 0.8, 'other holders of the same claim are untouched');
  assert.equal(s.beliefUpdates.length, 1);
  assert.equal(s.rejected.length, 0);
});

test('conversation: listener gets only what was told; speaker rehearses; privacy holds', () => {
  let s = replay(seeded());
  const ines = s.entities.character['character-ines'], theo = s.entities.character['character-theo'];
  assert.throws(() => buildConversation(ines, theo, 'mem-ines-1', { now: 60, cues: ['cellar'] }), /cannot recall/, 'one cue is not enough to reach the old memory');
  const conv = buildConversation(ines, theo, 'mem-ines-1', { now: 60, cues: ['cellar', 'dark', 'locked'], asTold: 'Something came up from the cellar for me',
    claim: 'The house is wrong', direction: 1, strength: 0.8 });
  assert.equal(conv.slanted, true);
  s = apply(s, makeEvent(s.seq + 1, 'conversation.record', conv));
  assert.equal(s.rejected.length, 0);
  const theo2 = s.entities.character['character-theo'], ines2 = s.entities.character['character-ines'];
  const told = theo2.memories.filter(m => m.source === 'told');
  assert.equal(told.length, 1);
  assert.equal(told[0].text, 'Something came up from the cellar for me');
  assert.equal(told[0].from, 'character-ines');
  assert.ok(!theo2.memories.some(m => m.text.includes('records basement')), 'the untold original never reaches the listener');
  assert.equal(ines2.memories.find(m => m.id === 'mem-ines-1').rehearsals.at(-1), 60);
  assert.ok(ines2.memories.some(m => m.source === 'retold'), 'slanted retelling leaves a recollection trace on the speaker');
  assert.ok(theo2.beliefs.find(b => b.claim === 'The house is wrong').confidence > 0.5);
  assert.equal(s.conversations.length, 1); assert.equal(s.beliefUpdates.length, 1);
  const again = apply(s, makeEvent(s.seq + 1, 'conversation.record', conv));
  assert.match(again.rejected.at(-1).why, /already told/);
  assert.deepEqual(replay([...seeded(), makeEvent(13, 'conversation.record', conv, '2026-11-18T00:00:00.000Z')]).entities.character['character-theo'].memories, theo2.memories);
});

test('conversation feasibility: cannot tell the unrecallable, the future, or oneself', () => {
  const s = replay(seeded());
  const ines = s.entities.character['character-ines'], theo = s.entities.character['character-theo'];
  const faint = { ...theo, memories: [{ ...theo.memories[0], id: 'old', at: -90000, rehearsals: [], arousal: 0, tags: [] }] };
  assert.throws(() => buildConversation(faint, ines, 'old', { now: 60 }), /cannot recall/);
  assert.throws(() => buildConversation(ines, ines, 'mem-ines-1', { now: 60 }), /themselves/);
  assert.throws(() => buildConversation(ines, theo, 'mem-ines-1', { now: -30000 }), /not happened/);
  assert.throws(() => buildConversation(ines, theo, 'nope', { now: 60 }), /does not hold/);
});

test('hearsay weighs less in decisions and can come to feel seen', () => {
  const s = replay(seeded());
  const theo = s.entities.character['character-theo'];
  const mem = src => ({ id: 'm-x', text: 'The cellar took someone', at: 40, tags: ['cellar'], valence: -1, arousal: 0.8, rehearsals: [], source: src, from: 'character-ines', originId: '' });
  const term = src => decide({ ...theo, memories: [mem(src)] }, SITUATIONS[0], { now: 48, seed: 0 }).ranking.find(r => r.optionId === 'opt-1').terms.find(t => t.source === 'memory');
  assert.ok(Math.abs(term('told').value) < Math.abs(term('seen').value));
  assert.match(term('told').why, /source told ×0.6/);
  const m = mem('told');
  assert.ok(attributeSource(m, 40 + 24 * 6, 'c').p > attributeSource(m, 41, 'c').p, 'misattribution probability grows with age');
  assert.equal(attributeSource(mem('seen'), 500, 'c').misattributed, false);
  const flips = Array.from({ length: 200 }, (_, i) => attributeSource({ ...m, id: 'm' + i }, 40 + 24 * 7, 'c')).filter(a => a.misattributed).length;
  assert.ok(flips > 20 && flips < 180, `some but not all hearsay flips (${flips}/200)`);
  const flipped = Array.from({ length: 200 }, (_, i) => ({ ...m, id: 'm' + i })).find(x => attributeSource(x, 208, 'c').misattributed);
  assert.equal(memoryCredibility(flipped, 208, 'c'), 0.9, 'misattributed hearsay is trusted like an eyewitness memory');
  assert.equal(attributeSource(flipped, 5000, 'c').misattributed, true, 'once flipped, stays flipped');
});

test('terminal: tell and believe produce the same events as the GUI', () => {
  const s = replay(seeded());
  const t = runCommand('tell ines theo 2 48', { state: s });
  assert.equal(t.actions[0].event, 'conversation.record');
  assert.equal(t.actions[0].payload.listenerMemory.source, 'told');
  assert.match(runCommand('tell ines theo 9', { state: s }).out[0], /usage/);
  const b = runCommand('believe theo -0.6 "Everything here has a mechanical explanation"', { state: s });
  assert.equal(b.actions[0].event, 'belief.update');
  assert.ok(b.actions[0].payload.after < 0.9);
  assert.match(runCommand('beliefs ines', { state: s }).out[0], /The house is wrong/);
  assert.match(runCommand('memories ines', { state: s }).out[1], /cellar door/);
});

import { feasibility } from '../js/core/cognition.mjs';

test('T-025 beliefs enter decisions as explained, replayable terms', () => {
  const s = replay(seeded());
  const theo = s.entities.character['character-theo'];
  const d = decide(theo, SITUATIONS[0], { now: 48, seed: 0 });
  const bt = d.ranking.find(r => r.optionId === 'opt-1').terms.find(t => t.source === 'belief');
  assert.ok(bt && bt.value > 0, 'Theo\'s mechanical-explanation belief favours going down');
  assert.equal(bt.value, 0.64); // (0.9 - 0.5) * 2 * 0.8
  assert.match(bt.why, /holds ".*" at 0.9; this option presumes it true/);
  assert.equal(verifyDecision(JSON.parse(JSON.stringify(d))).ok, true);
  // An unheld claim adds no term.
  assert.ok(!d.ranking.find(r => r.optionId === 'opt-3').terms.some(t => t.source === 'belief'));
  // Changing the belief changes the choice score, and only through the belief term.
  const doubt = { ...theo, beliefs: [{ claim: 'Everything here has a mechanical explanation', confidence: 0.1 }] };
  const d2 = decide(doubt, SITUATIONS[0], { now: 48, seed: 0 });
  const t1 = d.ranking.find(r => r.optionId === 'opt-1'), t2 = d2.ranking.find(r => r.optionId === 'opt-1');
  assert.equal(Math.round((t1.total - t2.total) * 1000) / 1000, 1.28);
  assert.deepEqual(t1.terms.filter(t => t.source !== 'belief'), t2.terms.filter(t => t.source !== 'belief'));
  // A stored decision fails verification if its belief input is tampered with.
  const bad = structuredClone(d); bad.inputs.character.beliefs[0].confidence = 0.2;
  assert.equal(verifyDecision(bad).ok, false);
});

test('T-025 belief change from evidence flips a choice end to end', () => {
  let s = replay(seeded());
  const sit = { id: 'sit-b', prompt: 'Stay or leave?', tags: [], options: parseOptions('Stay the night {-The house is wrong}\nLeave now {+The house is wrong}') };
  assert.deepEqual(sit.options[0].beliefs, [{ sign: -1, claim: 'The house is wrong' }]);
  const pick = () => decide(s.entities.character['character-theo'], sit, { now: 48, seed: 0 }).chosenLabel;
  for (let i = 0; i < 3; i++) s = apply(s, makeEvent(s.seq + 1, 'belief.update', updateBelief(s.entities.character['character-theo'], 'The house is wrong', { direction: -1, strength: 1, credibility: 1 })));
  assert.equal(pick(), 'Stay the night');
  for (let i = 0; i < 8; i++) s = apply(s, makeEvent(s.seq + 1, 'belief.update', updateBelief(s.entities.character['character-theo'], 'The house is wrong', { direction: 1, strength: 1, credibility: 1 })));
  assert.equal(pick(), 'Leave now');
});

test('old decision records (no beliefs, no preconditions) still verify', () => {
  const s = replay(seeded());
  const { beliefs, place, asleep, ...oldChar } = s.entities.character['character-ines'];
  const oldSit = { ...SITUATIONS[2] };
  const rec = decide(oldChar, oldSit, { now: 10, seed: 1 });
  const legacy = JSON.parse(JSON.stringify(rec)); delete legacy.excluded; delete legacy.inputs.character.beliefs;
  assert.equal(verifyDecision(legacy).ok, true);
});

test('action preconditions exclude infeasible options with a logged reason', () => {
  const s = replay(seeded());
  const theo = { ...s.entities.character['character-theo'], place: 'Kitchen', asleep: false };
  const opts = [
    { id: 'a', label: 'Unlock', tags: ['truth'], requires: { awake: true, places: ['Cellar'], knows: ['key'] } },
    { id: 'b', label: 'Wait', tags: ['safety'], requires: { awake: true } },
    { id: 'c', label: 'Sleep on', tags: [], requires: { awake: false } },
  ];
  const d = decide(theo, { id: 's', prompt: 'p', tags: [], options: opts }, { now: 1 });
  assert.equal(d.chosenOptionId, 'b');
  assert.deepEqual(d.excluded.map(e => e.optionId), ['a', 'c']);
  assert.match(d.excluded[0].why, /not at Cellar/);
  assert.equal(verifyDecision(JSON.parse(JSON.stringify(d))).ok, true);
  assert.match(feasibility({ ...theo, place: 'Cellar' }, opts[0], 1).why, /does not know: key/);
  assert.equal(feasibility({ ...theo, place: 'Cellar', memories: [{ at: 0, tags: ['key'] }] }, opts[0], 1).ok, true);
  const asleep = decide({ ...theo, asleep: true }, { id: 's', prompt: 'p', tags: [], options: opts }, { now: 1 });
  assert.equal(asleep.chosenOptionId, 'c');
  assert.throws(() => decide({ ...theo, asleep: true }, { id: 's', prompt: 'p', tags: [], options: [opts[1]] }, { now: 1 }), /no feasible action/);
});

import { OLD_HOUSE } from '../js/core/oldhouse.mjs';
import { stepScenario, knowledgeMatrix, inspectCharacter, scenarioStatus } from '../js/core/scenario.mjs';

const FIXED = '1970-01-01T00:00:00.000Z';
const ohInstall = () => OLD_HOUSE.installEvents().map(([t, p], i) => makeEvent(i + 1, t, p, FIXED));
function ohRun(ticks) {
  let s = replay(ohInstall()); const log = [...ohInstall()];
  for (let i = 0; i < ticks; i++) { const r = stepScenario(s, OLD_HOUSE); for (const [t, p] of r.events) log.push(makeEvent(log.length + 1, t, p, FIXED)); s = r.state; }
  return { s, log };
}
const oh = n => `oh-${n}`;

test('T-023 Old House installs: five characters, one asleep, no rejections', () => {
  const s = replay(ohInstall());
  assert.equal(s.rejected.length, 0);
  assert.equal(OLD_HOUSE.cast.filter(id => s.entities.character[id]).length, 5);
  assert.equal(s.entities.character[oh('elise')].asleep, true);
  assert.equal(scenarioStatus(s, OLD_HOUSE).clock, '02:13');
});

test('T-023 perception: each character gets only their own channel; the sleeper gets nothing', () => {
  const { s } = ohRun(1);
  const mem = n => s.entities.character[oh(n)].memories.map(m => m.text);
  assert.ok(mem('thomas').includes('Three slow knocks from inside the locked basement door'), 'Thomas in the kitchen hears it close');
  assert.ok(mem('mara').includes('A dull knocking somewhere downstairs'), 'Mara on the landing hears it faintly');
  assert.ok(!mem('mara').some(t => t.includes('Three slow knocks')), 'Mara does not get the close version');
  const ev = s.worldEvents[0];
  assert.deepEqual(ev.notPerceivedBy, [oh('elise')]);
  assert.ok(!s.entities.character[oh('elise')].memories.some(m => m.originId === ev.id), 'Elise slept through it');
  for (const id of OLD_HOUSE.cast) for (const m of s.entities.character[id].memories)
    assert.ok(!/Source unknown|inner face/.test(m.text), 'world truth never appears in a character memory');
});

test('T-023 private knowledge: only Daniel knows where the key is, all night', () => {
  const { s } = ohRun(8);
  const knowsKey = OLD_HOUSE.cast.filter(id => s.entities.character[id].memories.some(m => m.tags.includes('key')));
  assert.deepEqual(knowsKey, [oh('daniel')]);
  assert.ok(!inspectCharacter(s, oh('mara')).memories.some(m => /key/.test(m.text)));
  assert.equal(s.scenario.facts.basementDoor, 'LOCKED');
  assert.equal(s.scenario.facts.knockSource, 'UNKNOWN');
});

test('T-023 action preconditions: unlocking needs the door and the key; sleepers can only sleep', () => {
  const { s } = ohRun(2);
  const run1 = s.simruns[0], run2 = s.simruns[1];
  const elise = run1.decisions.find(d => d.characterId === oh('elise'));
  assert.equal(elise.chosenOptionId, 'opt-sleep');
  assert.equal(elise.ranking.length, 1);
  assert.ok(elise.excluded.every(e => e.why === 'asleep'));
  const mara2 = run2.decisions.find(d => d.characterId === oh('mara')); // at the basement stairs by tick 2
  assert.equal(mara2.inputs.character.place, 'Basement stairs');
  assert.equal(mara2.excluded.find(e => e.optionId === 'opt-unlock').why, 'does not know: key');
  const daniel2 = run2.decisions.find(d => d.characterId === oh('daniel'));
  assert.match(daniel2.excluded.find(e => e.optionId === 'opt-unlock').why, /not at Basement stairs/);
  const danielAtDoor = { ...s.entities.character[oh('daniel')], place: 'Basement stairs' };
  const d = decide(danielAtDoor, OLD_HOUSE.situation({ someoneAsleep: false }), { now: 2.3, seed: 1 });
  assert.ok(d.ranking.some(r => r.optionId === 'opt-unlock'), 'feasible for Daniel at the door');
  assert.notEqual(d.chosenOptionId, 'opt-unlock', 'but his own values keep him from choosing it');
  assert.ok(run1.decisions.find(x => x.characterId === oh('thomas')).excluded.every(e => e.optionId !== 'opt-heating'));
  assert.match(run1.decisions.find(x => x.characterId === oh('mara')).excluded.find(e => e.optionId === 'opt-heating').why, /not at Kitchen/);
});

test('T-023 hearsay: Elise learns of the knock only by being told, in the teller\'s version', () => {
  const { s } = ohRun(8);
  const row = knowledgeMatrix(s, OLD_HOUSE)[0];
  const cell = row.cells[OLD_HOUSE.cast.indexOf(oh('elise'))];
  assert.equal(cell.how, 'told by Daniel Hale');
  assert.match(cell.text, /A dull knocking somewhere downstairs/, 'she got Daniel\'s faint version, not the close one');
  const told = s.entities.character[oh('elise')].memories.find(m => m.source === 'told');
  assert.equal(told.from, oh('daniel'));
  assert.equal(s.entities.character[oh('elise')].asleep, false);
  const heat = knowledgeMatrix(s, OLD_HOUSE).find(r => r.event.title === 'Heating test');
  assert.equal(heat.event.provenance, 'simulation');
  assert.equal(heat.cells[OLD_HOUSE.cast.indexOf(oh('thomas'))].how, 'did it');
  assert.equal(heat.cells[OLD_HOUSE.cast.indexOf(oh('daniel'))].how, 'unaware', 'Daniel, upstairs, never learns of the heating test');
});

test('T-023 deterministic replay: two runs match, the log replays to the same state, every decision verifies', () => {
  const a = ohRun(8), b = ohRun(8);
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(replay(a.log), a.s);
  assert.equal(a.s.rejected.length, 0);
  assert.equal(a.s.scenario.clock, '02:20');
  assert.equal(a.s.worldEvents.filter(e => e.provenance === 'author').length, 2, 'two authored events, as in the owner\'s experiment');
  let n = 0;
  for (const run of a.s.simruns) for (const d of run.decisions) { assert.equal(verifyDecision(JSON.parse(JSON.stringify(d))).ok, true); n++; }
  assert.equal(n, 40);
  assert.throws(() => stepScenario(a.s, OLD_HOUSE), /last tick/);
  const skip = apply(replay(ohInstall()), makeEvent(99, 'scenario.advance', { scenarioId: 'oldhouse', tick: 3, storyTime: 2.25, clock: '02:15' }));
  assert.match(skip.rejected.at(-1).why, /must start at tick 1/);
});

test('T-023 terminal drives the same scenario as the GUI', () => {
  let s = replay(seeded());
  const inst = runCommand('oldhouse', { state: s });
  assert.equal(inst.actions.length, 6);
  for (const a of inst.actions) s = apply(s, makeEvent(s.seq + 1, a.event, a.payload, FIXED));
  const t = runCommand('tick 8', { state: s });
  const viaTerminal = t.actions.map(a => [a.event, a.payload]);
  let g = s; const viaGui = [];
  for (let i = 0; i < 8; i++) { const r = stepScenario(g, OLD_HOUSE); viaGui.push(...r.events); g = r.state; }
  assert.deepEqual(viaTerminal, viaGui);
  assert.match(runCommand('status', { state: g }).out[0], /Old House · 02:20 · tick 8\/8/);
  const insp = runCommand('inspect elise', { state: g }).out.join('\n');
  assert.match(insp, /told by Daniel Hale/); assert.ok(!/Source unknown/.test(insp));
  assert.match(runCommand('tick', { state: g }).out[0], /last tick/);
  const k = runCommand('event knock', { state: g });
  assert.equal(k.actions[0].event, 'world.event');
});

import { stageCheck, unmetFor, RESEARCH_STAGES } from '../js/core/research.mjs';

test('T-021 research progression: gated, one step at a time, enforced by the log', () => {
  let s = replay(seeded());
  const upd = patch => { s = apply(s, makeEvent(s.seq + 1, 'entity.update', { kind: 'inbox', id: 'inbox-new', patch })); return s.rejected.at(-1)?.seq === s.seq ? s.rejected.at(-1).why : 'ok'; };
  const item = () => s.entities.inbox['inbox-new'];
  assert.equal(item().stage, 'OBSERVED');
  assert.match(upd({ stage: 'HYPOTHESIZED' }), /needs a written hypothesis/);
  assert.match(upd({ stage: 'TESTED' }), /cannot be skipped/);
  assert.equal(upd({ hypothesis: 'Returning to the cellar will not by itself bring the memory back.', stage: 'HYPOTHESIZED' }), 'ok');
  assert.match(upd({ stage: 'TESTED' }), /how it was tested.*test result/);
  assert.equal(upd({ test: 'Ran the cue-only recall check on Ines at hour 60.', testResult: 'INCONCLUSIVE', stage: 'TESTED' }), 'ok');
  assert.match(upd({ stage: 'ELIGIBLE' }), /SUPPORTED.*reviewed evidence/);
  assert.equal(upd({ testResult: 'SUPPORTED', evidence: 'SUPPORTED', stage: 'ELIGIBLE' }), 'ok');
  assert.equal(item().stage, 'ELIGIBLE');
  assert.match(upd({ hypothesis: '' }), /needs a written hypothesis/, 'cannot hollow out an item that sits at a later stage');
  assert.equal(upd({ stage: 'OBSERVED' }), 'ok', 'moving back is always allowed');
  assert.deepEqual(unmetFor({ claim: 'x' }, 'OBSERVED'), []);
  assert.equal(stageCheck(item(), 'OBSERVED', 'BOGUS').ok, false);
  assert.ok(computeIntel(replay(seeded())).stages.HYPOTHESIZED === 1);
});

test('T-021 eligibility changes nothing else; originals are preserved', () => {
  let s = replay(seeded());
  const before = JSON.stringify([s.entities.character, s.entities.world, s.entities.plot, s.entities.theme]);
  const go = patch => { s = apply(s, makeEvent(s.seq + 1, 'entity.update', { kind: 'inbox', id: 'inbox-retelling', patch }, '2026-11-18T05:00:00.000Z')); };
  go({ original: 'Full pasted source text.' });
  assert.equal(s.entities.inbox['inbox-retelling'].capturedAt, '2026-11-18T05:00:00.000Z');
  go({ original: 'Tampered text.' });
  assert.match(s.rejected.at(-1).why, /preserved and cannot be edited/);
  assert.equal(s.entities.inbox['inbox-retelling'].original, 'Full pasted source text.');
  go({ test: 'Old House run', testResult: 'SUPPORTED', stage: 'TESTED' }); go({ stage: 'ELIGIBLE' });
  assert.equal(s.entities.inbox['inbox-retelling'].stage, 'ELIGIBLE');
  assert.equal(JSON.stringify([s.entities.character, s.entities.world, s.entities.plot, s.entities.theme]), before, 'no character, world, plot or theme changed');
  assert.ok(computeIntel(s).findings.some(f => /eligible for promotion and await an owner decision/.test(f.text)));
  go({ annotations: [...s.entities.inbox['inbox-retelling'].annotations, { category: 'motif', note: 'clocks', quote: 'stopped at three' }, { category: 'nonsense', note: 'x' }] });
  assert.deepEqual(s.entities.inbox['inbox-retelling'].annotations.slice(-2).map(a => a.category), ['motif', 'event']);
  const bad = apply(replay(seeded()), makeEvent(13, 'entity.create', { kind: 'inbox', id: 'x', data: { title: 't', stage: 'ELIGIBLE' } }));
  assert.match(bad.rejected.at(-1).why, /research stage ELIGIBLE/);
  const t = runCommand('stage context TESTED', { state: replay(seeded()) });
  assert.equal(t.actions.length, 0); assert.match(t.out.join(' '), /cannot move OBSERVED → TESTED/);
});

test('T-022/T-020 terminal: sys summary, theme switch, monitor route', () => {
  const s = replay(seeded());
  assert.match(runCommand('sys', { state: s, events: seeded() }).out[0], /events 12 · rejected 0/);
  assert.deepEqual(runCommand('theme phosphor', { state: s }).actions, [{ type: 'theme', theme: 'phosphor' }]);
  assert.match(runCommand('theme pink', { state: s }).out[0], /usage/);
  assert.equal(runCommand('go monitor', { state: s }).actions[0].route, 'monitor');
});

test('company precondition: telling needs someone else present', () => {
  const { s } = ohRun(8);
  for (const a of s.actions.filter(a => a.optionId === 'opt-tell')) {
    const others = s.simruns.find(r => r.tick === a.tick).situation.world.occupancy[a.from];
    assert.ok(others > 1, `${a.characterName} told at ${a.from} with ${others} present`);
  }
  const lone = { ...s.entities.character[oh('june')], place: 'Cellar', asleep: false };
  assert.match(feasibility(lone, { requires: { company: true } }, 3, { occupancy: { Cellar: 1 } }).why, /no one else at Cellar/);
  assert.equal(feasibility(lone, { requires: { company: true } }, 3, { occupancy: { Cellar: 2 } }).ok, true);
});
