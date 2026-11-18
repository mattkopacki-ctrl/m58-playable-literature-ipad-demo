// Entity kinds and normalisation. Every stored entity passes through normalize()
// so the reducer never holds malformed data.

import { RESEARCH_STAGES, TEST_RESULTS, ANNOTATION_CATEGORIES } from './research.mjs';

export const KINDS = ['library', 'inbox', 'character', 'world', 'plot', 'theme', 'intel', 'scenario'];

export const EVIDENCE = ['UNREVIEWED', 'ESTABLISHED', 'SUPPORTED', 'CONTESTED', 'SIMULATION', 'FICTIONAL'];
export const EVIDENCE_LABEL = {
  UNREVIEWED: 'Unreviewed',
  ESTABLISHED: 'Established',
  SUPPORTED: 'Supported (modest)',
  CONTESTED: 'Contested',
  SIMULATION: 'Simulation technique',
  FICTIONAL: 'Fictional license',
};
export const INBOX_STATUS = ['NEW', 'TRIAGED', 'FILED', 'REJECTED'];
export const VALUES = ['safety', 'truth', 'loyalty', 'ambition', 'freedom', 'compassion', 'control', 'belonging'];
export const MEMORY_SOURCES = ['seen', 'told', 'retold'];
export const TRAITS = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'];

const str = (v, max = 20000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
export const tagList = v => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\s]+/) : [];
  return [...new Set(arr.map(t => str(t, 60).trim().toLowerCase()).filter(Boolean))].slice(0, 40);
};
const list = (v, fn, max = 200) => (Array.isArray(v) ? v : []).slice(0, max).map(fn);

const normalizers = {
  scenario: d => scenarioNormalizer(d),
  library: d => ({
    title: str(d.title, 200) || 'Untitled', author: str(d.author, 200),
    form: oneOf(d.form, ['manuscript', 'reference', 'note', 'excerpt'], 'manuscript'),
    text: str(d.text, 500000), tags: tagList(d.tags),
  }),
  inbox: d => ({
    title: str(d.title, 200) || 'Untitled finding', source: str(d.source, 400), url: str(d.url, 1000),
    claim: str(d.claim, 4000), excerpt: str(d.excerpt, 8000), notes: str(d.notes, 8000),
    evidence: oneOf(d.evidence, EVIDENCE, 'UNREVIEWED'), status: oneOf(d.status, INBOX_STATUS, 'NEW'),
    tags: tagList(d.tags), links: list(d.links, x => str(x, 80)).filter(Boolean),
    stage: oneOf(d.stage, RESEARCH_STAGES, 'OBSERVED'), original: str(d.original, 200000), capturedAt: str(d.capturedAt, 40),
    hypothesis: str(d.hypothesis, 4000), test: str(d.test, 4000), testResult: oneOf(d.testResult, TEST_RESULTS, 'NONE'),
    annotations: list(d.annotations, a => ({ category: oneOf(a.category, ANNOTATION_CATEGORIES, 'event'), note: str(a.note, 2000), quote: str(a.quote, 2000) }), 300),
  }),
  character: d => ({
    name: str(d.name, 120) || 'Unnamed', role: str(d.role, 200), summary: str(d.summary, 4000),
    worldId: str(d.worldId, 80), place: str(d.place, 120), asleep: d.asleep === true,
    traits: Object.fromEntries(TRAITS.map(t => [t, num(d.traits?.[t], 0, 1, 0.5)])),
    values: Object.fromEntries(VALUES.map(v => [v, num(d.values?.[v], 0, 1, 0.3)])),
    goals: list(d.goals, g => ({ text: str(g.text, 300), weight: num(g.weight, 0, 1, 0.5), tags: tagList(g.tags) }), 30),
    fears: list(d.fears, f => ({ text: str(f.text, 300), weight: num(f.weight, 0, 1, 0.5), tags: tagList(f.tags) }), 30),
    beliefs: list(d.beliefs, b => ({ claim: str(b.claim, 300), confidence: num(b.confidence, 0, 1, 0.5) }), 50),
    memories: list(d.memories, (m, i) => ({
      id: str(m.id, 80) || 'mem-' + i,
      text: str(m.text, 1000), at: num(m.at, -100000, 100000, 0), tags: tagList(m.tags),
      valence: num(m.valence, -1, 1, 0), arousal: num(m.arousal, 0, 1, 0.3),
      rehearsals: list(m.rehearsals, t => num(t, -100000, 100000, 0), 500),
      source: oneOf(m.source, MEMORY_SOURCES, 'seen'), from: str(m.from, 80), originId: str(m.originId, 80),
    }), 500),
  }),
  world: d => ({
    name: str(d.name, 120) || 'Unnamed world', genre: str(d.genre, 120), summary: str(d.summary, 8000),
    rules: list(d.rules, r => str(r, 500), 100).filter(Boolean),
    places: list(d.places, p => str(p, 200), 200).filter(Boolean), tags: tagList(d.tags),
  }),
  plot: d => ({
    title: str(d.title, 200) || 'Untitled plot', worldId: str(d.worldId, 80), logline: str(d.logline, 1000),
    status: oneOf(d.status, ['draft', 'active', 'parked'], 'draft'),
    beats: list(d.beats, (b, i) => ({
      id: str(b.id, 80) || 'beat-' + i,
      title: str(b.title, 200), summary: str(b.summary, 4000),
      characterIds: list(b.characterIds, x => str(x, 80)).filter(Boolean),
      themeIds: list(b.themeIds, x => str(x, 80)).filter(Boolean),
      tension: num(b.tension, 0, 10, 5),
    }), 300),
  }),
  theme: d => ({
    name: str(d.name, 120) || 'Unnamed theme', statement: str(d.statement, 1000), question: str(d.question, 1000),
    motifs: tagList(d.motifs),
  }),
  intel: d => ({
    title: str(d.title, 200) || 'Untitled', body: str(d.body, 20000),
    form: oneOf(d.form, ['finding', 'hypothesis', 'risk', 'question'], 'finding'),
    evidence: oneOf(d.evidence, EVIDENCE, 'UNREVIEWED'), tags: tagList(d.tags),
  }),
};

// ---- Authored scenarios (T-028). Pure data; js/core/studio.mjs compiles it for the runner.
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const optNum = (v, lo, hi) => (v === '' || v == null || !Number.isFinite(Number(v))) ? null : Math.max(lo, Math.min(hi, Number(v)));
const strs = (v, max = 120) => list(v, x => str(x, max).trim()).filter(Boolean);
const kv = v => list(v, x => ({ key: str(x?.key, 60).trim(), value: str(x?.value, 120).trim() })).filter(x => x.key);
const channel = c => ({ name: str(c?.name, 80) || 'perceived', places: strs(c?.places), wakes: c?.wakes === true, text: str(c?.text, 1000),
  tags: tagList(c?.tags), valence: optNum(c?.valence, -1, 1), arousal: optNum(c?.arousal, 0, 1) });
const worldEventData = e => ({ title: str(e?.title, 200) || 'Untitled event', place: str(e?.place, 120), truth: str(e?.truth, 4000),
  valence: num(e?.valence, -1, 1, 0), arousal: num(e?.arousal, 0, 1, 0.5), channels: list(e?.channels, channel, 20) });
export const SCENARIO_LIMITS = { ticks: 240, events: 100, options: 40 };

const scenarioNormalizer = d => ({
  name: str(d.name, 200) || 'Untitled scenario', worldId: str(d.worldId, 80), prompt: str(d.prompt, 500) || 'What do you do this minute?',
  tags: tagList(d.tags), start: /^([01]\d|2[0-3]):[0-5]\d$/.test(d.start) ? d.start : '00:00', ticks: int(d.ticks, 1, SCENARIO_LIMITS.ticks, 8),
  situationId: str(d.situationId, 80), facts: kv(d.facts),
  cast: list(d.cast, c => ({ characterId: str(c?.characterId, 80), place: str(c?.place, 120), asleep: c?.asleep === true }), 30).filter(c => c.characterId),
  events: list(d.events, (e, i) => ({ id: str(e?.id, 80) || 'ev-' + i, minute: int(e?.minute, 1, SCENARIO_LIMITS.ticks, 1), ...worldEventData(e) }), SCENARIO_LIMITS.events),
  options: list(d.options, (o, i) => ({
    id: str(o?.id, 80) || 'opt-' + i, label: str(o?.label, 200) || `Option ${i + 1}`, tags: tagList(o?.tags),
    beliefs: list(o?.beliefs, b => ({ claim: str(b?.claim, 300).trim(), sign: Number(b?.sign) < 0 ? -1 : 1 }), 10).filter(b => b.claim),
    requires: { awake: oneOf(o?.requires?.awake, ['any', 'awake', 'asleep'], 'awake'), places: strs(o?.requires?.places), notPlaces: strs(o?.requires?.notPlaces),
      knows: tagList(o?.requires?.knows), lacks: tagList(o?.requires?.lacks), company: o?.requires?.company === true, world: strs(o?.requires?.world, 200) },
    effects: { moveTo: str(o?.effects?.moveTo, 120),
      remember: { text: str(o?.effects?.remember?.text, 1000), tags: tagList(o?.effects?.remember?.tags), valence: num(o?.effects?.remember?.valence, -1, 1, 0), arousal: num(o?.effects?.remember?.arousal, 0, 1, 0.3) },
      wakeWith: str(o?.effects?.wakeWith, 60).trim().toLowerCase(), tellHere: str(o?.effects?.tellHere, 60).trim().toLowerCase(), setFacts: kv(o?.effects?.setFacts),
      emits: o?.effects?.emits ? { ...worldEventData(o.effects.emits), actorText: str(o.effects.emits.actorText, 1000), actorTags: tagList(o.effects.emits.actorTags) } : null },
  }), SCENARIO_LIMITS.options),
});

export function normalize(kind, data) {
  const fn = normalizers[kind];
  if (!fn) throw new Error(`Unknown kind: ${kind}`);
  return fn(data && typeof data === 'object' ? data : {});
}

export function displayName(kind, e) {
  if (!e) return '(missing)';
  return e.name || e.title || e.id;
}
