// Intelligence: derived health checks over the whole project state. Pure.
import { liveList } from './store.mjs';
import { EVIDENCE } from './schema.mjs';
import { RESEARCH_STAGES } from './research.mjs';

export function computeIntel(state) {
  const chars = liveList(state, 'character');
  const plots = liveList(state, 'plot');
  const themes = liveList(state, 'theme');
  const inbox = liveList(state, 'inbox');
  const worlds = liveList(state, 'world');
  const findings = [];
  const add = (level, area, text, ref) => findings.push({ level, area, text, ref });

  for (const c of chars) {
    if (!c.goals.length) add('WARN', 'Characters', `${c.name} has no goals; decisions will rest on values and traits only.`, `character:${c.id}`);
    if (!c.fears.length) add('INFO', 'Characters', `${c.name} has no fears recorded.`, `character:${c.id}`);
    if (c.worldId && !state.entities.world[c.worldId]) add('ERROR', 'Characters', `${c.name} points at a missing world.`, `character:${c.id}`);
    if (!c.worldId) add('INFO', 'Characters', `${c.name} is not placed in a world.`, `character:${c.id}`);
  }
  const usedThemes = new Set(plots.flatMap(p => p.beats.flatMap(b => b.themeIds)));
  for (const t of themes) if (!usedThemes.has(t.id)) add('INFO', 'Themes', `Theme "${t.name}" is not carried by any plot beat.`, `theme:${t.id}`);
  for (const p of plots) {
    if (!p.beats.length) add('WARN', 'Plots', `Plot "${p.title}" has no beats.`, `plot:${p.id}`);
    p.beats.forEach((b, i) => {
      if (!b.characterIds.length) add('INFO', 'Plots', `Beat ${i + 1} of "${p.title}" has no characters.`, `plot:${p.id}`);
      for (const cid of b.characterIds) if (!state.entities.character[cid]) add('ERROR', 'Plots', `Beat ${i + 1} of "${p.title}" references a missing character.`, `plot:${p.id}`);
    });
  }
  const fresh = inbox.filter(i => i.status === 'NEW');
  if (fresh.length) add('WARN', 'Research', `${fresh.length} research item(s) awaiting triage.`, null);
  for (const i of inbox) {
    if (i.status === 'FILED' && i.evidence === 'UNREVIEWED') add('WARN', 'Research', `"${i.title}" is filed but its evidence status is unreviewed.`, `inbox:${i.id}`);
    for (const l of i.links) {
      const [k, id] = l.split(':');
      if (!state.entities[k]?.[id]) add('ERROR', 'Research', `"${i.title}" links to missing ${l}.`, `inbox:${i.id}`);
    }
  }
  const eligible = inbox.filter(i => i.stage === 'ELIGIBLE');
  if (eligible.length) add('INFO', 'Research', `${eligible.length} research item(s) are eligible for promotion and await an owner decision. Nothing changes automatically.`, null);
  const unverified = state.decisions.filter(d => !d.verifications.length);
  if (unverified.length) add('INFO', 'Decisions', `${unverified.length} recorded decision(s) not yet replay-verified.`, null);
  const failed = state.decisions.filter(d => d.verifications.some(v => !v.ok));
  if (failed.length) add('ERROR', 'Decisions', `${failed.length} decision(s) failed replay verification.`, null);
  if (state.rejected.length) add('ERROR', 'Log', `${state.rejected.length} event(s) were rejected during replay.`, null);

  const evidence = Object.fromEntries(EVIDENCE.map(e => [e, 0]));
  for (const i of inbox) evidence[i.evidence]++;
  return {
    counts: { characters: chars.length, worlds: worlds.length, plots: plots.length, themes: themes.length,
      research: inbox.length, library: liveList(state, 'library').length, decisions: state.decisions.length,
      simruns: state.simruns.length, conversations: state.conversations.length, beliefUpdates: state.beliefUpdates.length, events: state.seq },
    evidence, stages: Object.fromEntries(RESEARCH_STAGES.map(st => [st, inbox.filter(i => i.stage === st).length])), findings,
  };
}
