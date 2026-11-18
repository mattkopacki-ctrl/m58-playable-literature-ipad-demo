// Synthetic sample project. Everything here is labelled SAMPLE and is not canon.

export const SITUATIONS = [
  {
    id: 'sit-cellar-door', prompt: '03:00 — the cellar door opens on its own. What do you do?',
    tags: ['night', 'cellar', 'dark', 'sound'],
    options: [
      { id: 'opt-1', label: 'Go down with a lamp', tags: ['risk', 'truth', 'approach', 'cellar', 'novel'] },
      { id: 'opt-2', label: 'Wake the others', tags: ['social', 'safety', 'belonging', 'help'] },
      { id: 'opt-3', label: 'Lock the door and stay in bed', tags: ['safety', 'solitude', '!truth', 'flee'] },
    ],
  },
  {
    id: 'sit-letter', prompt: 'You find a letter addressed to someone else in the house. It is unsealed.',
    tags: ['secret', 'letter', 'privacy'],
    options: [
      { id: 'opt-1', label: 'Read it', tags: ['truth', 'break-rule', '!loyalty', 'control'] },
      { id: 'opt-2', label: 'Hand it to its owner', tags: ['loyalty', 'rule', 'help', 'social'] },
      { id: 'opt-3', label: 'Burn it', tags: ['control', 'safety', '!truth', 'risk'] },
    ],
  },
  {
    id: 'sit-accusation', prompt: 'At breakfast, someone claims you were in the hall last night.',
    tags: ['accusation', 'social', 'blame'],
    options: [
      { id: 'opt-1', label: 'Deny it flatly', tags: ['control', 'confront', '!truth'] },
      { id: 'opt-2', label: 'Admit you cannot remember', tags: ['truth', '!control', 'belonging'] },
      { id: 'opt-3', label: 'Turn the question back on them', tags: ['confront', 'control', 'risk'] },
    ],
  },
];

export function seedEvents() {
  const W = 'world-harrow', I = 'character-ines', T = 'character-theo', D = 'character-daniel';
  const TH1 = 'theme-unreliable', TH2 = 'theme-house';
  return [
    ['entity.create', { kind: 'world', id: W, sample: true, data: {
      name: 'Harrow House (SAMPLE)', genre: 'Psychological horror / mystery',
      summary: 'Five guests spend one week in a shuttered coastal house. Something in the cellar keeps time.',
      rules: ['No supernatural event is confirmed in-world before Day 5.', 'All clocks in the house stop at 03:00.'],
      places: ['Front hall', 'Landing', 'Cellar', 'Kitchen', 'Seawall'], tags: ['sample', 'one-week'] } }],
    ['entity.create', { kind: 'theme', id: TH1, sample: true, data: {
      name: 'Memory is rebuilt, not replayed', statement: 'Each retelling changes what the teller believes happened.',
      question: 'Whose version of the night survives the week?', motifs: ['clocks', 'retelling', 'mirrors'] } }],
    ['entity.create', { kind: 'theme', id: TH2, sample: true, data: {
      name: 'The house as witness', statement: 'Places hold cues that people do not know they carry.',
      question: 'What does the stairwell remember?', motifs: ['stairs', 'doors', 'salt'] } }],
    ['entity.create', { kind: 'character', id: I, sample: true, data: {
      name: 'Ines Varga', role: 'Anxious archivist', worldId: W,
      summary: 'Already believes the house is wrong. Hears more than she sees.',
      traits: { openness: 0.7, conscientiousness: 0.8, extraversion: 0.3, agreeableness: 0.7, neuroticism: 0.85 },
      values: { safety: 0.9, truth: 0.6, loyalty: 0.6, ambition: 0.2, freedom: 0.3, compassion: 0.7, control: 0.5, belonging: 0.6 },
      goals: [{ text: 'Leave the house safely at week end', weight: 0.9, tags: ['safety', 'flee'] },
        { text: 'Prove she is not imagining things', weight: 0.6, tags: ['truth'] }],
      fears: [{ text: 'Enclosed dark spaces', weight: 0.9, tags: ['cellar', 'dark'] }],
      beliefs: [{ claim: 'The house is wrong', confidence: 0.8 }],
      memories: [{ id: 'mem-ines-1', text: 'Locked in a records basement as a child', at: -20000, tags: ['cellar', 'dark', 'locked'], valence: -0.9, arousal: 0.9, rehearsals: [-15000, -2000, -50] },
        { id: 'mem-ines-2', text: 'Heard the cellar door open at 03:00 on the second night', at: 27, tags: ['cellar', 'dark', 'sound', 'night'], valence: -0.7, arousal: 0.8, rehearsals: [] }],
    } }],
    ['entity.create', { kind: 'character', id: T, sample: true, data: {
      name: 'Theo Marsh', role: 'Skeptical engineer', worldId: W,
      summary: 'Explains everything. Sees a tall figure on the landing and decides it was Daniel.',
      traits: { openness: 0.5, conscientiousness: 0.6, extraversion: 0.5, agreeableness: 0.4, neuroticism: 0.25 },
      values: { safety: 0.4, truth: 0.9, loyalty: 0.4, ambition: 0.6, freedom: 0.5, compassion: 0.4, control: 0.7, belonging: 0.3 },
      goals: [{ text: 'Find the mechanical cause', weight: 0.8, tags: ['truth', 'novel'] }],
      fears: [{ text: 'Being made a fool of', weight: 0.6, tags: ['accusation', 'blame'] }],
      beliefs: [{ claim: 'Everything here has a mechanical explanation', confidence: 0.9 }],
      memories: [{ id: 'mem-theo-1', text: 'Fixed the seawall pump alone during a storm', at: -9000, tags: ['risk', 'novel', 'dark'], valence: 0.6, arousal: 0.6, rehearsals: [-4000] }],
    } }],
    ['entity.create', { kind: 'character', id: D, sample: true, data: {
      name: 'Daniel Okafor', role: 'Host who sleepwalks', worldId: W,
      summary: 'Owns the house. Keeps things from the guests to protect them, or himself.',
      traits: { openness: 0.4, conscientiousness: 0.5, extraversion: 0.6, agreeableness: 0.6, neuroticism: 0.5 },
      values: { safety: 0.5, truth: 0.2, loyalty: 0.8, ambition: 0.4, freedom: 0.3, compassion: 0.6, control: 0.9, belonging: 0.7 },
      goals: [{ text: 'Keep the cellar secret', weight: 0.9, tags: ['control', '!truth', 'secret'] }],
      fears: [{ text: 'Being accused before the guests', weight: 0.7, tags: ['accusation', 'blame'] }],
      beliefs: [{ claim: 'He can keep everyone safe if they do not ask', confidence: 0.6 }],
      memories: [],
    } }],
    ['entity.create', { kind: 'plot', id: 'plot-week', sample: true, data: {
      title: 'The Stopped Week (SAMPLE)', worldId: W, status: 'active',
      logline: 'Three guests reconstruct one night at 03:00 and each comes away with a different truth.',
      beats: [
        { id: 'beat-1', title: 'Arrival', summary: 'Clocks stop at 03:00 on the first night.', characterIds: [I, T, D], themeIds: [TH2], tension: 3 },
        { id: 'beat-2', title: 'The cellar door', summary: 'Ines hears it; Theo sees a figure on the landing.', characterIds: [I, T], themeIds: [TH1, TH2], tension: 7 },
        { id: 'beat-3', title: 'Breakfast accusation', summary: 'Ines retells the night; Theo’s memory starts to drift.', characterIds: [I, T, D], themeIds: [TH1], tension: 6 },
      ] } }],
    ['entity.create', { kind: 'library', id: 'library-ch1', sample: true, data: {
      title: 'Chapter One draft (SAMPLE)', author: 'Synthetic', form: 'manuscript', tags: ['sample'],
      text: 'The house took them in without a sound. Every clock on the landing had stopped at three.\n\n' +
        '“It’s the damp,” Theo said. “Salt gets into the springs.” Nobody answered him.\n\n' +
        'That night Ines lay awake and listened. Somewhere beneath the kitchen a door opened, slowly, as if someone behind it were afraid of being heard. She held her breath in the dark.\n\n' +
        'In the morning Daniel set out bread and said nothing about the cellar. Ines watched his hands. Were they shaking?' } }],
    ['entity.create', { kind: 'inbox', id: 'inbox-retelling', sample: true, data: {
      title: 'Biased retellings yield biased memories', source: 'Tversky & Marsh (2000), Cognitive Psychology',
      url: 'https://scholars.duke.edu/publication/651240', evidence: 'ESTABLISHED', status: 'FILED',
      claim: 'Retelling an event with a slant shifts the teller’s later memory toward that slant.',
      notes: 'Supports drift in Theo’s recollection after Ines retells the night (beat 3). Via NUE-CR-001.',
      tags: ['memory', 'retelling'], links: ['theme:' + TH1, 'character:' + T] } }],
    ['entity.create', { kind: 'inbox', id: 'inbox-repression', sample: true, data: {
      title: 'Repressed memory with intact recovery', source: 'Otgaar et al. (2019), Perspectives on Psychological Science',
      url: 'https://openaccess.city.ac.uk/22336/', evidence: 'CONTESTED', status: 'TRIAGED',
      claim: 'Total repression followed by accurate recovery is scientifically controversial.',
      notes: 'Use only as an author-invoked effect labelled Fictional license.', tags: ['memory', 'trauma'], links: [] } }],
    ['entity.create', { kind: 'inbox', id: 'inbox-new', sample: true, data: {
      title: 'Context-dependent recall in real rooms', source: 'Murre (2021) replication of Godden & Baddeley',
      url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8568063', evidence: 'UNREVIEWED', status: 'NEW',
      claim: 'Environmental context effects on recall may be weaker than the classic divers study suggests.', tags: ['memory', 'place'] } }],
    ['entity.create', { kind: 'intel', id: 'intel-1', sample: true, data: {
      title: 'Decisions must cite their causes', form: 'finding', evidence: 'SIMULATION',
      body: 'Every recorded decision stores its full inputs and a digest. The Verify action replays it and must match exactly.' } }],
  ];
}
