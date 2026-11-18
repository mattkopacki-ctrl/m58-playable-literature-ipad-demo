// Scenario Studio: turns an authored scenario entity into the object the runner uses,
// and checks it first. Pure. Nothing here writes to the log.
import { clockOf } from './scenario.mjs';
import { REPEAT_LIMITS } from './cognition.mjs';

const hours = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h + m / 60; };
const KNOWN_FLAGS = ['someoneAsleep'];

/** Validate and compile. Returns { errors, warnings, scenario } (scenario is null when there are errors). */
export function compileScenario(ent, state) {
  const errors = [], warnings = [];
  const world = state.entities.world[ent.worldId];
  if (!ent.worldId || !world) errors.push('Choose a world.');
  else if (world.archived) errors.push(`World "${world.name}" is archived.`);
  const places = world?.places || [];
  if (world && !places.length) errors.push(`World "${world.name}" has no places. Add places in Worlds.`);
  const known = p => places.includes(p);
  const where = (label, list) => { for (const p of list) if (!known(p)) errors.push(`${label}: "${p}" is not a place in this world.`); };

  if (!ent.cast.length) errors.push('Add at least one character to the cast.');
  const seen = new Set();
  for (const c of ent.cast) {
    const ch = state.entities.character[c.characterId];
    if (!ch || ch.archived) errors.push(`Cast member ${c.characterId} does not exist or is archived.`);
    if (seen.has(c.characterId)) errors.push(`${ch?.name || c.characterId} is in the cast twice.`);
    seen.add(c.characterId);
    if (!c.place) errors.push(`${ch?.name || c.characterId} needs a starting place.`);
    else where(`${ch?.name || c.characterId}'s starting place`, [c.place]);
  }
  const keys = ent.facts.map(f => f.key);
  if (new Set(keys).size !== keys.length) warnings.push('Two facts share a key; the later one wins.');

  ent.events.forEach((e, i) => {
    const n = `World event ${i + 1} (${e.title})`;
    if (e.minute > ent.ticks) errors.push(`${n} is at minute ${e.minute}, after the last minute (${ent.ticks}).`);
    if (e.place) where(n, [e.place]);
    if (!e.truth.trim()) warnings.push(`${n} has no truth text; the author view will be empty.`);
    if (!e.channels.length) warnings.push(`${n} has no perception channels, so nobody will notice it.`);
    e.channels.forEach((c, j) => {
      if (!c.places.length) errors.push(`${n}, channel ${j + 1}: choose where it can be perceived.`);
      where(`${n}, channel ${j + 1}`, c.places);
      if (!c.text.trim()) errors.push(`${n}, channel ${j + 1}: write what a character perceives there.`);
    });
  });

  if (!ent.options.length) errors.push('Add at least one action option.');
  ent.options.forEach((o, i) => {
    const n = `Option ${i + 1} (${o.label})`;
    where(n + ' "only at"', o.requires.places);
    where(n + ' "not at"', o.requires.notPlaces);
    if (o.effects.moveTo) where(n + ' "move to"', [o.effects.moveTo]);
    for (const f of o.requires.world) if (!KNOWN_FLAGS.includes(f) && !/^[^=]+=.+$/.test(f)) errors.push(`${n}: condition "${f}" must be someoneAsleep or fact=value.`);
    for (const f of o.requires.world) if (/^[^=]+=.+$/.test(f) && !keys.includes(f.split('=')[0]) && !ent.options.some(x => x.effects.setFacts.some(s => s.key === f.split('=')[0])))
      warnings.push(`${n}: condition "${f}" refers to a fact that is never set.`);
    if (o.effects.emits) {
      if (o.effects.emits.place) where(n + ' world event', [o.effects.emits.place]);
      o.effects.emits.channels.forEach((c, j) => { where(`${n} world event, channel ${j + 1}`, c.places); if (!c.text.trim()) errors.push(`${n} world event, channel ${j + 1}: write what is perceived.`); });
    }
    if (o.effects.wakeWith && !o.requires.world.includes('someoneAsleep')) warnings.push(`${n}: wakes people but does not require someoneAsleep, so it can be chosen when no one is asleep.`);
    if (o.effects.tellHere && !o.requires.company) warnings.push(`${n}: tells people here but does not require company, so it can be chosen alone.`);
  });
  // Experimental mechanisms (OD-005). The declarations are inert in a live run; they are still checked.
  const written = new Set([...ent.events.flatMap(e => e.channels.flatMap(c => c.tags)),
    ...ent.options.flatMap(o => [...o.effects.remember.tags, ...(o.effects.emits ? [...o.effects.emits.actorTags, ...o.effects.emits.channels.flatMap(c => c.tags)] : [])])]);
  const cast = ent.cast.map(c => state.entities.character[c.characterId]).filter(Boolean);
  const heldBySomeone = claim => cast.some(ch => ch.beliefs.some(b => b.claim.trim().toLowerCase() === claim.trim().toLowerCase()));
  const checkEvidence = (label, list) => { for (const e of list || []) if (!heldBySomeone(e.claim)) warnings.push(`${label}: evidence about "${e.claim}" will do nothing, because no cast member holds that belief (experience never creates a belief).`); };
  ent.events.forEach((e, i) => e.channels.forEach((c, j) => checkEvidence(`World event ${i + 1} (${e.title}), channel ${j + 1}`, c.evidence)));
  ent.options.forEach((o, i) => {
    const n = `Option ${i + 1} (${o.label})`;
    checkEvidence(`${n} own outcome`, o.effects.remember.evidence);
    if (o.effects.remember.evidence?.length && !o.effects.remember.text.trim()) errors.push(`${n}: evidence on the action's own outcome needs the "remember" text the character takes away.`);
    if (o.effects.emits) { checkEvidence(`${n} world event, own outcome`, o.effects.emits.actorEvidence); o.effects.emits.channels.forEach((c, j) => checkEvidence(`${n} world event, channel ${j + 1}`, c.evidence));
      if (o.effects.emits.actorEvidence?.length && !o.effects.emits.actorText.trim()) errors.push(`${n}: evidence on the actor's outcome needs the actor's outcome text.`); }
    const r = o.repeat;
    if (!r) return;
    if (!o.effects.remember.text.trim() || !o.effects.remember.tags.includes(r.tag)) errors.push(`${n}: repeat tag "${r.tag}" must be one of the tags the option writes in "remember", so uses can be counted.`);
    if (!o.requires.lacks.includes(r.tag)) errors.push(`${n}: repeat tag "${r.tag}" must also be listed under "not yet done", so the option stays once-only whenever the switch is off.`);
    if (r.cooldown < REPEAT_LIMITS.cooldown[0] || r.cooldown > REPEAT_LIMITS.cooldown[1]) errors.push(`${n}: repeat cooldown must be ${REPEAT_LIMITS.cooldown[0]} to ${REPEAT_LIMITS.cooldown[1]} minutes (it is ${r.cooldown}).`);
    if (r.maxUses < REPEAT_LIMITS.maxUses[0] || r.maxUses > REPEAT_LIMITS.maxUses[1]) errors.push(`${n}: repeat needs a use cap of ${REPEAT_LIMITS.maxUses[0]} to ${REPEAT_LIMITS.maxUses[1]} (it is ${r.maxUses}). There is no unlimited setting.`);
    for (const t of r.reopenOn || []) if (!written.has(t)) warnings.push(`${n}: reopens on "${t}", but no world event or action ever writes that tag, so it can never be repeated.`);
  });
  if (ent.mechanisms && !ent.options.some(o => o.repeat) && ent.mechanisms.repeatableActions) warnings.push('Repeatable actions is switched on for Preview, but no option declares a repeat rule; it will change nothing.');
  if (ent.cast.some(c => c.asleep) && !ent.options.some(o => o.requires.awake !== 'awake'))
    errors.push('Someone starts asleep, but every option needs the character awake. Add an option for sleepers (for example "Sleep on", available: asleep).');
  if (!ent.options.some(o => o.requires.awake !== 'asleep' && !o.requires.places.length && !o.requires.notPlaces.length && !o.requires.knows.length && !o.requires.lacks.length && !o.requires.company && !o.requires.world.length))
    warnings.push('No option is always available to an awake character; someone may end up with no possible action in some minute.');

  if (errors.length) return { errors, warnings, scenario: null };
  return { errors, warnings, scenario: runtime(ent) };
}

function req(r) {
  const out = {};
  if (r.awake === 'awake') out.awake = true;
  if (r.awake === 'asleep') out.awake = false;
  for (const k of ['places', 'notPlaces', 'knows', 'lacks', 'world']) if (r[k].length) out[k] = r[k];
  if (r.company) out.company = true;
  return Object.keys(out).length ? out : undefined;
}
const chans = list => list.map(c => { const o = { name: c.name, places: c.places, wakes: c.wakes, text: c.text, tags: c.tags }; if (c.valence != null) o.valence = c.valence; if (c.arousal != null) o.arousal = c.arousal; if (c.evidence?.length) o.evidence = c.evidence; return o; });
const tpl = e => ({ title: e.title, place: e.place, truth: e.truth, valence: e.valence, arousal: e.arousal, channels: chans(e.channels) });

function runtime(ent) {
  const script = {};
  for (const e of ent.events) (script[e.minute] ||= []).push(tpl(e));
  const options = ent.options.map(o => {
    const fx = {};
    if (o.effects.moveTo) fx.moveTo = o.effects.moveTo;
    if (o.effects.remember.text.trim()) fx.remember = { ...o.effects.remember };
    if (o.effects.wakeWith) fx.wakeWith = o.effects.wakeWith;
    if (o.effects.tellHere) fx.tellHere = o.effects.tellHere;
    if (o.effects.setFacts.length) fx.setFacts = Object.fromEntries(o.effects.setFacts.map(f => [f.key, f.value]));
    if (o.effects.emits) fx.emits = { ...tpl(o.effects.emits), actorText: o.effects.emits.actorText, actorTags: o.effects.emits.actorTags, ...(o.effects.emits.actorEvidence?.length ? { actorEvidence: o.effects.emits.actorEvidence } : {}) };
    const opt = { id: o.id, label: o.label, tags: o.tags };
    if (o.repeat) opt.repeat = o.repeat;
    if (o.beliefs.length) opt.beliefs = o.beliefs;
    const r = req(o.requires); if (r) opt.requires = r;
    if (Object.keys(fx).length) opt.effects = fx;
    return opt;
  });
  const situationId = ent.situationId || `sit-${ent.id}`;
  return { id: ent.id, name: ent.name, worldId: ent.worldId, authored: true, cast: ent.cast.map(c => c.characterId),
    start: ent.cast.map(c => ({ characterId: c.characterId, place: c.place, asleep: c.asleep })),
    t0: hours(ent.start), maxTicks: ent.ticks, seedOffset: ent.seedOffset || 0, ...(ent.mechanisms ? { mechanisms: ent.mechanisms } : {}), facts: Object.fromEntries(ent.facts.map(f => [f.key, f.value])), script,
    situation: world => ({ id: situationId, prompt: ent.prompt, tags: ent.tags, world, options: structuredClone(options) }) };
}

/** Authoring data equivalent to a built-in scenario (used for "Make an editable copy"). */
export function scenarioDataFromBuiltIn(sc) {
  const install = Object.fromEntries(sc.installEvents().filter(([t, p]) => t === 'entity.create' && p.kind === 'character').map(([, p]) => [p.id, p.data]));
  const sit = sc.situation({});
  const ch = c => ({ name: c.name, places: c.places, wakes: !!c.wakes, text: c.text, tags: c.tags, valence: c.valence ?? null, arousal: c.arousal ?? null, ...(c.evidence?.length ? { evidence: c.evidence } : {}) });
  const ev = t => ({ title: t.title, place: t.place, truth: t.truth, valence: t.valence ?? 0, arousal: t.arousal ?? 0.5, channels: t.channels.map(ch) });
  const kvs = o => Object.entries(o || {}).map(([key, value]) => ({ key, value: String(value) }));
  return {
    name: `${sc.name} (editable copy)`, worldId: sc.worldId, prompt: sit.prompt, tags: sit.tags, start: clockOf(sc.t0), ticks: sc.maxTicks,
    situationId: sit.id, facts: kvs(sc.facts), ...((sc.mechanisms?.repeatableActions || sc.mechanisms?.experienceBeliefs) ? { mechanisms: sc.mechanisms } : {}),
    cast: sc.cast.map(id => ({ characterId: id, place: install[id]?.place || '', asleep: !!install[id]?.asleep })),
    events: Object.entries(sc.script).flatMap(([minute, list]) => list.map((t, i) => ({ id: `ev-${minute}-${i + 1}`, minute: Number(minute), ...ev(t) }))),
    options: sit.options.map(o => ({ id: o.id, label: o.label, tags: o.tags, beliefs: o.beliefs || [], ...(o.repeat ? { repeat: o.repeat } : {}),
      requires: { awake: o.requires?.awake === true ? 'awake' : o.requires?.awake === false ? 'asleep' : 'any', places: o.requires?.places || [], notPlaces: o.requires?.notPlaces || [],
        knows: o.requires?.knows || [], lacks: o.requires?.lacks || [], company: !!o.requires?.company, world: o.requires?.world || [] },
      effects: { moveTo: o.effects?.moveTo || '', remember: o.effects?.remember ? { ...o.effects.remember } : { text: '', tags: [] }, wakeWith: o.effects?.wakeWith || '',
        tellHere: o.effects?.tellHere || '', setFacts: kvs(o.effects?.setFacts),
        emits: o.effects?.emits ? { ...ev(o.effects.emits), actorText: o.effects.emits.actorText || '', actorTags: o.effects.emits.actorTags || [],
          ...(o.effects.emits.actorEvidence?.length ? { actorEvidence: o.effects.emits.actorEvidence } : {}) } : null } })),
  };
}
