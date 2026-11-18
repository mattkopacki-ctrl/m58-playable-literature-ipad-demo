// Terminal command interpreter. Pure: returns output lines plus requested actions;
// the UI performs the actions (dispatch, navigation, export).
import { liveList } from './store.mjs';
import { KINDS, INBOX_STATUS, displayName } from './schema.mjs';
import { decide, explain } from './cognition.mjs';
import { analyzeText } from './analyzer.mjs';
import { computeIntel } from './intel.mjs';
import { SITUATIONS } from './seed.mjs';
import { uid } from './rng.mjs';

const ALIAS = { characters: 'character', chars: 'character', char: 'character', worlds: 'world', plots: 'plot', themes: 'theme',
  research: 'inbox', notes: 'intel', lib: 'library', books: 'library' };
const kindOf = k => { const x = ALIAS[k?.toLowerCase()] || k?.toLowerCase(); return KINDS.includes(x) ? x : null; };
const MODULES = ['library', 'inbox', 'analyzer', 'characters', 'worlds', 'plots', 'themes', 'simulator', 'intelligence', 'terminal'];

export const HELP = [
  'help                         this list',
  'ls <kind>                    list: character world plot theme inbox library intel',
  'show <kind> <name>           print an entity as JSON',
  'new <kind> <name…>           create an entity',
  'situations                   list preset situations',
  'decide <character> [n] [hour] [seed] [--record]   inspectable decision',
  'analyze <library title>      text metrics',
  'triage <inbox title> <NEW|TRIAGED|FILED|REJECTED>',
  'intel                        health checks',
  'log [n]                      last n events (default 10)',
  'stats                        counts',
  'go <module>                  open a module',
  'export                       download the full event log',
  'clear                        clear the screen',
];

export function tokenize(line) {
  return (String(line).match(/"[^"]*"|\S+/g) || []).map(t => t.replace(/^"|"$/g, ''));
}

export function findEntity(state, kind, query) {
  const q = String(query || '').toLowerCase();
  if (!q) return null;
  const all = liveList(state, kind);
  return all.find(e => e.id.toLowerCase() === q) || all.find(e => displayName(kind, e).toLowerCase() === q)
    || all.find(e => displayName(kind, e).toLowerCase().startsWith(q)) || all.find(e => displayName(kind, e).toLowerCase().includes(q)) || null;
}

export function runCommand(line, { state, events = [] }) {
  const [cmd, ...args] = tokenize(line);
  const out = [], actions = [];
  const say = (...l) => out.push(...l);
  switch ((cmd || '').toLowerCase()) {
    case '': break;
    case 'help': case '?': say(...HELP); break;
    case 'clear': actions.push({ type: 'clear' }); break;
    case 'ls': case 'list': {
      const k = kindOf(args[0]);
      if (!k) { say(`usage: ls <${KINDS.join('|')}>`); break; }
      const items = liveList(state, k);
      say(`${items.length} ${k}`, ...items.map(e => `  ${e.id.padEnd(26)} ${displayName(k, e)}${e.status ? '  [' + e.status + ']' : ''}`));
      break;
    }
    case 'show': {
      const k = kindOf(args[0]); const e = k && findEntity(state, k, args.slice(1).join(' '));
      if (!e) { say('not found'); break; }
      say(...JSON.stringify(e, null, 2).split('\n'));
      break;
    }
    case 'new': {
      const k = kindOf(args[0]); const name = args.slice(1).join(' ').trim();
      if (!k || !name) { say('usage: new <kind> <name>'); break; }
      const field = ['character', 'world', 'theme'].includes(k) ? 'name' : 'title';
      const id = uid(k);
      actions.push({ type: 'dispatch', event: 'entity.create', payload: { kind: k, id, data: { [field]: name } } });
      say(`created ${k} ${id} "${name}"`);
      break;
    }
    case 'situations': say(...SITUATIONS.map((s, i) => `  ${i + 1}. ${s.prompt}  (${s.options.map(o => o.label).join(' / ')})`)); break;
    case 'decide': {
      const record = args.includes('--record');
      const rest = args.filter(a => a !== '--record');
      const ch = findEntity(state, 'character', rest[0]);
      if (!ch) { say('usage: decide <character> [situation#] [hour] [seed] [--record]'); break; }
      const sit = SITUATIONS[(Number(rest[1]) || 1) - 1];
      if (!sit) { say(`situation must be 1–${SITUATIONS.length}`); break; }
      const rec = decide(ch, sit, { now: Number(rest[2] ?? 48) || 0, seed: Number(rest[3] ?? 0) || 0 });
      say(`> ${sit.prompt}`, explain(rec));
      for (const r of rec.ranking) say(`  ${r.optionId === rec.chosenOptionId ? '*' : ' '} ${r.label.padEnd(30)} total ${String(r.total).padStart(7)}  p ${r.probability}`);
      say(`  digest ${rec.outputDigest}`);
      if (record) { actions.push({ type: 'dispatch', event: 'decision.record', payload: { id: uid('dec'), ...rec } }); say('  recorded.'); }
      break;
    }
    case 'analyze': {
      const doc = findEntity(state, 'library', args.join(' '));
      if (!doc) { say('usage: analyze <library title>'); break; }
      const r = analyzeText(doc.text, { names: liveList(state, 'character').map(c => c.name) });
      say(`${doc.title}: ${r.words} words, ${r.sentences} sentences, ${r.paragraphs} paragraphs`,
        `  avg sentence ${r.avgSentence} ± ${r.sentenceVariation} · Flesch ${r.fleschReadingEase} · dialogue ${r.dialogueRatio}% · tension ${r.tensionMean}%`,
        `  top: ${r.topWords.slice(0, 8).map(w => `${w.word}(${w.count})`).join(' ')}`);
      break;
    }
    case 'triage': {
      const status = (args.at(-1) || '').toUpperCase();
      const item = findEntity(state, 'inbox', args.slice(0, -1).join(' '));
      if (!item || !INBOX_STATUS.includes(status)) { say('usage: triage <inbox title> <NEW|TRIAGED|FILED|REJECTED>'); break; }
      actions.push({ type: 'dispatch', event: 'entity.update', payload: { kind: 'inbox', id: item.id, patch: { status } } });
      say(`${item.title}: ${item.status} → ${status}`);
      break;
    }
    case 'intel': {
      const i = computeIntel(state);
      say(`${i.findings.length} finding(s)`, ...i.findings.map(f => `  [${f.level}] ${f.area}: ${f.text}`));
      break;
    }
    case 'stats': { const i = computeIntel(state); say(...Object.entries(i.counts).map(([k, v]) => `  ${k.padEnd(12)} ${v}`)); break; }
    case 'log': {
      const n = Math.max(1, Math.min(200, Number(args[0]) || 10));
      say(...events.slice(-n).map(ev => `  #${String(ev.seq).padStart(4)} ${ev.at.slice(0, 19)} ${ev.type.padEnd(16)} ${ev.payload.kind ? ev.payload.kind + ':' + ev.payload.id : ev.payload.id || ev.payload.decisionId || ''}`));
      break;
    }
    case 'go': case 'open': {
      const m = MODULES.find(x => x.startsWith((args[0] || '').toLowerCase()));
      if (!m) { say(`modules: ${MODULES.join(' ')}`); break; }
      actions.push({ type: 'go', route: m }); say(`opening ${m}…`);
      break;
    }
    case 'export': actions.push({ type: 'export' }); say('export requested.'); break;
    default: say(`unknown command: ${cmd} — type help`);
  }
  return { out, actions };
}
