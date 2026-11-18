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
  assert.deepEqual(parseOptions('Run [risk, flee]\nStay'), [{ id: 'opt-1', label: 'Run', tags: ['risk', 'flee'] }, { id: 'opt-2', label: 'Stay', tags: [] }]);
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
