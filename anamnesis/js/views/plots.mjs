import { h, field, input, textarea, select, btn, formData, panel } from '../ui.mjs';
import { workbench, saveEntity, editorHeader } from './common.mjs';
import { liveList } from '../core/store.mjs';
import { uid } from '../core/rng.mjs';

export function plotsView(ctx) {
  return workbench(ctx, {
    kind: 'plot', route: 'plots', title: 'Plots', sub: e => `${e.status} · ${e.beats.length} beats`,
    newData: () => ({ title: 'New plot' }),
    editor: ent => {
      const chars = liveList(ctx.state, 'character');
      const themes = liveList(ctx.state, 'theme');
      const worlds = [['', '— none —'], ...liveList(ctx.state, 'world').map(w => [w.id, w.name])];
      const beatBlocks = ent.beats.map((b, i) => h('fieldset', { class: 'beat', 'data-beat': b.id },
        h('legend', {}, `Beat ${i + 1}`),
        h('div', { class: 'grid2' }, field('Title', input(`b-${i}-title`, b.title)), field('Tension 0–10', input(`b-${i}-tension`, String(b.tension), { type: 'number', min: 0, max: 10, inputmode: 'numeric' }))),
        field('Summary', textarea(`b-${i}-summary`, b.summary, 2)),
        h('div', { class: 'checks' }, h('span', { class: 'dim' }, 'Characters: '), chars.map(c => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `b-${i}-chars`, value: c.id, checked: b.characterIds.includes(c.id) }), c.name))),
        h('div', { class: 'checks' }, h('span', { class: 'dim' }, 'Themes: '), themes.map(t => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `b-${i}-themes`, value: t.id, checked: b.themeIds.includes(t.id) }), t.name))),
        h('div', { class: 'row' },
          btn('↑', () => move(i, -1), 'small', { 'aria-label': `Move beat ${i + 1} up`, disabled: i === 0 ? 'disabled' : null }),
          btn('↓', () => move(i, 1), 'small', { 'aria-label': `Move beat ${i + 1} down`, disabled: i === ent.beats.length - 1 ? 'disabled' : null }),
          btn('Remove beat', () => saveEntity(ctx, 'plot', ent, { beats: ent.beats.filter((_, j) => j !== i) }), 'small danger'))));
      const collect = () => {
        const d = formData(form);
        return { title: d.title, logline: d.logline, status: d.status, worldId: d.worldId,
          beats: ent.beats.map((b, i) => ({ id: b.id, title: d[`b-${i}-title`], summary: d[`b-${i}-summary`], tension: Number(d[`b-${i}-tension`]),
            characterIds: d[`b-${i}-chars`] || [], themeIds: d[`b-${i}-themes`] || [] })) };
      };
      const move = (i, dir) => { const p = collect(); const beats = p.beats.slice(); [beats[i], beats[i + dir]] = [beats[i + dir], beats[i]]; saveEntity(ctx, 'plot', ent, { ...p, beats }); };
      const form = h('form', { class: 'form', onsubmit: e => { e.preventDefault(); saveEntity(ctx, 'plot', ent, collect()); } },
        field('Title', input('title', ent.title)),
        h('div', { class: 'grid2' }, field('World', select('worldId', ent.worldId, worlds)), field('Status', select('status', ent.status, ['draft', 'active', 'parked']))),
        field('Logline', textarea('logline', ent.logline, 2)),
        ...beatBlocks,
        h('div', { class: 'row' }, h('button', { type: 'submit', class: 'btn primary' }, 'Save plot'),
          btn('+ Add beat', () => { const p = collect(); saveEntity(ctx, 'plot', ent, { ...p, beats: [...p.beats, { id: uid('beat'), title: `Beat ${p.beats.length + 1}`, tension: 5 }] }); })));
      return h('div', {}, editorHeader(ctx, 'plot', ent), form, tensionStrip(ent));
    },
  });
}

/** Single-series tension strip; the beat list above is its table view. */
function tensionStrip(ent) {
  if (!ent.beats.length) return null;
  return panel('Tension arc', h('div', { class: 'bars', role: 'img', 'aria-label': `Tension by beat: ${ent.beats.map((b, i) => `${i + 1} ${b.title} ${b.tension}`).join('; ')}` },
    ent.beats.map((b, i) => h('div', { class: 'bar-col', title: `Beat ${i + 1} · ${b.title}: tension ${b.tension}/10` },
      h('div', { class: 'bar', style: { height: `${Math.max(4, b.tension * 10)}%` } }), h('div', { class: 'bar-label' }, String(i + 1))))));
}
