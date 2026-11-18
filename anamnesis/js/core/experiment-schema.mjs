// Controlled comparisons (T-027, authorised by OD-004): definition shape and checks.
// No imports from the store, so the store can use this to validate experiment events.

export const EXPERIMENT_VERSION = 'anamnesis-experiment-1';
export const VERDICTS = ['SUPPORTED', 'REFUTED', 'INCONCLUSIVE'];
export const LIMITS = { variants: 4, seeds: 50, ticks: 240 };
// What a single factor may be. Reversible implementation default; doc 08 question 2 is still open with the owner.
export const PATCH_KINDS = {
  'character.set': 'One character setting (a trait, a value weight, where they start, or whether they start asleep)',
  'belief.set': 'One character’s confidence in one claim',
  'event.remove': 'One scripted world event is present or absent',
  'option.remove': 'One action option is present or absent',
  'mechanism.set': 'One experimental mechanism switched on (OD-005: comparisons and Preview only; the control keeps it off)',
};
export const MECHANISM_LABELS = { repeatableActions: 'P1 · Repeatable actions', experienceBeliefs: 'P3 · Experience-driven beliefs' };
export const CHARACTER_PATHS = /^(traits\.(openness|conscientiousness|extraversion|agreeableness|neuroticism)|values\.(safety|truth|loyalty|ambition|freedom|compassion|control|belonging)|place|asleep)$/;

const str = (v, max) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

function normPatch(p) {
  const kind = Object.hasOwn(PATCH_KINDS, p?.kind) ? p.kind : '';
  if (kind === 'character.set') return { kind, characterId: str(p.characterId, 80), path: str(p.path, 60), value: typeof p.value === 'boolean' ? p.value : (typeof p.value === 'number' ? p.value : str(p.value, 120)) };
  if (kind === 'belief.set') return { kind, characterId: str(p.characterId, 80), claim: str(p.claim, 300).trim(), confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)) };
  if (kind === 'event.remove') return { kind, minute: int(p.minute, 1, LIMITS.ticks, 1), index: int(p.index, 0, 99, 0) };
  if (kind === 'option.remove') return { kind, optionId: str(p.optionId, 80) };
  if (kind === 'mechanism.set') return { kind, key: str(p.key, 40), value: p.value === true || p.value === 'true' };
  return { kind: '' };
}

export function normalizeExperiment(d = {}) {
  return {
    title: str(d.title, 200).trim() || 'Untitled comparison',
    hypothesis: str(d.hypothesis, 2000).trim(), prediction: str(d.prediction, 2000).trim(),
    researchItemId: str(d.researchItemId, 80), scenarioId: str(d.scenarioId, 80),
    ticks: int(d.ticks, 1, LIMITS.ticks, 8),
    seeds: [...new Set((Array.isArray(d.seeds) ? d.seeds : []).map(s => int(s, 0, 9999, 0)))].slice(0, LIMITS.seeds),
    variants: (Array.isArray(d.variants) ? d.variants : []).slice(0, LIMITS.variants).map((v, i) => ({
      id: str(v?.id, 40) || String.fromCharCode(65 + i), label: str(v?.label, 120).trim() || `Variant ${String.fromCharCode(65 + i)}`,
      patches: (Array.isArray(v?.patches) ? v.patches : []).slice(0, 1).map(normPatch) })),
  };
}

/** What a patch changes, ignoring the value it sets. Two patches with the same target vary the same factor. */
export function patchTarget(p) {
  if (p.kind === 'character.set') return `${p.kind}|${p.characterId}|${p.path}`;
  if (p.kind === 'belief.set') return `${p.kind}|${p.characterId}|${p.claim.toLowerCase()}`;
  if (p.kind === 'event.remove') return `${p.kind}|${p.minute}|${p.index}`;
  if (p.kind === 'option.remove') return `${p.kind}|${p.optionId}`;
  if (p.kind === 'mechanism.set') return `${p.kind}|${p.key}`;
  return 'invalid';
}

/** Structural checks that need no project state. Returns a list of problems in plain words. */
export function structuralProblems(def) {
  const out = [];
  if (!def.hypothesis) out.push('Write the hypothesis being tested.');
  if (!def.prediction) out.push('Write the predicted direction before running, so the result cannot be fitted afterwards.');
  if (!def.scenarioId) out.push('Choose a scenario.');
  if (def.variants.length < 2) out.push('A comparison needs at least two variants.');
  if (!def.seeds.length) out.push('Choose at least one dice set.');
  const patches = def.variants.flatMap(v => v.patches);
  if (patches.some(p => !p.kind)) out.push('A variant has an unknown kind of change.');
  if (!patches.length) out.push('No variant changes anything. Give at least one variant a change.');
  const targets = new Set(patches.filter(p => p.kind).map(patchTarget));
  if (targets.size > 1) out.push('Variants change more than one thing. A controlled comparison varies exactly one factor; everything else must be identical.');
  const sig = def.variants.map(v => JSON.stringify(v.patches));
  if (new Set(sig).size !== sig.length) out.push('Two variants are identical.');
  for (const p of patches) if (p.kind === 'character.set' && !CHARACTER_PATHS.test(p.path)) out.push(`"${p.path}" is not a setting that can be varied.`);
  for (const p of patches) if (p.kind === 'mechanism.set' && !Object.hasOwn(MECHANISM_LABELS, p.key)) out.push(`"${p.key}" is not an experimental mechanism.`);
  if (def.variants[0]?.patches.some(p => p.kind === 'mechanism.set' && p.value)) out.push('The first variant is the control: it must leave the mechanism off.');
  return out;
}
