// Append-only event log + pure reducer. State is always a replay of the log, so
// nothing is edited in place and every change is traceable (NUE-CR-001 rule 2).
import { KINDS, normalize } from './schema.mjs';
import { stageCheck } from './research.mjs';

export const EVENT_TYPES = ['entity.create', 'entity.update', 'entity.archive', 'entity.restore',
  'decision.record', 'decision.verify', 'sim.run', 'memory.recall', 'system.note', 'belief.update', 'conversation.record', 'world.event', 'world.act', 'scenario.advance'];

export function emptyState() {
  return {
    seq: 0,
    entities: Object.fromEntries(KINDS.map(k => [k, {}])),
    decisions: [],
    simruns: [],
    recalls: [],
    beliefUpdates: [],
    conversations: [],
    worldEvents: [],
    actions: [],
    scenario: null,
    scenarios: {},
    notes: [],
    rejected: [],
  };
}

export function validateEvent(ev) {
  if (!ev || typeof ev !== 'object') throw new Error('Event must be an object');
  if (!Number.isInteger(ev.seq) || ev.seq < 1) throw new Error('Event seq must be a positive integer');
  if (!EVENT_TYPES.includes(ev.type)) throw new Error(`Unknown event type: ${ev.type}`);
  if (typeof ev.at !== 'string') throw new Error('Event needs an ISO timestamp');
  if (!ev.payload || typeof ev.payload !== 'object') throw new Error('Event needs a payload');
  return ev;
}

/** Pure: returns a new state. Invalid events are recorded in state.rejected, never thrown. */
export function apply(state, ev) {
  const s = { ...state, seq: ev.seq };
  const p = ev.payload;
  const reject = why => ({ ...s, rejected: [...state.rejected, { seq: ev.seq, type: ev.type, why }] });
  try {
    switch (ev.type) {
      case 'entity.create': {
        if (!KINDS.includes(p.kind)) return reject('unknown kind');
        if (!p.id || state.entities[p.kind][p.id]) return reject('missing or duplicate id');
        const data = normalize(p.kind, p.data);
        if (p.kind === 'inbox') {
          const gate = stageCheck(data, data.stage, data.stage);
          if (!gate.ok) return reject(`research stage ${data.stage}: ${gate.why.join('; ')}`);
          if (data.original) data.capturedAt = ev.at;
        }
        const ent = { id: p.id, kind: p.kind, ...data, createdAt: ev.at, updatedAt: ev.at, rev: 1, archived: false, sample: !!p.sample };
        return { ...s, entities: { ...state.entities, [p.kind]: { ...state.entities[p.kind], [p.id]: ent } } };
      }
      case 'entity.update': {
        const cur = state.entities[p.kind]?.[p.id];
        if (!cur) return reject('update of missing entity');
        const merged = normalize(p.kind, { ...cur, ...p.patch });
        if (p.kind === 'inbox') {
          // Originals are preserved: once captured, the text and its capture time never change.
          if (cur.original && merged.original !== cur.original) return reject('the captured original is preserved and cannot be edited');
          if (JSON.stringify(cur.file) !== JSON.stringify(merged.file)) return reject('imported file provenance is preserved and cannot be edited');
          merged.capturedAt = cur.original ? cur.capturedAt : (merged.original ? ev.at : '');
          const gate = stageCheck(merged, cur.stage, merged.stage);
          if (!gate.ok) return reject(`research stage ${merged.stage}: ${gate.why.join('; ')}`);
        }
        const ent = { ...cur, ...merged, updatedAt: ev.at, rev: cur.rev + 1 };
        return { ...s, entities: { ...state.entities, [p.kind]: { ...state.entities[p.kind], [p.id]: ent } } };
      }
      case 'entity.archive':
      case 'entity.restore': {
        const cur = state.entities[p.kind]?.[p.id];
        if (!cur) return reject('archive of missing entity');
        const ent = { ...cur, archived: ev.type === 'entity.archive', updatedAt: ev.at, rev: cur.rev + 1 };
        return { ...s, entities: { ...state.entities, [p.kind]: { ...state.entities[p.kind], [p.id]: ent } } };
      }
      case 'decision.record':
        return { ...s, decisions: [...state.decisions, { ...p, seq: ev.seq, at: ev.at, verifications: [] }] };
      case 'decision.verify': {
        const decisions = state.decisions.map(d => d.id === p.decisionId
          ? { ...d, verifications: [...d.verifications, { at: ev.at, ok: !!p.ok, detail: String(p.detail || '') }] } : d);
        return { ...s, decisions };
      }
      case 'sim.run':
        return { ...s, simruns: [...state.simruns, { ...p, seq: ev.seq, at: ev.at }] };
      case 'memory.recall': {
        const ch = state.entities.character[p.characterId];
        if (!ch) return reject('recall for missing character');
        const memories = ch.memories.map(m => m.id === p.memoryId ? { ...m, rehearsals: [...m.rehearsals, p.storyTime] } : m);
        const ent = { ...ch, memories, updatedAt: ev.at, rev: ch.rev + 1 };
        return { ...s, recalls: [...state.recalls, { ...p, seq: ev.seq, at: ev.at }],
          entities: { ...state.entities, character: { ...state.entities.character, [ch.id]: ent } } };
      }
      case 'belief.update': {
        const ch = state.entities.character[p.characterId];
        if (!ch) return reject('belief update for missing character');
        const ent = bump(withBelief(ch, p), ev);
        return { ...s, beliefUpdates: [...state.beliefUpdates, { ...p, seq: ev.seq, at: ev.at }], entities: putChar(state, ent) };
      }
      case 'conversation.record': {
        const sp = state.entities.character[p.speakerId], li = state.entities.character[p.listenerId];
        if (!sp || !li || sp.id === li.id) return reject('conversation needs two existing characters');
        if (!sp.memories.some(m => m.id === p.memoryId)) return reject('speaker does not hold that memory');
        if (li.memories.some(m => m.id === p.listenerMemory?.id)) return reject('already told at this story hour');
        // Retelling rehearses the speaker's trace; a slanted retelling also leaves a recollection trace.
        let spMem = sp.memories.map(m => m.id === p.memoryId ? { ...m, rehearsals: [...m.rehearsals, p.storyTime] } : m);
        if (p.speakerRecollection && !spMem.some(m => m.id === p.speakerRecollection.id)) spMem = [...spMem, p.speakerRecollection];
        const sp2 = bump({ ...sp, ...normalize('character', { ...sp, memories: spMem }) }, ev);
        let li2 = { ...li, ...normalize('character', { ...li, memories: [...li.memories, p.listenerMemory] }) };
        let beliefUpdates = state.beliefUpdates;
        if (p.beliefUpdate) { li2 = withBelief(li2, p.beliefUpdate); beliefUpdates = [...beliefUpdates, { ...p.beliefUpdate, seq: ev.seq, at: ev.at }]; }
        li2 = bump(li2, ev);
        return { ...s, beliefUpdates, conversations: [...state.conversations, { ...p, seq: ev.seq, at: ev.at }],
          entities: { ...state.entities, character: { ...state.entities.character, [sp2.id]: sp2, [li2.id]: li2 } } };
      }
      case 'world.event': {
        // Objective record. Truth stays here; each perceiver gets only their own channel's text.
        if (!p.id || state.worldEvents.some(w => w.id === p.id)) return reject('missing or duplicate world event id');
        let chars = state.entities.character;
        for (const pc of p.perceptions || []) {
          const ch = chars[pc.characterId];
          if (!ch) return reject('perception for missing character');
          if (ch.memories.some(m => m.id === pc.memory.id)) return reject('duplicate perception');
          chars = { ...chars, [ch.id]: bump({ ...ch, ...normalize('character', { ...ch, asleep: pc.woke ? false : ch.asleep, memories: [...ch.memories, pc.memory] }) }, ev) };
        }
        return { ...s, worldEvents: [...state.worldEvents, { ...p, seq: ev.seq, at: ev.at }], entities: { ...state.entities, character: chars } };
      }
      case 'world.act': {
        let chars = state.entities.character;
        const actor = chars[p.characterId];
        if (!actor) return reject('action by missing character');
        const fx = p.effects || {};
        const mems = fx.remember ? [...actor.memories, fx.remember] : actor.memories;
        if (fx.remember && actor.memories.some(m => m.id === fx.remember.id)) return reject('duplicate action memory');
        chars = { ...chars, [actor.id]: bump({ ...actor, ...normalize('character', { ...actor, place: fx.moveTo || actor.place, memories: mems }) }, ev) };
        for (const t of p.told || []) {
          const ch = chars[t.characterId];
          if (!ch) return reject('told a missing character');
          if (ch.memories.some(m => m.id === t.memory.id)) return reject('duplicate told memory');
          chars = { ...chars, [ch.id]: bump({ ...ch, ...normalize('character', { ...ch, asleep: t.woke ? false : ch.asleep, memories: [...ch.memories, t.memory] }) }, ev) };
        }
        const cur = state.scenarios?.[p.scenarioId];
        const scenarios = fx.setFacts && cur ? { ...state.scenarios, [cur.id]: { ...cur, facts: { ...cur.facts, ...fx.setFacts } } } : state.scenarios;
        const scenario = scenarios?.[state.scenario?.id] || state.scenario;
        return { ...s, scenario, scenarios, actions: [...state.actions, { ...p, seq: ev.seq, at: ev.at }], entities: { ...state.entities, character: chars } };
      }
      case 'scenario.advance': {
        const prev = state.scenarios?.[p.scenarioId] || null;
        if (prev && p.tick !== prev.tick + 1) return reject(`scenario tick ${p.tick} does not follow ${prev.tick}`);
        if (!prev && p.tick !== 1) return reject('scenario must start at tick 1');
        const sc = { id: p.scenarioId, tick: p.tick, storyTime: p.storyTime, clock: p.clock, status: p.status || 'PAUSED', facts: { ...(prev?.facts || p.facts || {}) } };
        const off = prev ? prev.seedOffset : p.seedOffset; // fixed by the first tick of the run
        if (off) sc.seedOffset = off;
        return { ...s, scenario: sc, scenarios: { ...(state.scenarios || {}), [sc.id]: sc } };
      }
      case 'system.note':
        return { ...s, notes: [...state.notes, { text: String(p.text || ''), seq: ev.seq, at: ev.at }] };
      default:
        return reject('unhandled type');
    }
  } catch (err) {
    return reject(err.message);
  }
}

const bump = (ent, ev) => ({ ...ent, updatedAt: ev.at, rev: ent.rev + 1 });
const putChar = (state, ent) => ({ ...state.entities, character: { ...state.entities.character, [ent.id]: ent } });
const claimKey = c => String(c || '').trim().toLowerCase();
function withBelief(ch, bu) {
  if (!claimKey(bu.claim) || !Number.isFinite(bu.after)) throw new Error('belief update needs a claim and a result');
  const hit = ch.beliefs.some(b => claimKey(b.claim) === claimKey(bu.claim));
  const beliefs = hit ? ch.beliefs.map(b => claimKey(b.claim) === claimKey(bu.claim) ? { ...b, confidence: bu.after } : b)
    : [...ch.beliefs, { claim: String(bu.claim).trim(), confidence: bu.after }];
  return { ...ch, ...normalize('character', { ...ch, beliefs }) };
}

export function replay(events) {
  let s = emptyState();
  for (const ev of events) s = apply(s, ev);
  return s;
}

export function makeEvent(seq, type, payload, at = new Date().toISOString()) {
  return validateEvent({ seq, type, at, payload: structuredClone(payload) });
}

export function liveList(state, kind) {
  return Object.values(state.entities[kind] || {}).filter(e => !e.archived)
    .sort((a, b) => (a.name || a.title || '').localeCompare(b.name || b.title || ''));
}

export function resolveRef(state, ref) {
  const [kind, id] = String(ref).split(':');
  return state.entities[kind]?.[id] || null;
}

export const EXPORT_FORMAT = 'anamnesis-os-export-v1';

/** originals (optional): [{ sha256, mime, size, name, base64 }] — exact bytes of imported files. */
export function buildExport(events, originals = []) {
  const out = { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), count: events.length, events };
  if (originals.length) out.originals = originals;
  return out;
}

export function parseExport(data) {
  if (!data || data.format !== EXPORT_FORMAT) throw new Error('Not an ANAMNESIS OS export');
  if (!Array.isArray(data.events)) throw new Error('Export has no events array');
  let prev = 0;
  for (const ev of data.events) {
    validateEvent(ev);
    if (ev.seq !== prev + 1) throw new Error(`Event sequence gap at ${ev.seq}`);
    prev = ev.seq;
  }
  return data.events;
}
