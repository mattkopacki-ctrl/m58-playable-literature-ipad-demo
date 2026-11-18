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
