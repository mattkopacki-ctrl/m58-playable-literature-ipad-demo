// The Old House: five characters, one night, 02:13 to 02:20. Synthetic SAMPLE scenario
// following the owner's chat experiment (Mara, Daniel, Elise, Thomas, June). The cause
// of the knocking is deliberately left unknown; nothing here decides it.
const W = 'world-oldhouse';
const id = n => `oh-${n}`;
const ROOMS = ["Mara's room", "Daniel's room", "Elise's room", "Thomas's room", "June's room"];
const NEAR = ['Basement stairs', 'Kitchen', 'Front hall'];
const C = { basement: 'Something is in the basement', heating: 'The noises are just the heating', unsafe: 'The basement is not safe', deliberate: 'Someone in this house is doing this deliberately' };

const person = (key, name, role, summary, place, asleep, traits, values, goals, fears, beliefs, memories = []) =>
  ['entity.create', { kind: 'character', id: id(key), sample: true, data: { name, role, summary, worldId: W, place, asleep,
    traits: Object.fromEntries(['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'].map((t, i) => [t, traits[i]])),
    values: Object.fromEntries(['safety', 'truth', 'loyalty', 'ambition', 'freedom', 'compassion', 'control', 'belonging'].map((v, i) => [v, values[i]])),
    goals, fears, beliefs, memories } }];

export const OLD_HOUSE = {
  id: 'oldhouse', name: 'The Old House', worldId: W,
  cast: ['mara', 'daniel', 'elise', 'thomas', 'june'].map(id),
  t0: 2 + 13 / 60, maxTicks: 8,
  facts: { basementDoor: 'LOCKED', heating: 'ON', knockSource: 'UNKNOWN', residents: 5 },
  installEvents() {
    return [
      ['entity.create', { kind: 'world', id: W, sample: true, data: { name: 'The Old House (SAMPLE)', genre: 'Psychological horror / mystery',
        summary: 'Five residents. At 02:13 something knocks three times on the inside of the locked basement door.',
        rules: ['The source of the knocking is unknown and is not decided by the simulation.', 'The basement door is locked; only someone who knows where the key is can open it.',
          'A character knows only what they perceived or were told.'],
        places: ['Basement stairs', 'Kitchen', 'Front hall', 'Landing', ...ROOMS], tags: ['sample', 'old-house'] } }],
      person('mara', 'Mara Quill', 'Curiosity', 'Cannot leave a question alone. Reading on the landing when it starts.', 'Landing', false,
        [0.95, 0.4, 0.6, 0.5, 0.3], [0.2, 0.9, 0.4, 0.5, 0.7, 0.5, 0.3, 0.4],
        [{ text: 'Find out what is knocking', weight: 0.9, tags: ['truth', 'approach', 'novel'] }], [{ text: 'Being kept out of a secret', weight: 0.4, tags: ['solitude'] }],
        [{ claim: C.basement, confidence: 0.7 }]),
      person('daniel', 'Daniel Hale', 'Protection', 'Keeps the house and its people safe. Locked the basement himself.', "Daniel's room", false,
        [0.3, 0.8, 0.4, 0.7, 0.5], [0.9, 0.3, 0.8, 0.2, 0.2, 0.7, 0.8, 0.6],
        [{ text: 'Keep everyone away from the basement', weight: 0.9, tags: ['safety', 'control'] }], [{ text: 'Someone getting hurt down there', weight: 0.8, tags: ['basement'] }],
        [{ claim: C.unsafe, confidence: 0.9 }],
        [{ id: 'mem-oh-daniel-key', text: 'I locked the basement door myself and hid the key in the kitchen drawer', at: -30, tags: ['key', 'basement', 'secret'], valence: -0.2, arousal: 0.4, rehearsals: [-6] }]),
      person('elise', 'Elise Ward', 'Connection', 'Holds the group together. Fast asleep at 02:13.', "Elise's room", true,
        [0.5, 0.5, 0.8, 0.9, 0.5], [0.5, 0.4, 0.7, 0.2, 0.3, 0.8, 0.2, 0.9],
        [{ text: 'Keep the group together', weight: 0.8, tags: ['belonging', 'social', 'help'] }], [{ text: 'Being alone in this house', weight: 0.7, tags: ['solitude'] }], []),
      person('thomas', 'Thomas Reed', 'Skepticism', 'Wants the ordinary explanation. In the kitchen for water.', 'Kitchen', false,
        [0.4, 0.7, 0.4, 0.3, 0.15], [0.3, 0.8, 0.3, 0.5, 0.5, 0.3, 0.6, 0.2],
        [{ text: 'Find the ordinary cause', weight: 0.8, tags: ['truth', 'rule'] }], [{ text: 'Looking credulous', weight: 0.5, tags: ['social'] }],
        [{ claim: C.heating, confidence: 0.85 }]),
      person('june', 'June Ash', 'Distrust', 'Assumes she is being lied to. Awake in her room.', "June's room", false,
        [0.5, 0.6, 0.2, 0.15, 0.7], [0.7, 0.6, 0.2, 0.3, 0.5, 0.2, 0.8, 0.1],
        [{ text: 'Work out who is behind this', weight: 0.8, tags: ['control', 'truth'] }], [{ text: 'Being deceived', weight: 0.8, tags: ['social'] }],
        [{ claim: C.deliberate, confidence: 0.81 }]),
    ];
  },
  script: {
    1: [{ title: 'Three knocks', place: 'Basement stairs', valence: -0.6, arousal: 0.8,
      truth: 'Three knocks on the inner face of the locked basement door at 02:13. Source unknown.',
      channels: [
        { name: 'heard close', places: NEAR, wakes: true, text: 'Three slow knocks from inside the locked basement door', tags: ['knock', 'basement', 'sound', 'night'] },
        { name: 'heard faintly', places: ['Landing', ...ROOMS], wakes: false, text: 'A dull knocking somewhere downstairs', tags: ['knock', 'sound', 'night'], arousal: 0.5 },
      ] }],
    4: [{ title: 'One knock, softer', place: 'Basement stairs', valence: -0.6, arousal: 0.8,
      truth: 'A single softer knock on the inner face of the basement door at 02:16. The door moved against its latch. Source unknown.',
      channels: [
        { name: 'saw and heard', places: ['Basement stairs'], wakes: true, text: 'One soft knock, and the basement door moved against its latch. It is still locked.', tags: ['knock', 'basement', 'sight', 'sound', 'locked'], arousal: 0.9 },
        { name: 'heard close', places: ['Kitchen', 'Front hall'], wakes: true, text: 'A single knock from the basement door, softer than before', tags: ['knock', 'basement', 'sound', 'night'] },
        { name: 'heard faintly', places: ['Landing'], wakes: false, text: 'One more faint knock from below', tags: ['knock', 'sound', 'night'], arousal: 0.5 },
      ] }],
  },
  situation(world) {
    return { id: 'sit-oldhouse-now', prompt: 'It is the middle of the night in the old house. What do you do this minute?', tags: ['night'], world,
      options: [
        { id: 'opt-door', label: 'Go to the basement door', tags: ['risk', 'truth', 'approach', 'basement', 'novel'], beliefs: [{ claim: C.basement, sign: 1 }, { claim: C.unsafe, sign: -1 }],
          requires: { awake: true, knows: ['knock'], notPlaces: ['Basement stairs'] }, effects: { moveTo: 'Basement stairs' } },
        { id: 'opt-listen', label: 'Listen at the basement door', tags: ['truth', 'risk', 'basement'], beliefs: [{ claim: C.basement, sign: 1 }],
          requires: { awake: true, places: ['Basement stairs'], lacks: ['listened'] },
          effects: { remember: { text: 'I pressed my ear to the basement door. Something shifted on the other side, or the house settled.', tags: ['listened', 'basement', 'sound'], valence: -0.5, arousal: 0.7 } } },
        { id: 'opt-unlock', label: 'Unlock the basement door', tags: ['risk', 'truth', 'break-rule', 'approach', 'basement', '!safety', '!control'], beliefs: [{ claim: C.unsafe, sign: -1 }],
          requires: { awake: true, places: ['Basement stairs'], knows: ['key'] }, effects: { setFacts: { basementDoor: 'UNLOCKED' } } },
        { id: 'opt-heating', label: 'Switch the heating off and on to test it', tags: ['truth', 'rule'], beliefs: [{ claim: C.heating, sign: 1 }],
          requires: { awake: true, places: ['Kitchen'], knows: ['knock'], lacks: ['heating-test', 'heating'] },
          effects: { emits: { title: 'Heating test', place: 'Kitchen', valence: 0, arousal: 0.3,
            truth: 'The heating was switched off and on. No knocking occurred during the test. The test was too brief to show anything.',
            actorText: 'I switched the heating off and on. Nothing knocked while it was off. Too short a test to prove anything.', actorTags: ['heating-test', 'sound'],
            channels: [{ name: 'heard', places: NEAR, wakes: false, text: 'The pipes ticked as the heating went off and came back on', tags: ['heating', 'sound'], arousal: 0.2 }] } } },
        { id: 'opt-wake', label: 'Wake the others', tags: ['social', 'safety', 'belonging', 'help'],
          requires: { awake: true, knows: ['knock'], lacks: ['woke-others'], world: ['someoneAsleep'] },
          effects: { wakeWith: 'knock', remember: { text: 'I went round and woke whoever was still asleep', tags: ['woke-others'], valence: 0.1, arousal: 0.4 } } },
        { id: 'opt-tell', label: 'Tell whoever is here what I heard', tags: ['social', 'belonging', 'help'],
          requires: { awake: true, knows: ['knock'], lacks: ['told-here'] },
          effects: { tellHere: 'knock', remember: { text: 'I said out loud what I had heard', tags: ['told-here'], valence: 0, arousal: 0.3 } } },
        { id: 'opt-watch', label: 'Watch the others from the landing', tags: ['control', 'solitude'], beliefs: [{ claim: C.deliberate, sign: 1 }],
          requires: { awake: true, notPlaces: ['Landing'], lacks: ['watched'] },
          effects: { moveTo: 'Landing', remember: { text: 'I stood back on the landing to see who came and went', tags: ['watched'], valence: 0, arousal: 0.3 } } },
        { id: 'opt-stay', label: 'Stay put and listen', tags: ['safety', 'solitude'], beliefs: [{ claim: C.unsafe, sign: 1 }], requires: { awake: true } },
        { id: 'opt-sleep', label: 'Sleep on', tags: [], requires: { awake: false } },
      ] };
  },
};
