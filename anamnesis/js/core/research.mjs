// Research progression: OBSERVED -> HYPOTHESIZED -> TESTED -> ELIGIBLE (for promotion).
// A stage is a claim about how far an idea has been examined. Reaching ELIGIBLE changes
// nothing in the simulation: promotion is a separate owner decision and is not automated.
export const RESEARCH_STAGES = ['OBSERVED', 'HYPOTHESIZED', 'TESTED', 'ELIGIBLE'];
export const STAGE_LABEL = { OBSERVED: 'Observed', HYPOTHESIZED: 'Hypothesized', TESTED: 'Tested', ELIGIBLE: 'Eligible for promotion' };
export const TEST_RESULTS = ['NONE', 'SUPPORTED', 'REFUTED', 'INCONCLUSIVE'];
export const ANNOTATION_CATEGORIES = ['character', 'desire', 'conflict', 'event', 'causality', 'world rule', 'narrative question', 'emotional shift', 'motif', 'theme'];

const has = v => String(v || '').trim().length > 0;

/** What an item must contain to sit at a stage (cumulative). Returns a list of unmet requirements. */
export function unmetFor(item, stage) {
  const need = [];
  const at = RESEARCH_STAGES.indexOf(stage);
  if (at >= 1) {
    if (!has(item.original) && !has(item.excerpt) && !has(item.claim)) need.push('something observed: an original text, an excerpt or a claim');
    if (!has(item.hypothesis)) need.push('a written hypothesis');
  }
  if (at >= 2) {
    if (!has(item.test)) need.push('a description of how it was tested');
    if (!item.testResult || item.testResult === 'NONE') need.push('a recorded test result');
  }
  if (at >= 3) {
    if (item.testResult !== 'SUPPORTED') need.push('a test result of SUPPORTED');
    if (!item.evidence || item.evidence === 'UNREVIEWED') need.push('a reviewed evidence status');
    if (!has(item.source)) need.push('a source citation');
  }
  return need;
}

/** May `item` (already carrying any edits) move from stage `from` to stage `to`? */
export function stageCheck(item, from, to) {
  const a = RESEARCH_STAGES.indexOf(from), b = RESEARCH_STAGES.indexOf(to);
  if (b < 0) return { ok: false, why: ['unknown stage'] };
  if (b > a + 1) return { ok: false, why: [`stages cannot be skipped: next is ${RESEARCH_STAGES[a + 1]}`] };
  const why = unmetFor(item, to);
  return { ok: why.length === 0, why: why.map(w => `needs ${w}`) };
}
