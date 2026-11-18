// Inspectable character decisions. Every score is a sum of named terms, each with
// its source and reason, so any choice can be explained and replayed exactly.
// Status: SIMULATION TECHNIQUE (not a validated psychological model).
import { hashNoise, digest } from './rng.mjs';
import { VALUES } from './schema.mjs';

export const ENGINE_VERSION = 'anamnesis-decide-1';
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
    terms.push(term('memory', m.text.slice(0, 60), m.valence * weight * 0.6,
      `recalled (A=${act.total.toFixed(2)}, cues [${act.overlap.join(', ')}]), valence ${m.valence}`));
  }
  const noise = hashNoise(NOISE_SD, ch.id, situation.id, option.id, ctx.seed);
  terms.push(term('noise', 'hashed noise', noise, `deterministic draw for (${ch.id}, ${situation.id}, ${option.id}, seed ${ctx.seed})`));
  const total = terms.reduce((s, t) => s + t.value, 0);
  return { optionId: option.id, label: option.label, total: Math.round(total * 1000) / 1000, terms };
}

/** Decide among options. Returns a full, replayable decision trace. */
export function decide(ch, situation, { now = 0, seed = 0 } = {}) {
  if (!situation.options?.length) throw new Error('Situation has no options');
  const ctx = { now, seed };
  const ranking = situation.options.map(o => scoreOption(ch, situation, o, ctx)).sort((a, b) => b.total - a.total || a.optionId.localeCompare(b.optionId));
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
    ranking, inputs, inputsDigest: digest(inputs), outputDigest: digest(ranking),
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
  const { id, name, traits, values, goals, fears, memories } = ch;
  return structuredClone({ id, name, traits, values, goals, fears, memories });
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
  return String(text).split('\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
    const m = line.match(/^(.*?)\s*\[(.*)\]\s*$/);
    const label = (m ? m[1] : line).trim() || `Option ${i + 1}`;
    const tags = m ? m[2].split(/[,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    return { id: 'opt-' + (i + 1), label, tags };
  });
}
