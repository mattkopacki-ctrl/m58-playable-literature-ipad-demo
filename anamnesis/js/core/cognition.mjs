// Inspectable character decisions. Every score is a sum of named terms, each with
// its source and reason, so any choice can be explained and replayed exactly.
// Status: SIMULATION TECHNIQUE (not a validated psychological model).
import { hashNoise, hashUnit, digest } from './rng.mjs';
import { VALUES } from './schema.mjs';

export const ENGINE_VERSION = 'anamnesis-decide-3'; // v2: hearsay weighs less. v3: belief terms; action preconditions.
export const BELIEF_COEF = 0.8;          // weight of a fully held belief on an option that presumes it
export const SOURCE_WEIGHT = { seen: 1, retold: 0.8, told: 0.6 };
export const ACTR_DECAY = 0.5;          // ACT-R default d (Anderson & Schooler 1991)
export const RECALL_THRESHOLD = -0.5;   // tuned by feel; documented, not measured
export const NOISE_SD = 0.15;

// Tags with built-in trait links. Option tags are free text; these get extra terms.
const TRAIT_TAGS = {
  risk: [['openness', 0.4], ['extraversion', 0.3], ['neuroticism', -0.6]],
  social: [['extraversion', 0.6]],
  solitude: [['extraversion', -0.5]],
  rule: [['conscientiousness', 0.6]],
  'break-rule': [['conscientiousness', -0.6]],
  help: [['agreeableness', 0.6]],
  confront: [['agreeableness', -0.5], ['neuroticism', -0.2]],
  novel: [['openness', 0.6]],
  flee: [['neuroticism', 0.5]],
};

/** ACT-R base-level activation from rehearsal times (hours). */
export function baseLevel(times, now, d = ACTR_DECAY) {
  const ages = times.map(t => now - t).filter(a => a > 0).map(a => Math.max(a, 0.05));
  if (!ages.length) return -Infinity;
  return Math.log(ages.reduce((sum, a) => sum + Math.pow(a, -d), 0));
}

/** Activation of one memory at story time `now`, given current cue tags. */
export function memoryActivation(mem, now, cues = []) {
  const times = [mem.at, ...(mem.rehearsals || [])].filter(t => t <= now);
  const base = baseLevel(times, now);
  const overlap = mem.tags.filter(t => cues.includes(t));
  const spread = overlap.length * 0.5 + mem.arousal * 0.3;
  return { base, spread, total: base + spread, overlap, retrievable: base + spread > RECALL_THRESHOLD };
}

function term(source, label, value, why) {
  return { source, label, value: Math.round(value * 1000) / 1000, why };
}

/** Score one option for one character. Pure. */
export function scoreOption(ch, situation, option, ctx) {
  const tags = option.tags || [];
  const terms = [];
  for (const v of VALUES) {
    const w = ch.values[v];
    if (!w) continue;
    if (tags.includes(v)) terms.push(term('value', v, w, `serves value "${v}" (weight ${w})`));
    if (tags.includes('!' + v)) terms.push(term('value', v, -w * 1.2, `violates value "${v}" (weight ${w}, ×1.2 loss aversion)`));
  }
  for (const g of ch.goals) {
    const hit = g.tags.filter(t => tags.includes(t));
    if (hit.length) terms.push(term('goal', g.text, g.weight * 0.8, `advances goal via [${hit.join(', ')}]`));
    const block = g.tags.filter(t => tags.includes('!' + t));
    if (block.length) terms.push(term('goal', g.text, -g.weight * 0.8, `blocks goal via [${block.join(', ')}]`));
  }
  const fearGain = 0.5 + ch.traits.neuroticism;
  for (const f of ch.fears) {
    const hit = f.tags.filter(t => tags.includes(t) || (situation.tags || []).includes(t) && tags.includes('approach'));
    if (hit.length) terms.push(term('fear', f.text, -f.weight * fearGain * 0.7, `triggers fear via [${hit.join(', ')}] (neuroticism gain ${fearGain.toFixed(2)})`));
  }
  for (const [tag, links] of Object.entries(TRAIT_TAGS)) {
    if (!tags.includes(tag)) continue;
    for (const [trait, k] of links) {
      const centred = ch.traits[trait] - 0.5;
      terms.push(term('trait', `${trait}·${tag}`, centred * k, `${trait} ${ch.traits[trait]} on "${tag}" (coef ${k})`));
    }
  }
  const cues = [...tags, ...(situation.tags || [])];
  for (const m of ch.memories) {
    if (m.at > ctx.now) continue;
    const act = memoryActivation(m, ctx.now, cues);
    if (!act.retrievable || !act.overlap.length) continue;
    const weight = Math.max(0, Math.min(1.5, act.total + 1)) / 1.5;
    const sharedWithOption = m.tags.filter(t => tags.includes(t));
    if (!sharedWithOption.length) continue;
    const sw = SOURCE_WEIGHT[m.source] ?? 1;
    terms.push(term('memory', m.text.slice(0, 60), m.valence * weight * 0.6 * sw,
      `recalled (A=${act.total.toFixed(2)}, cues [${act.overlap.join(', ')}]), valence ${m.valence}${sw !== 1 ? `, source ${m.source} ×${sw}` : ''}`));
  }
  // Beliefs: an option may presume a claim true (+1) or false (-1). Only beliefs the
  // character actually holds count; an unheld claim contributes nothing.
  for (const link of option.beliefs || []) {
    const held = (ch.beliefs || []).find(b => String(b.claim).trim().toLowerCase() === String(link.claim).trim().toLowerCase());
    if (!held) continue;
    const sign = link.sign < 0 ? -1 : 1;
    const lean = (held.confidence - 0.5) * 2;
    terms.push(term('belief', held.claim.slice(0, 60), sign * lean * BELIEF_COEF,
      `holds "${held.claim}" at ${held.confidence}; this option presumes it ${sign > 0 ? 'true' : 'false'} (coef ${BELIEF_COEF})`));
  }
  const noise = hashNoise(NOISE_SD, ch.id, situation.id, option.id, ctx.seed);
  terms.push(term('noise', 'hashed noise', noise, `deterministic draw for (${ch.id}, ${situation.id}, ${option.id}, seed ${ctx.seed})`));
  const total = terms.reduce((s, t) => s + t.value, 0);
  return { optionId: option.id, label: option.label, total: Math.round(total * 1000) / 1000, terms };
}

/**
 * Action preconditions. option.requires = { awake, places, notPlaces, knows: [tag], lacks: [tag], world: [flag], company: true }.
 * company: at least one other awake-or-asleep cast member is at the same place (from situation.world.occupancy).
 * World flags are read from situation.world, which is stored with the decision so replay is exact.
 * "knows" means the character holds a memory (from any source) carrying that tag by now.
 */
export function feasibility(ch, option, now, world = {}) {
  const r = option.requires;
  if (!r) return { ok: true, why: '' };
  for (const w of r.world || []) if (!world[w]) return { ok: false, why: `world condition not met: ${w}` };
  if (r.notPlaces?.includes(ch.place)) return { ok: false, why: `already at ${ch.place}` };
  for (const tag of r.lacks || []) {
    if ((ch.memories || []).some(m => m.at <= now && m.tags.includes(tag))) return { ok: false, why: `already done: ${tag}` };
  }
  if (r.awake === true && ch.asleep) return { ok: false, why: 'asleep' };
  if (r.awake === false && !ch.asleep) return { ok: false, why: 'not asleep' };
  if (r.places?.length && !r.places.includes(ch.place)) return { ok: false, why: `not at ${r.places.join(' or ')} (is at ${ch.place || 'nowhere'})` };
  if (r.company && !((world.occupancy?.[ch.place] || 0) > 1)) return { ok: false, why: `no one else at ${ch.place || 'this place'}` };
  for (const tag of r.knows || []) {
    if (!(ch.memories || []).some(m => m.at <= now && m.tags.includes(tag))) return { ok: false, why: `does not know: ${tag}` };
  }
  return { ok: true, why: '' };
}

/** Decide among options. Returns a full, replayable decision trace. */
export function decide(ch, situation, { now = 0, seed = 0 } = {}) {
  if (!situation.options?.length) throw new Error('Situation has no options');
  const ctx = { now, seed };
  const excluded = [];
  const open = situation.options.filter(o => {
    const f = feasibility(ch, o, now, situation.world);
    if (!f.ok) excluded.push({ optionId: o.id, label: o.label, why: f.why });
    return f.ok;
  });
  if (!open.length) throw new Error(`${ch.name} has no feasible action: ${excluded.map(e => `${e.label} (${e.why})`).join('; ')}`);
  const ranking = open.map(o => scoreOption(ch, situation, o, ctx)).sort((a, b) => b.total - a.total || a.optionId.localeCompare(b.optionId));
  const exps = ranking.map(r => Math.exp(r.total * 3));
  const z = exps.reduce((a, b) => a + b, 0);
  ranking.forEach((r, i) => { r.probability = Math.round((exps[i] / z) * 1000) / 1000; });
  const chosen = ranking[0];
  const margin = ranking.length > 1 ? chosen.total - ranking[1].total : chosen.total;
  const inputs = { character: snapshotForDecision(ch), situation, now, seed, engine: ENGINE_VERSION };
  return {
    engine: ENGINE_VERSION, status: 'SIMULATION',
    characterId: ch.id, characterName: ch.name, situationId: situation.id, prompt: situation.prompt,
    chosenOptionId: chosen.optionId, chosenLabel: chosen.label,
    margin: Math.round(margin * 1000) / 1000,
    confidence: chosen.probability,
    ranking, excluded, inputs, inputsDigest: digest(inputs),
    // Records made before preconditions existed hash the ranking alone; that still verifies.
    outputDigest: digest(excluded.length ? { ranking, excluded } : ranking),
  };
}

/** Recompute a recorded decision from its stored inputs and compare digests. */
export function verifyDecision(record) {
  const { character, situation, now, seed } = record.inputs;
  const again = decide(character, situation, { now, seed });
  const ok = again.outputDigest === record.outputDigest && again.chosenOptionId === record.chosenOptionId;
  return { ok, detail: ok ? `replay matched (${again.outputDigest})` : `MISMATCH: recorded ${record.outputDigest}, replay ${again.outputDigest}` };
}

export function snapshotForDecision(ch) {
  const { id, name, traits, values, goals, fears, memories, beliefs = [], place = '', asleep = false } = ch;
  return structuredClone({ id, name, traits, values, goals, fears, memories, beliefs, place, asleep });
}

/** One-line human explanation of the top reasons. */
export function explain(record) {
  const top = record.ranking[0];
  const reasons = [...top.terms].filter(t => t.source !== 'noise').sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3)
    .map(t => `${t.value >= 0 ? '+' : ''}${t.value} ${t.source}:${t.label}`);
  return `${record.characterName} → "${top.label}" (p=${top.probability}, margin ${record.margin}). Top terms: ${reasons.join('; ') || 'none'}.`;
}

/** Parse "Label [tag, tag]" lines into options. */
export function parseOptions(text) {
  return String(text).split('\n').map(l => l.trim()).filter(Boolean).map((raw, i) => {
    // Optional trailing {+claim presumed true; -claim presumed false}
    const b = raw.match(/\{(.*)\}\s*$/);
    const beliefs = b ? b[1].split(';').map(s => s.trim()).filter(Boolean).map(s => ({ sign: s.startsWith('-') ? -1 : 1, claim: s.replace(/^[+-]\s*/, '') })).filter(x => x.claim) : [];
    const line = (b ? raw.slice(0, b.index) : raw).trim();
    const m = line.match(/^(.*?)\s*\[(.*)\]\s*$/);
    const label = (m ? m[1] : line).trim() || `Option ${i + 1}`;
    const tags = m ? m[2].split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    return { id: 'opt-' + (i + 1), label, tags, beliefs };
  });
}

// ---------------------------------------------------------------------------
// Beliefs and conversations. Status: SIMULATION TECHNIQUE. Parameters are tuned
// by feel and documented here; none are measured.
export const BELIEF_GAIN = 2;            // log-odds per unit of strength × credibility
export const PERSEVERANCE = 0.5;         // how much entrenchment discounts contrary evidence
export const MEMORY_CREDIBILITY = { seen: 0.9, retold: 0.7, told: 0.5 };

const r3 = x => Math.round(x * 1000) / 1000;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const logit = p => Math.log(p / (1 - p));
const sameClaim = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Update one character's confidence in a claim from one piece of evidence. Pure.
 * evidence = { direction: +1 supports | -1 contradicts, strength 0..1, credibility 0..1, source: {type, ref, text} }
 * Evidence against the way the character already leans is discounted by entrenchment
 * (belief perseverance); evidence with it is taken at face value.
 */
export function updateBelief(ch, claim, evidence) {
  const text = String(claim || '').trim();
  if (!text) throw new Error('Belief update needs a claim');
  const direction = evidence.direction < 0 ? -1 : 1;
  const strength = clamp(Number(evidence.strength) || 0, 0, 1);
  const credibility = clamp(Number(evidence.credibility) || 0, 0, 1);
  const existing = ch.beliefs.find(b => sameClaim(b.claim, text));
  const before = clamp(existing ? existing.confidence : 0.5, 0.02, 0.98);
  const lean = Math.sign(before - 0.5);
  const entrenchment = Math.abs(before - 0.5) * 2;
  const against = lean !== 0 && lean !== direction;
  const resist = against ? 1 - PERSEVERANCE * entrenchment : 1;
  const delta = direction * strength * credibility * BELIEF_GAIN * resist;
  const after = r3(clamp(1 / (1 + Math.exp(-(logit(before) + delta))), 0.02, 0.98));
  return {
    characterId: ch.id, characterName: ch.name, claim: existing ? existing.claim : text, isNew: !existing,
    direction, strength, credibility, before: r3(before), after, source: evidence.source || { type: 'observation' },
    terms: [
      { label: 'prior confidence', value: r3(before), why: existing ? 'held belief' : 'no prior belief: starts at 0.5' },
      { label: 'evidence', value: r3(direction * strength), why: `${direction > 0 ? 'supports' : 'contradicts'} at strength ${strength}` },
      { label: 'credibility', value: r3(credibility), why: `source ${evidence.source?.type || 'observation'}` },
      { label: 'perseverance', value: r3(resist), why: against ? `contrary to a belief held with entrenchment ${r3(entrenchment)}; discounted` : 'not contrary to current lean; no discount' },
      { label: 'log-odds shift', value: r3(delta), why: `direction × strength × credibility × ${BELIEF_GAIN} × perseverance` },
    ],
    status: 'SIMULATION',
  };
}

/**
 * Which source does the holder attribute a memory to right now? Hearsay can come to
 * feel like something seen (source misattribution). The draw is fixed per memory and
 * the probability only rises, so once a memory flips it stays flipped.
 */
export function attributeSource(mem, now, ownerId) {
  if (mem.source !== 'told') return { attributed: mem.source || 'seen', p: 0, misattributed: false };
  const age = Math.max(0, now - mem.at);
  const p = r3(Math.min(0.6, 0.05 + 0.004 * age + 0.05 * (mem.rehearsals?.length || 0)));
  const misattributed = hashUnit(ownerId, mem.id, 'source') < p;
  return { attributed: misattributed ? 'seen' : 'told', p, misattributed };
}

/** Credibility a character gives one of their own memories as evidence. */
export function memoryCredibility(mem, now, ownerId) {
  return MEMORY_CREDIBILITY[attributeSource(mem, now, ownerId).attributed] ?? 0.5;
}

/**
 * One character tells another one memory. The listener receives only what was said
 * (never the speaker's other memories or world truth) as a new trace with source "told".
 */
export function buildConversation(speaker, listener, memoryId, { now = 0, cues = [], asTold = '', claim = '', direction = 1, strength = 0.5 } = {}) {
  if (!speaker || !listener) throw new Error('Conversation needs a speaker and a listener');
  if (speaker.id === listener.id) throw new Error('A character cannot tell themselves');
  const mem = speaker.memories.find(m => m.id === memoryId);
  if (!mem) throw new Error('Speaker does not hold that memory');
  if (mem.at > now) throw new Error('That memory has not happened yet at this story hour');
  const act = memoryActivation(mem, now, cues);
  if (!act.retrievable) throw new Error(`${speaker.name} cannot recall that right now (A=${act.total.toFixed(2)}, threshold ${RECALL_THRESHOLD})`);
  const toldText = String(asTold || '').trim() || mem.text;
  const slanted = toldText !== mem.text;
  const key = digest({ s: speaker.id, l: listener.id, m: mem.id, now });
  const listenerMemory = { id: `mem-told-${key}`, text: toldText, at: now, tags: mem.tags, valence: r3(mem.valence * 0.8), arousal: r3(mem.arousal * 0.6),
    rehearsals: [], source: 'told', from: speaker.id, originId: mem.id };
  const speakerRecollection = slanted ? { id: `mem-retold-${key}`, text: toldText, at: now, tags: mem.tags, valence: mem.valence, arousal: r3(mem.arousal * 0.8),
    rehearsals: [], source: 'retold', from: speaker.id, originId: mem.id } : null;
  const trust = r3(0.3 + 0.4 * listener.traits.agreeableness);
  const beliefUpdate = String(claim).trim()
    ? updateBelief(listener, claim, { direction, strength, credibility: trust, source: { type: 'conversation', ref: speaker.id, text: `told by ${speaker.name}` } }) : null;
  return { speakerId: speaker.id, speakerName: speaker.name, listenerId: listener.id, listenerName: listener.name, memoryId: mem.id,
    storyTime: now, toldText, slanted, activation: r3(act.total), trust, listenerMemory, speakerRecollection, beliefUpdate, status: 'SIMULATION' };
}
