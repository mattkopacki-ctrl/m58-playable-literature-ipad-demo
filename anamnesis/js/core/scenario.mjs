// Scenario runner. Pure: given a state and a scenario it returns the events for one
// tick. Truth lives in world events; characters only ever receive their own perception.
// Status: SIMULATION TECHNIQUE.
import { apply, makeEvent } from './store.mjs';
import { decide, buildConversation } from './cognition.mjs';

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

export function scenarioStatus(state, scenario) {
  const sc = state.scenario?.id === scenario.id ? state.scenario : null;
  return { installed: scenario.cast.every(id => state.entities.character[id]), tick: sc?.tick || 0, done: (sc?.tick || 0) >= scenario.maxTicks,
    clock: sc ? sc.clock : clockOf(scenario.t0), facts: sc?.facts || scenario.facts };
}

/** One tick. Returns { events: [[type, payload]...], state } without touching storage. */
export function stepScenario(state, scenario) {
  const st = scenarioStatus(state, scenario);
  if (!st.installed) throw new Error(`${scenario.name} is not installed`);
  if (st.done) throw new Error(`${scenario.name} has reached its last tick (${clockOf(scenario.t0 + (scenario.maxTicks - 1) / 60)})`);
  const tick = st.tick + 1;
  const now = Math.round((scenario.t0 + (tick - 1) / 60) * 10000) / 10000;
  const events = [];
  let w = state;
  const push = (type, payload) => { events.push([type, payload]); w = apply(w, makeEvent(w.seq + 1, type, payload, '1970-01-01T00:00:00.000Z')); };

  push('scenario.advance', { scenarioId: scenario.id, tick, storyTime: now, clock: clockOf(now), status: 'PAUSED', facts: scenario.facts });

  // 1. Scripted world events for this tick.
  (scenario.script[tick] || []).forEach((tpl, i) => push('world.event', buildWorldEvent(tpl, { id: `we-${scenario.id}-t${tick}-${i + 1}`, storyTime: now, characters: castOf(w, scenario) })));

  // 2. Everyone decides on the same snapshot.
  const snapshot = castOf(w, scenario);
  const situation = scenario.situation({ someoneAsleep: snapshot.some(c => c.asleep) });
  const decisions = snapshot.map(ch => decide(ch, situation, { now, seed: tick }));
  push('sim.run', { id: `run-${scenario.id}-t${tick}`, scenarioId: scenario.id, tick, situation, now, seed: tick, decisions });

  // 3. Actions take effect in cast order.
  const emitted = [];
  for (const d of decisions) {
    const opt = situation.options.find(o => o.id === d.chosenOptionId);
    const fx = opt.effects || {};
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
    if (fx.emits) emitted.push([fx.emits, actor.id]);
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
  emitted.forEach(([tpl, actorId], i) => push('world.event', buildWorldEvent(tpl, { id: `we-${scenario.id}-t${tick}-a${i + 1}`, storyTime: now,
    characters: castOf(w, scenario), provenance: 'simulation', actor: w.entities.character[actorId] })));
  return { events, state: w, tick, clock: clockOf(now) };
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
