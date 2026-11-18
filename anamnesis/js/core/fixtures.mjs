// SYNTHETIC TEST FIXTURES for the experimental mechanisms P1 and P3 (OD-005).
//
// These are NOT approved story content. They exist so the acceptance criteria in doc 13 can be
// run at all: those criteria were written against trial declarations (doc 12 §1.7 and §2.8) that
// the owner has not approved (Decision Register Q-017 is open). The fixture copies the built-in
// Old House unchanged and adds those trial declarations on top. The Old House itself
// (oldhouse.mjs) is not modified and gains no repeat or evidence fields.
//
// A fixture can only be used by in-memory comparisons. It keeps the Old House's run id and cast,
// so with both switches off it produces exactly the Old House's log.
import { OLD_HOUSE } from './oldhouse.mjs';

export const FIXTURE_LABEL = 'SYNTHETIC TEST FIXTURE · not approved authoring';
const HEATING = 'The noises are just the heating', BASEMENT = 'Something is in the basement';

// doc 12 §1.7 (trial values)
const REPEAT = {
  'opt-listen': { tag: 'listened', cooldown: 2, maxUses: 3, reopenOn: ['knock'] },
  'opt-tell': { tag: 'told-here', cooldown: 3, maxUses: 2, reopenOn: ['knock'] },
  'opt-watch': { tag: 'watched', cooldown: 3, maxUses: 2 },
};
// doc 12 §2.8 (trial values). Evidence sits on what a character perceives, never on the event's truth.
const KNOCK2 = {
  'saw and heard': [{ claim: HEATING, direction: -1, strength: 0.7 }, { claim: BASEMENT, direction: 1, strength: 0.6 }],
  'heard close': [{ claim: HEATING, direction: -1, strength: 0.4 }, { claim: BASEMENT, direction: 1, strength: 0.3 }],
};
const LISTEN = [{ claim: BASEMENT, direction: 1, strength: 0.3 }];
const HEATING_TEST = [{ claim: HEATING, direction: 1, strength: 0.1 }];

function build(key, name, mechanisms) {
  return {
    ...OLD_HOUSE, key, name, fixture: true, fixtureLabel: FIXTURE_LABEL, mechanisms,
    repeatOptions: REPEAT,
    // Gate G5 (doc 13): things that must not happen in any run.
    mustNot: [
      { id: 'daniel-unlocks', label: 'Daniel unlocks the basement door', optionId: 'opt-unlock', characterId: 'oh-daniel' },
      { id: 'other-unlocks', label: 'Someone other than Daniel unlocks the basement door', optionId: 'opt-unlock', notCharacterId: 'oh-daniel' },
    ],
    script: { ...OLD_HOUSE.script, 4: OLD_HOUSE.script[4].map(e => ({ ...e, channels: e.channels.map(c => (KNOCK2[c.name] ? { ...c, evidence: KNOCK2[c.name] } : c)) })) },
    situation(world) {
      const s = OLD_HOUSE.situation(world);
      return { ...s, options: s.options.map(o => {
        const out = REPEAT[o.id] ? { ...o, repeat: REPEAT[o.id] } : { ...o };
        if (o.id === 'opt-listen') out.effects = { ...o.effects, remember: { ...o.effects.remember, evidence: LISTEN } };
        if (o.id === 'opt-heating') out.effects = { ...o.effects, emits: { ...o.effects.emits, actorEvidence: HEATING_TEST } };
        return out;
      }) };
    },
  };
}

const OFF = { repeatableActions: false, experienceBeliefs: false };
export const FIXTURES = {
  'fixture:oldhouse-p1p3': build('fixture:oldhouse-p1p3', `${FIXTURE_LABEL} · Old House + trial P1/P3 declarations`, OFF),
  // For the independence comparisons (doc 12 §3, C-P1×P3): one switch already on in every variant.
  'fixture:oldhouse-p1p3+p3': build('fixture:oldhouse-p1p3+p3', `${FIXTURE_LABEL} · same, experience-driven beliefs held on`, { ...OFF, experienceBeliefs: true }),
  'fixture:oldhouse-p1p3+p1': build('fixture:oldhouse-p1p3+p1', `${FIXTURE_LABEL} · same, repeatable actions held on`, { ...OFF, repeatableActions: true }),
};
