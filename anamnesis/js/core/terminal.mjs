// Terminal command interpreter. Pure: returns output lines plus requested actions;
// the UI performs the actions (dispatch, navigation, export).
import { liveList } from './store.mjs';
import { KINDS, INBOX_STATUS, displayName } from './schema.mjs';
import { decide, explain, updateBelief, buildConversation, memoryActivation } from './cognition.mjs';
import { analyzeText } from './analyzer.mjs';
import { computeIntel } from './intel.mjs';
import { SITUATIONS } from './seed.mjs';
import { uid } from './rng.mjs';
import { RESEARCH_STAGES, stageCheck } from './research.mjs';
import { OLD_HOUSE } from './oldhouse.mjs';
import { stepScenario, scenarioStatus, inspectCharacter, buildWorldEvent, clockOf } from './scenario.mjs';

const ALIAS = { characters: 'character', chars: 'character', char: 'character', worlds: 'world', plots: 'plot', themes: 'theme',
  research: 'inbox', notes: 'intel', lib: 'library', books: 'library' };
const kindOf = k => { const x = ALIAS[k?.toLowerCase()] || k?.toLowerCase(); return KINDS.includes(x) ? x : null; };
const MODULES = ['library', 'inbox', 'analyzer', 'characters', 'worlds', 'plots', 'themes', 'simulator', 'intelligence', 'terminal', 'monitor'];

export const HELP = [
  'help                         this list',
  'ls <kind>                    list: character world plot theme inbox library intel',
  'show <kind> <name>           print an entity as JSON',
  'new <kind> <name…>           create an entity',
  'situations                   list preset situations',
  'decide <character> [n] [hour] [seed] [--record]   inspectable decision',
  'memories <character> [hour]  list memories with numbers and activation',
  'tell <speaker> <listener> <memory#> [hour] [cue,cue]   speaker tells listener a memory',
  'beliefs <character>          list beliefs',
  'believe <character> <+|-strength> <claim…>   apply evidence, e.g. believe theo -0.6 "claim"',
  'oldhouse                     install the five-character Old House scenario (SAMPLE)',
  'tick [n]                     advance the Old House by n minutes (default 1)',
  'status                       scenario clock, facts and where everyone is',
  'inspect <name>               what one character knows (never world truth)',
  'event knock                  author injects another knock at the basement door',
  'characters                   same as: ls character',
  'analyze <library title>      text metrics',
  'triage <inbox title> <NEW|TRIAGED|FILED|REJECTED>',
  'stage <inbox title> <OBSERVED|HYPOTHESIZED|TESTED|ELIGIBLE>   move a research item along',
  'intel                        health checks',
  'log [n]                      last n events (default 10)',
  'stats                        counts',
  'go <module>                  open a module',
  'sys                          system summary (full detail: go monitor)',
  'theme <navy|phosphor>        switch colour theme',
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
    case 'memories': {
      const ch = findEntity(state, 'character', args[0]);
      if (!ch) { say('usage: memories <character> [hour]'); break; }
      const now = Number(args[1] ?? 48) || 0;
      say(...ch.memories.map((m, i) => { const a = memoryActivation(m, now, m.tags); return `  ${i + 1}. [${m.source || 'seen'}] h${m.at} A(all cues)=${Number.isFinite(a.total) ? a.total.toFixed(2) : '—'}  ${m.text}`; }));
      if (!ch.memories.length) say('  none');
      break;
    }
    case 'tell': {
      const sp = findEntity(state, 'character', args[0]), li = findEntity(state, 'character', args[1]);
      const mem = sp?.memories[(Number(args[2]) || 0) - 1];
      if (!sp || !li || !mem) { say('usage: tell <speaker> <listener> <memory#> [hour] [cue,cue]'); break; }
      try {
        const c = buildConversation(sp, li, mem.id, { now: Number(args[3] ?? 48) || 0, cues: args[4] ? args[4].split(',') : mem.tags });
        actions.push({ type: 'dispatch', event: 'conversation.record', payload: c });
        say(`${sp.name} → ${li.name}: "${c.toldText}" (A=${c.activation}); stored as hearsay.`);
      } catch (err) { say('cannot tell: ' + err.message); }
      break;
    }
    case 'beliefs': {
      const ch = findEntity(state, 'character', args[0]);
      if (!ch) { say('usage: beliefs <character>'); break; }
      say(...ch.beliefs.map(b => `  ${String(b.confidence).padEnd(6)} ${b.claim}`)); if (!ch.beliefs.length) say('  none');
      break;
    }
    case 'believe': {
      const ch = findEntity(state, 'character', args[0]); const v = Number(args[1]); const claim = args.slice(2).join(' ');
      if (!ch || !Number.isFinite(v) || v === 0 || !claim) { say('usage: believe <character> <+|-strength> <claim…>'); break; }
      const u = updateBelief(ch, claim, { direction: Math.sign(v), strength: Math.abs(v), credibility: 0.7, source: { type: 'observation', text: 'terminal' } });
      actions.push({ type: 'dispatch', event: 'belief.update', payload: u });
      say(`${ch.name}: "${u.claim}" ${u.before} → ${u.after}  (perseverance ×${u.terms[3].value}, credibility 0.7)`);
      break;
    }
    case 'characters': return runCommand('ls character', { state, events });
    case 'oldhouse': {
      if (scenarioStatus(state, OLD_HOUSE).installed) { say('Old House is already installed. Try: status, tick'); break; }
      if (state.entities.world[OLD_HOUSE.worldId]) { say('Old House world exists but its cast is incomplete; not installing over it.'); break; }
      for (const [event, payload] of OLD_HOUSE.installEvents()) actions.push({ type: 'dispatch', event, payload });
      say('Old House installed: 5 characters, 02:13. Try: tick, status, inspect mara');
      break;
    }
    case 'tick': {
      const n = Math.max(1, Math.min(OLD_HOUSE.maxTicks, Number(args[0]) || 1));
      let st = state;
      try {
        for (let i = 0; i < n; i++) {
          const r = stepScenario(st, OLD_HOUSE);
          for (const [event, payload] of r.events) actions.push({ type: 'dispatch', event, payload });
          say(`${r.clock}  ` + r.events.filter(e => e[0] === 'world.act').map(e => `${e[1].characterName.split(' ')[0]}: ${e[1].label}`).join(' | '));
          for (const e of r.events.filter(e => e[0] === 'world.event')) say(`       * ${e[1].title} — perceived by ${e[1].perceptions.map(p => p.characterName.split(' ')[0]).join(', ') || 'no one'}`);
          st = r.state;
        }
      } catch (err) { say(err.message); }
      break;
    }
    case 'status': {
      const st = scenarioStatus(state, OLD_HOUSE);
      if (!st.installed) { say('No scenario installed. Type: oldhouse'); break; }
      say(`Old House · ${st.clock} · tick ${st.tick}/${OLD_HOUSE.maxTicks} · PAUSED`, '  ' + Object.entries(st.facts).map(([k, v]) => `${k}: ${v}`).join(' · '),
        `  world events: ${state.worldEvents.filter(e => e.provenance === 'author').length} authored, ${state.worldEvents.filter(e => e.provenance !== 'author').length} from actions`,
        ...OLD_HOUSE.cast.map(id => inspectCharacter(state, id)).map(c => `  ${c.name.padEnd(14)} ${c.asleep ? 'asleep' : 'awake '}  ${c.place.padEnd(16)} ${c.lastAction}`));
      break;
    }
    case 'inspect': {
      const q = args.join(' ').toLowerCase();
      const cast = OLD_HOUSE.cast.map(id => state.entities.character[id]).filter(Boolean);
      const ch = cast.find(c => c.name.toLowerCase().startsWith(q)) || findEntity(state, 'character', q);
      if (!ch || !q) { say('usage: inspect <name>'); break; }
      const c = inspectCharacter(state, ch.id);
      say(`${c.name} · ${c.asleep ? 'asleep' : 'awake'} · ${c.place || '—'} · last: ${c.lastAction}`, '  beliefs:', ...c.beliefs.map(b => `    ${b.confidence}  ${b.claim}`),
        '  knows (own perception and hearsay only):', ...c.memories.map(m => `    [${m.source === 'told' ? 'told by ' + m.from : m.source === 'retold' ? 'own retelling' : 'perceived'}] ${m.text}`));
      break;
    }
    case 'event': {
      const st = scenarioStatus(state, OLD_HOUSE);
      if ((args[0] || '').toLowerCase() !== 'knock' || !st.installed || !st.tick) { say('usage: event knock   (needs the Old House running: oldhouse, tick)'); break; }
      const payload = buildWorldEvent(OLD_HOUSE.script[4][0], { id: `we-${OLD_HOUSE.id}-m${state.seq + 1}`, storyTime: state.scenario.storyTime,
        characters: OLD_HOUSE.cast.map(id => state.entities.character[id]) });
      actions.push({ type: 'dispatch', event: 'world.event', payload });
      say(`${clockOf(payload.storyTime)} knock — perceived by ${payload.perceptions.map(p => p.characterName.split(' ')[0]).join(', ') || 'no one'}`);
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
    case 'stage': {
      const to = (args.at(-1) || '').toUpperCase();
      const item = findEntity(state, 'inbox', args.slice(0, -1).join(' '));
      if (!item || !RESEARCH_STAGES.includes(to)) { say(`usage: stage <inbox title> <${RESEARCH_STAGES.join('|')}>`); break; }
      const gate = stageCheck(item, item.stage, to);
      if (!gate.ok) { say(`${item.title}: cannot move ${item.stage} → ${to}`, ...gate.why.map(w => '  ' + w)); break; }
      actions.push({ type: 'dispatch', event: 'entity.update', payload: { kind: 'inbox', id: item.id, patch: { stage: to } } });
      say(`${item.title}: ${item.stage} → ${to}`);
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
    case 'sys': {
      const byType = {}; for (const ev of events) byType[ev.type] = (byType[ev.type] || 0) + 1;
      say(`events ${events.length} · rejected ${state.rejected.length} · decisions ${state.decisions.length} · runs ${state.simruns.length} · world events ${state.worldEvents.length}`,
        ...Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `  ${t.padEnd(22)} ${n}`), '  background processes: none · network/AI calls: none');
      break;
    }
    case 'theme': {
      const t = (args[0] || '').toLowerCase();
      if (!['navy', 'phosphor'].includes(t)) { say('usage: theme <navy|phosphor>'); break; }
      actions.push({ type: 'theme', theme: t }); say(`theme: ${t}`);
      break;
    }
    case 'export': actions.push({ type: 'export' }); say('export requested.'); break;
    default: say(`unknown command: ${cmd} — type help`);
  }
  return { out, actions };
}
