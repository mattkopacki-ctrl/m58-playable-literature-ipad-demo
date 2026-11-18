// Entity kinds and normalisation. Every stored entity passes through normalize()
// so the reducer never holds malformed data.

export const KINDS = ['library', 'inbox', 'character', 'world', 'plot', 'theme', 'intel'];

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
  }),
  character: d => ({
    name: str(d.name, 120) || 'Unnamed', role: str(d.role, 200), summary: str(d.summary, 4000),
    worldId: str(d.worldId, 80),
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

export function normalize(kind, data) {
  const fn = normalizers[kind];
  if (!fn) throw new Error(`Unknown kind: ${kind}`);
  return fn(data && typeof data === 'object' ? data : {});
}

export function displayName(kind, e) {
  if (!e) return '(missing)';
  return e.name || e.title || e.id;
}
