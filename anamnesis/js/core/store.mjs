// Append-only event log + pure reducer. State is always a replay of the log, so
// nothing is edited in place and every change is traceable (NUE-CR-001 rule 2).
import { KINDS, normalize } from './schema.mjs';

export const EVENT_TYPES = ['entity.create', 'entity.update', 'entity.archive', 'entity.restore',
  'decision.record', 'decision.verify', 'sim.run', 'memory.recall', 'system.note'];

export function emptyState() {
  return {
    seq: 0,
    entities: Object.fromEntries(KINDS.map(k => [k, {}])),
    decisions: [],
    simruns: [],
    recalls: [],
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
        const ent = { id: p.id, kind: p.kind, ...normalize(p.kind, p.data), createdAt: ev.at, updatedAt: ev.at, rev: 1, archived: false, sample: !!p.sample };
        return { ...s, entities: { ...state.entities, [p.kind]: { ...state.entities[p.kind], [p.id]: ent } } };
      }
      case 'entity.update': {
        const cur = state.entities[p.kind]?.[p.id];
        if (!cur) return reject('update of missing entity');
        const merged = normalize(p.kind, { ...cur, ...p.patch });
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
      case 'system.note':
        return { ...s, notes: [...state.notes, { text: String(p.text || ''), seq: ev.seq, at: ev.at }] };
      default:
        return reject('unhandled type');
    }
  } catch (err) {
    return reject(err.message);
  }
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

export function buildExport(events) {
  return { format: EXPORT_FORMAT, exportedAt: new Date().toISOString(), count: events.length, events };
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
