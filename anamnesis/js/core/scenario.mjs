// Scenario runner. Pure: given a state and a scenario it returns the events for one
// tick. Truth lives in world events; characters only ever receive their own perception.
// Status: SIMULATION TECHNIQUE.
import { apply, makeEvent } from './store.mjs';
import { decide, buildConversation, experienceUpdates, cleanMechanisms, anyMechanism } from './cognition.mjs';

export function clockOf(hours) {
  const m = Math.round(hours * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const castOf = (state, scenario) => scenario.cast.map(id => state.entities.character[id]).filter(Boolean);

/** Who perceives a world event, through which channel. First matching channel wins. */
export function perceive(template, eventId, storyTime, characters, actorId = null) {
  const out = [];
  for (const ch of characters) {
    if (ch.id === actorId) continue;
    const channel = (template.channels || []).find(c => c.places.includes(ch.place) && (!ch.asleep || c.wakes));
    if (!channel) continue;
    out.push({ characterId: ch.id, characterName: ch.name, channel: channel.name, text: channel.text, woke: !!(ch.asleep && channel.wakes),
      memory: { id: `mem-${eventId}-${ch.id}`, text: channel.text, at: storyTime, tags: channel.tags, valence: channel.valence ?? template.valence ?? 0,
        arousal: channel.arousal ?? template.arousal ?? 0.3, rehearsals: [], source: 'seen', from: '', originId: eventId } });
  }
  return out;
}

export function buildWorldEvent(template, { id, storyTime, characters, provenance = 'author', actor = null }) {
  const perceptions = perceive(template, id, storyTime, characters, actor?.id);
  if (actor && template.actorText) {
    perceptions.unshift({ characterId: actor.id, characterName: actor.name, channel: 'did it', text: template.actorText, woke: false,
      memory: { id: `mem-${id}-${actor.id}`, text: template.actorText, at: storyTime, tags: template.actorTags || [], valence: template.valence ?? 0,
        arousal: template.arousal ?? 0.3, rehearsals: [], source: 'seen', from: '', originId: id } });
  }
  return { id, storyTime, clock: clockOf(storyTime), place: template.place, title: template.title, truth: template.truth, provenance,
    causedBy: actor?.id || '', perceptions, notPerceivedBy: characters.filter(c => !perceptions.some(p => p.characterId === c.id)).map(c => c.id) };
}

/**
 * P3: which perceptions of a built world event carry authored evidence. Reads only the channel a
 * character perceived through (or the actor's own outcome) and never the event's truth.
 */
export function perceptionEvidence(template, worldEvent) {
  const out = [];
  for (const p of worldEvent.perceptions || []) {
    const evidence = p.characterId === worldEvent.causedBy && p.channel === 'did it' ? template.actorEvidence
      : (template.channels || []).find(c => c.name === p.channel && c.text === p.text)?.evidence;
    if (evidence?.length) out.push({ characterId: p.characterId, memoryId: p.memory.id, evidence });
  }
  return out;
}

// Authoring fields the engine must not see unless their switch is on. Stripping them keeps a run
// with both switches off byte-identical to builds that had no such fields.
function runtimeOptions(options, mech) {
  return options.map(o => {
    const { repeat, ...opt } = o;
    if (mech.repeatableActions && repeat) opt.repeat = repeat;
    if (!o.effects) return opt;
    const fx = { ...o.effects };
    if (fx.remember?.evidence) { const { evidence, ...rest } = fx.remember; fx.remember = rest; }
    if (fx.emits && (fx.emits.actorEvidence || fx.emits.channels?.some(c => c.evidence))) {
      const { actorEvidence, ...e } = fx.emits;
      fx.emits = { ...e, channels: (e.channels || []).map(({ evidence, ...c }) => c) };
    }
    return { ...opt, effects: fx };
  });
}

export function scenarioStatus(state, scenario) {
  const sc = state.scenarios?.[scenario.id] || null;
  return { installed: scenario.cast.every(id => state.entities.character[id]), tick: sc?.tick || 0, done: (sc?.tick || 0) >= scenario.maxTicks, seedOffset: sc?.seedOffset || 0,
    mechanisms: cleanMechanisms(sc?.mechanisms), clock: sc ? sc.clock : clockOf(scenario.t0), facts: sc?.facts || scenario.facts };
}

export const SEED_STRIDE = 100000; // larger than any tick count, so (offset, tick) pairs never collide
export const MAX_SEED_OFFSET = 9999;
/** Decision seed for a tick. Offset 0 is the original behaviour (seed = tick), so old runs replay unchanged. */
export function seedFor(tick, seedOffset = 0) { return tick + seedOffset * SEED_STRIDE; }
const cleanOffset = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(MAX_SEED_OFFSET, n)) : 0; };

/**
 * One tick. Returns { events: [[type, payload]...], state } without touching storage.
 * opts.seedOffset picks an independent set of dice for the whole run. It is fixed at tick 1
 * and read back from the run's own state afterwards, so it cannot change mid-run.
 *
 * Experimental mechanisms (OD-005) follow the same pinning, with one more rule: they are honoured
 * only when opts.sandbox is true, which only previewScenario sets. A live run never has them,
 * whatever the scenario says, and the store rejects such a run if one is ever offered to the log.
 */
export function stepScenario(state, scenario, opts = {}) {
  const st = scenarioStatus(state, scenario);
  if (!st.installed) throw new Error(`${scenario.name} is not installed`);
  if (st.done) throw new Error(`${scenario.name} has reached its last tick (${clockOf(scenario.t0 + (scenario.maxTicks - 1) / 60)})`);
  const tick = st.tick + 1;
  const seedOffset = tick === 1 ? cleanOffset(opts.seedOffset ?? scenario.seedOffset) : cleanOffset(state.scenarios?.[scenario.id]?.seedOffset);
  const seed = seedFor(tick, seedOffset);
  const sandbox = opts.sandbox === true;
  const mech = !sandbox ? cleanMechanisms(null) : tick === 1 ? cleanMechanisms(opts.mechanisms ?? scenario.mechanisms) : cleanMechanisms(state.scenarios?.[scenario.id]?.mechanisms);
  const on = anyMechanism(mech);
  const now = Math.round((scenario.t0 + (tick - 1) / 60) * 10000) / 10000;
  const events = [];
  let w = state;
  const push = (type, payload) => { events.push([type, payload]); w = apply(w, makeEvent(w.seq + 1, type, payload, '1970-01-01T00:00:00.000Z'), { sandbox }); };
  // P3 bookkeeping: claims already updated this minute per character, and evidence that changed nothing.
  const takenClaims = {}, evidenceSkipped = [];
  const applyEvidence = items => {
    if (!mech.experienceBeliefs || !items.length) return;
    for (const id of scenario.cast) {
      const mine = items.filter(it => it.characterId === id);
      const ch = w.entities.character[id];
      if (!mine.length || !ch) continue;
      const { updates, skipped } = experienceUpdates(ch, mine, takenClaims[id] || []);
      evidenceSkipped.push(...skipped);
      for (const u of updates) { (takenClaims[id] ||= []).push(u.claim); push('belief.update', { ...u, storyTime: now, scenarioId: scenario.id, tick }); }
    }
  };

  // seedOffset is written only when non-zero, so runs with the default dice produce byte-identical logs to earlier builds.
  push('scenario.advance', { scenarioId: scenario.id, tick, storyTime: now, clock: clockOf(now), status: 'PAUSED', facts: scenario.facts, ...(seedOffset ? { seedOffset } : {}), ...(on ? { mechanisms: mech } : {}) });

  // 0. Starting positions (authored scenarios), written as ordinary entity updates.
  if (tick === 1) for (const st0 of scenario.start || []) {
    const ch = w.entities.character[st0.characterId];
    if (ch && (ch.place !== st0.place || ch.asleep !== !!st0.asleep)) push('entity.update', { kind: 'character', id: ch.id, patch: { place: st0.place, asleep: !!st0.asleep }, scenarioId: scenario.id });
  }

  // 1. Scripted world events for this tick.
  const scriptedEvidence = [];
  (scenario.script[tick] || []).forEach((tpl, i) => {
    const we = buildWorldEvent(tpl, { id: `we-${scenario.id}-t${tick}-${i + 1}`, storyTime: now, characters: castOf(w, scenario) });
    push('world.event', we);
    scriptedEvidence.push(...perceptionEvidence(tpl, we));
  });
  // P3: what was just perceived updates held beliefs before anyone decides this minute.
  applyEvidence(scriptedEvidence);

  // 2. Everyone decides on the same snapshot.
  const snapshot = castOf(w, scenario);
  const occupancy = {};
  for (const c of snapshot) occupancy[c.place] = (occupancy[c.place] || 0) + 1;
  const facts = w.scenarios?.[scenario.id]?.facts || scenario.facts || {};
  const factFlags = Object.fromEntries(Object.entries(facts).map(([k, v]) => [`${k}=${v}`, true]));
  const authored = scenario.situation({ someoneAsleep: snapshot.some(c => c.asleep), occupancy, ...factFlags });
  const situation = { ...authored, options: runtimeOptions(authored.options, mech), ...(on ? { mechanisms: mech } : {}) };
  const actionEvidence = [];
  const decisions = [], idle = [];
  for (const ch of snapshot) {
    try { decisions.push(decide(ch, situation, { now, seed })); }
    catch (err) { idle.push({ characterId: ch.id, characterName: ch.name, why: err.message }); }
  }
  push('sim.run', { id: `run-${scenario.id}-t${tick}`, scenarioId: scenario.id, tick, situation, now, seed, decisions, idle });
  for (const i of idle) push('world.act', { id: `act-${scenario.id}-t${tick}-${i.characterId}`, scenarioId: scenario.id, tick, characterId: i.characterId, characterName: i.characterName,
    storyTime: now, optionId: '', label: '(no feasible action)', why: i.why, from: w.entities.character[i.characterId].place, to: w.entities.character[i.characterId].place, effects: {}, told: [] });

  // 3. Actions take effect in cast order.
  const emitted = [];
  for (const d of decisions) {
    const opt = situation.options.find(o => o.id === d.chosenOptionId);
    const fx = opt.effects || {};
    const src = authored.options.find(o => o.id === opt.id).effects || {}; // authoring copy: the only place evidence lives
    const actor = w.entities.character[d.characterId];
    const actId = `act-${scenario.id}-t${tick}-${actor.id}`;
    const effects = {};
    if (fx.moveTo && fx.moveTo !== actor.place) effects.moveTo = fx.moveTo;
    if (fx.setFacts) effects.setFacts = fx.setFacts;
    if (fx.remember) effects.remember = { id: `mem-${actId}`, at: now, rehearsals: [], source: 'seen', from: '', originId: actId, valence: 0, arousal: 0.3, ...fx.remember };
    const told = [];
    if (fx.wakeWith) {
      const mem = [...actor.memories].reverse().find(m => m.tags.includes(fx.wakeWith));
      for (const other of castOf(w, scenario).filter(c => c.asleep && c.id !== actor.id)) {
        const text = `${actor.name} woke me${mem ? ` and said: “${mem.text}”` : ''}`;
        told.push({ characterId: other.id, characterName: other.name, woke: true,
          memory: { id: `mem-${actId}-${other.id}`, text, at: now, tags: mem ? mem.tags : ['woken'], valence: -0.3, arousal: 0.6, rehearsals: [], source: 'told', from: actor.id, originId: mem?.id || '' } });
      }
    }
    push('world.act', { id: actId, scenarioId: scenario.id, tick, characterId: actor.id, characterName: actor.name, storyTime: now, optionId: opt.id, label: opt.label,
      from: actor.place, to: effects.moveTo || actor.place, effects, told });
    if (effects.remember && src.remember?.evidence?.length) actionEvidence.push({ characterId: actor.id, memoryId: effects.remember.id, evidence: src.remember.evidence });
    if (fx.emits) emitted.push([fx.emits, actor.id, src.emits]);
    if (fx.tellHere) {
      const me = w.entities.character[actor.id];
      const mem = [...me.memories].reverse().find(m => m.tags.includes(fx.tellHere) && m.source !== 'told');
      for (const other of castOf(w, scenario).filter(c => c.id !== me.id && !c.asleep && c.place === me.place)) {
        if (!mem) break;
        try { push('conversation.record', { ...buildConversation(w.entities.character[me.id], other, mem.id, { now, cues: mem.tags }), scenarioId: scenario.id, tick }); } catch { /* cannot recall or already told: no conversation */ }
      }
    }
  }
  // 4. Consequences of actions are perceived from where people now are.
  emitted.forEach(([tpl, actorId, srcTpl], i) => {
    const we = buildWorldEvent(tpl, { id: `we-${scenario.id}-t${tick}-a${i + 1}`, storyTime: now, characters: castOf(w, scenario), provenance: 'simulation', actor: w.entities.character[actorId] });
    push('world.event', we);
    actionEvidence.push(...perceptionEvidence(srcTpl, we));
  });
  // P3: what people did and what their actions caused arrives after everyone has decided, so it shapes the next minute.
  applyEvidence(actionEvidence);
  return { events, state: w, tick, clock: clockOf(now), mechanisms: mech, evidenceSkipped };
}

/** What one character knows: their place, state, beliefs and memories with sources. Never world truth. */
export function inspectCharacter(state, id) {
  const ch = state.entities.character[id];
  if (!ch) return null;
  const last = [...state.actions].reverse().find(a => a.characterId === id);
  return { id, name: ch.name, place: ch.place, asleep: ch.asleep, lastAction: last ? `${last.label} (${clockOf(last.storyTime)})` : '—',
    beliefs: ch.beliefs, memories: ch.memories.map(m => ({ text: m.text, at: m.at, source: m.source, from: state.entities.character[m.from]?.name || '', originId: m.originId })) };
}

/** Knowledge matrix: for each world event, what each cast member holds about it and how. */
export function knowledgeMatrix(state, scenario) {
  const cast = castOf(state, scenario);
  return state.worldEvents.filter(e => e.id.startsWith(`we-${scenario.id}-`)).map(e => ({ event: e,
    cells: cast.map(ch => {
      const own = ch.memories.find(m => m.originId === e.id);
      if (own) return { how: e.causedBy === ch.id ? 'did it' : 'perceived', text: own.text };
      const direct = new Set(cast.flatMap(c => c.memories.filter(m => m.originId === e.id).map(m => m.id)));
      const heard = ch.memories.find(m => m.source === 'told' && direct.has(m.originId));
      return heard ? { how: `told by ${state.entities.character[heard.from]?.name || '?'}`, text: heard.text } : { how: 'unaware', text: '' };
    }) }));
}

/**
 * Run ticks in memory only. Nothing is written; the caller's state is untouched.
 * This is the only caller that sets sandbox, i.e. the only way an experimental mechanism can run.
 */
export function previewScenario(state, scenario, ticks, opts = {}) {
  opts = { ...opts, sandbox: true };
  let s = state;
  const out = [];
  for (let i = 0; i < ticks; i++) {
    if (scenarioStatus(s, scenario).done) break;
    const r = stepScenario(s, scenario, opts);
    s = r.state;
    out.push({ clock: r.clock, tick: r.tick, events: r.events, mechanisms: r.mechanisms, evidenceSkipped: r.evidenceSkipped,
      beliefUpdates: r.events.filter(e => e[0] === 'belief.update').map(e => e[1]),
      places: scenario.cast.map(id => s.entities.character[id]?.place || ''),
      beliefs: Object.fromEntries(scenario.cast.map(id => [id, Object.fromEntries((s.entities.character[id]?.beliefs || []).map(b => [b.claim, b.confidence]))])),
      actions: r.events.filter(e => e[0] === 'world.act').map(e => e[1]),
      worldEvents: r.events.filter(e => e[0] === 'world.event').map(e => e[1]),
      conversations: r.events.filter(e => e[0] === 'conversation.record').map(e => e[1]) });
  }
  return { ticks: out, state: s };
}
