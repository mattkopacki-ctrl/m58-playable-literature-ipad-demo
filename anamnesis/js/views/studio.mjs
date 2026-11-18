// Scenario Studio (T-028): author, check, preview and run scenarios on the same
// engine as the built-in Old House. Preview runs in memory and writes nothing.
import { h, field, input, textarea, select, btn, badge, formData, panel, table } from '../ui.mjs';
import { saveEntity, editorHeader } from './common.mjs';
import { liveList } from '../core/store.mjs';
import { compileScenario } from '../core/studio.mjs';
import { stepScenario, scenarioStatus, previewScenario, knowledgeMatrix, clockOf } from '../core/scenario.mjs';
import { uid } from '../core/rng.mjs';

const words = v => String(v || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
const kvText = list => list.map(f => `${f.key} = ${f.value}`).join('\n');
const parseKv = text => String(text || '').split(/[\n,;]+/).map(l => l.split('=')).filter(p => p.length >= 2 && p[0].trim()).map(([k, ...v]) => ({ key: k.trim(), value: v.join('=').trim() }));
const beliefsText = list => list.map(b => `${b.sign < 0 ? '-' : '+'}${b.claim}`).join('; ');
const parseBeliefs = text => String(text || '').split(';').map(s => s.trim()).filter(Boolean).map(s => ({ sign: s.startsWith('-') ? -1 : 1, claim: s.replace(/^[+-]\s*/, '') })).filter(b => b.claim);
const optNum = v => (String(v ?? '').trim() === '' ? null : Number(v));

function placeSelect(name, value, places, emptyLabel) {
  return select(name, value || '', [...(emptyLabel ? [['', emptyLabel]] : []), ...places.map(p => [p, p])]);
}
function placeChecks(name, selected, places) {
  return h('div', { class: 'checks' }, places.map(p => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, value: p, checked: selected.includes(p) }), p)));
}
const flag = (name, on, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, value: 'yes', checked: on }), label);

// ---------- field groups (rendered with a name prefix, read back with the same prefix)
function channelFields(px, c, places, onRemove) {
  return h('fieldset', { class: 'channel' }, h('legend', {}, c.name || 'channel'),
    h('div', { class: 'grid2' }, field('Channel name', input(`${px}name`, c.name)), field('Tags', input(`${px}tags`, c.tags.join(' ')))),
    field('Perceived at', placeChecks(`${px}places`, c.places, places)),
    field('What a character there perceives', textarea(`${px}text`, c.text, 2)),
    h('div', { class: 'row' }, flag(`${px}wakes`, c.wakes, 'Wakes sleepers there'),
      field('Valence (blank = event’s)', input(`${px}valence`, c.valence ?? '', { inputmode: 'decimal' })),
      field('Arousal (blank = event’s)', input(`${px}arousal`, c.arousal ?? '', { inputmode: 'decimal' })),
      btn('Remove channel', onRemove, 'small danger')));
}
const readChannel = (d, px) => ({ name: d[`${px}name`], places: d[`${px}places`] || [], wakes: (d[`${px}wakes`] || []).length > 0, text: d[`${px}text`],
  tags: words(d[`${px}tags`]), valence: optNum(d[`${px}valence`]), arousal: optNum(d[`${px}arousal`]) });

function eventFields(px, e, places, ops, extra = []) {
  return [
    ...extra,
    h('div', { class: 'grid2' }, field('Title', input(`${px}title`, e.title)), field('Where it happens', placeSelect(`${px}place`, e.place, places, '— not placed —'))),
    field('Truth (author only; characters never read this)', textarea(`${px}truth`, e.truth, 2)),
    h('div', { class: 'grid2' }, field('Valence −1…1', input(`${px}valence`, String(e.valence), { inputmode: 'decimal' })), field('Arousal 0…1', input(`${px}arousal`, String(e.arousal), { inputmode: 'decimal' }))),
    ...e.channels.map((c, j) => channelFields(`${px}c-${j}-`, c, places, () => ops.removeChannel(j))),
    h('div', { class: 'row' }, btn('+ Perception channel', ops.addChannel, 'small')),
  ];
}
const readEvent = (d, px, n) => ({ title: d[`${px}title`], place: d[`${px}place`], truth: d[`${px}truth`], valence: Number(d[`${px}valence`]), arousal: Number(d[`${px}arousal`]),
  channels: Array.from({ length: n }, (_, j) => readChannel(d, `${px}c-${j}-`)) });

function collect(form, ent) {
  const d = formData(form);
  const on = k => (d[k] || []).length > 0;
  const cast = (d.cast || []).map(id => ({ characterId: id, place: d[`place-${id}`] || '', asleep: on(`asleep-${id}`) }));
  return {
    name: d.name, worldId: d.worldId, prompt: d.prompt, tags: words(d.tags), start: d.start, ticks: Number(d.ticks), facts: parseKv(d.facts), cast,
    events: ent.events.map((e, i) => ({ id: e.id, minute: Number(d[`e-${i}-minute`]), ...readEvent(d, `e-${i}-`, e.channels.length) })),
    options: ent.options.map((o, k) => {
      const px = `o-${k}-`;
      return { id: o.id, label: d[`${px}label`], tags: words(d[`${px}tags`]), beliefs: parseBeliefs(d[`${px}beliefs`]),
        requires: { awake: d[`${px}awake`], places: d[`${px}places`] || [], notPlaces: d[`${px}notPlaces`] || [], knows: words(d[`${px}knows`]), lacks: words(d[`${px}lacks`]),
          company: on(`${px}company`), world: words(d[`${px}world`]) },
        effects: { moveTo: d[`${px}moveTo`], remember: { text: d[`${px}remember`], tags: words(d[`${px}rememberTags`]), valence: Number(d[`${px}rememberValence`]), arousal: Number(d[`${px}rememberArousal`]) },
          wakeWith: d[`${px}wakeWith`], tellHere: d[`${px}tellHere`], setFacts: parseKv(d[`${px}setFacts`]),
          emits: on(`${px}emits`) ? { ...readEvent(d, `${px}x-`, o.effects.emits?.channels.length || 0), actorText: d[`${px}x-actorText`] || '', actorTags: words(d[`${px}x-actorTags`]) } : null } };
    }),
  };
}

// ---------- results
function timeline(cast, ticks, nameOf) {
  if (!ticks.length) return null;
  return table(['Time', ...cast.map(id => nameOf(id).split(' ')[0]), 'World events'], ticks.map(t => [t.clock,
    ...cast.map(id => { const a = t.actions.find(x => x.characterId === id); return a ? `${a.label}${a.to !== a.from ? ` → ${a.to}` : ''}` : '—'; }),
    t.worldEvents.map(e => `${e.title} (seen by ${e.perceptions.map(p => nameOf(p.characterId).split(' ')[0]).join(', ') || 'no one'})`).join('; ') || '—']));
}
function ticksFromLog(state, scId) {
  const by = {};
  for (const a of state.actions.filter(a => a.scenarioId === scId)) (by[a.tick] ||= { tick: a.tick, clock: clockOf(a.storyTime), actions: [], worldEvents: [] }).actions.push(a);
  for (const e of state.worldEvents.filter(e => e.id.startsWith(`we-${scId}-t`))) { const t = Number(e.id.match(/-t(\d+)-/)?.[1]); (by[t] ||= { tick: t, clock: e.clock, actions: [], worldEvents: [] }).worldEvents.push(e); }
  return Object.values(by).sort((a, b) => a.tick - b.tick);
}
function matrixTable(state, cast, nameOf, scenarioLike) {
  const rows = knowledgeMatrix(state, scenarioLike);
  if (!rows.length) return h('p', { class: 'dim' }, 'No world events yet.');
  return table(['World event', ...cast.map(id => nameOf(id).split(' ')[0])], rows.map(r => [`${r.event.clock} ${r.event.title}`,
    ...r.cells.map(c => h('span', { title: c.text, class: c.how === 'unaware' ? 'dim' : '' }, c.how === 'unaware' ? '—' : c.how))]));
}

// ---------- main view
export function studioView(ctx, ent) {
  const state = ctx.state;
  const world = state.entities.world[ent.worldId];
  const places = world?.places || [];
  const comp = compileScenario(ent, state);
  const sc = comp.scenario;
  const castIds = ent.cast.map(c => c.characterId);
  const nameOf = id => state.entities.character[id]?.name || id;
  const st = sc ? scenarioStatus(state, sc) : { tick: state.scenarios?.[ent.id]?.tick || 0, done: false, clock: ent.start, facts: {} };
  const started = st.tick > 0;
  const save = data => saveEntity(ctx, 'scenario', ent, data);
  // Structural edits save immediately. Mark the form clean first, so the unsaved-draft
  // guard does not restore old values into rows whose positions have just shifted.
  const clean = () => { form.dataset.dirty = '0'; form.querySelector('.draft-bar')?.remove(); };
  const mutate = fn => { const data = collect(form, ent); fn(data); clean(); return save(data); };
  const pv = ctx.scratch.preview?.[ent.id];

  // run panel
  const remaining = sc ? sc.maxTicks - st.tick : 0;
  const pvSel = select('pvTicks', String(Math.max(1, remaining)), Array.from({ length: Math.max(1, remaining) }, (_, i) => [String(i + 1), `${i + 1} minute${i ? 's' : ''}`]));
  const run = async n => {
    try {
      let s = ctx.state;
      for (let i = 0; i < n; i++) { const c = compileScenario(s.entities.scenario[ent.id], s); const r = stepScenario(s, c.scenario); for (const [t, p] of r.events) await ctx.dispatch(t, p, { silent: true }); s = ctx.getState(); }
      ctx.status(`${ent.name}: ran to ${scenarioStatus(ctx.getState(), compileScenario(ctx.getState().entities.scenario[ent.id], ctx.getState()).scenario).clock}. Written to the log.`);
    } catch (err) { ctx.status(err.message); }
    ctx.rerender();
  };
  const runPanel = panel('Check · preview · run',
    h('div', { class: 'metrics' },
      h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, st.clock), h('div', { class: 'metric-k' }, `minute ${st.tick} of ${ent.ticks}${started ? ' · paused' : ' · not started'}`)),
      ...Object.entries(st.facts || {}).map(([k, v]) => h('div', { class: 'metric' }, h('div', { class: 'metric-v small' }, v), h('div', { class: 'metric-k' }, k)))),
    comp.errors.length ? h('div', { class: 'checklist' }, h('p', {}, badge(`${comp.errors.length} PROBLEM${comp.errors.length > 1 ? 'S' : ''} TO FIX`, 'bad')), h('ul', { class: 'plain' }, comp.errors.map(e => h('li', {}, e))))
      : h('p', {}, badge('READY TO RUN', 'ok')),
    comp.warnings.length ? h('div', { class: 'checklist' }, h('p', {}, badge(`${comp.warnings.length} WARNING${comp.warnings.length > 1 ? 'S' : ''}`, 'warn')), h('ul', { class: 'plain dim' }, comp.warnings.map(w => h('li', {}, w)))) : null,
    h('div', { class: 'row' },
      field('Preview length', pvSel),
      btn('Preview (not saved) ▸', () => {
        try { const n = Number(pvSel.value); const r = previewScenario(ctx.state, sc, n); (ctx.scratch.preview ||= {})[ent.id] = { seq: ctx.state.seq, ticks: r.ticks, state: r.state }; ctx.status(`Preview of ${r.ticks.length} minute(s). Nothing was written.`); }
        catch (err) { ctx.status('Preview failed: ' + err.message); }
        ctx.rerender();
      }, 'primary', { disabled: !sc || st.done ? 'disabled' : null }),
      btn('Run one minute', () => run(1), '', { disabled: !sc || st.done ? 'disabled' : null }),
      btn('Run to end', () => run(remaining), '', { disabled: !sc || st.done ? 'disabled' : null }),
      st.done ? badge('FINISHED', 'dim') : null),
    h('p', { class: 'dim' }, 'Preview runs in memory from the current project state and writes nothing. Run writes to the log: the cast’s memories, places and beliefs change for good, and a run cannot be rewound (branching is blocked). Use Preview to experiment.'),
    pv ? h('div', { class: 'preview' },
      h('h3', {}, `Preview · ${pv.ticks.length} minute(s) · not saved`),
      pv.seq !== ctx.state.seq ? h('p', { class: 'warn' }, 'The project has changed since this preview. Preview again to refresh it.') : null,
      timeline(castIds, pv.ticks, nameOf),
      h('h3', {}, 'Who would know what'), matrixTable(pv.state, castIds, nameOf, { id: ent.id, cast: castIds }),
      btn('Clear preview', () => { delete ctx.scratch.preview[ent.id]; ctx.rerender(); }, 'small')) : null,
    started ? h('div', {}, h('h3', {}, 'Recorded run'), timeline(castIds, ticksFromLog(state, ent.id), nameOf),
      h('h3', {}, 'Who knows what'), matrixTable(state, castIds, nameOf, { id: ent.id, cast: castIds })) : null);

  // editor form
  const chars = liveList(state, 'character');
  const showAll = ctx.scratch.showAllChars;
  const castable = chars.filter(c => showAll || !ent.worldId || c.worldId === ent.worldId || castIds.includes(c.id));
  const worldSel = select('worldId', ent.worldId, [['', '— choose a world —'], ...liveList(state, 'world').map(w => [w.id, w.name])]);
  worldSel.addEventListener('change', () => mutate(d => { d.worldId = worldSel.value; }));
  const minuteSel = (name, v) => select(name, String(v), Array.from({ length: ent.ticks }, (_, i) => [String(i + 1), `${clockOf((Number(ent.start.slice(0, 2)) + Number(ent.start.slice(3)) / 60) + i / 60)} (minute ${i + 1})`]));

  const form = h('form', { class: 'form', onsubmit: e => { e.preventDefault(); save(collect(form, ent)); } },
    h('fieldset', {}, h('legend', {}, 'Basics'),
      h('div', { class: 'grid2' }, field('Name', input('name', ent.name)), field('World', worldSel, places.length ? `${places.length} places` : 'Places come from the world.')),
      field('Question each character answers every minute', input('prompt', ent.prompt)),
      h('div', { class: 'grid2' }, field('Situation tags (cues)', input('tags', ent.tags.join(' '))),
        h('div', { class: 'grid2' }, field('Starts at', input('start', ent.start, { type: 'time' })), field('Minutes', input('ticks', String(ent.ticks), { type: 'number', min: 1, max: 240, inputmode: 'numeric' })))),
      field('Facts (one per line: key = value)', textarea('facts', kvText(ent.facts), 2), 'Options can require a fact (kettle=COLD) and change it.')),
    h('fieldset', {}, h('legend', {}, `Cast (${ent.cast.length})`),
      places.length ? null : h('p', { class: 'warn' }, 'Choose a world with places to set starting positions.'),
      castable.length ? table(['In cast', 'Starts at', 'Asleep'], castable.map(c => {
        const cur = ent.cast.find(x => x.characterId === c.id);
        return [h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'cast', value: c.id, checked: !!cur }), c.name),
          placeSelect(`place-${c.id}`, cur?.place || '', places, '— choose —'), flag(`asleep-${c.id}`, !!cur?.asleep, 'asleep')];
      })) : h('p', { class: 'dim' }, 'No characters in this world yet.'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!showAll, onchange: e => { ctx.scratch.showAllChars = e.target.checked; ctx.rerender(); } }), 'Show characters from other worlds')),
    h('fieldset', {}, h('legend', {}, `World events (${ent.events.length})`),
      ent.events.map((e, i) => h('details', { class: 'option', open: ctx.scratch.openEvent === e.id ? true : null },
        h('summary', {}, `${clockOf((Number(ent.start.slice(0, 2)) + Number(ent.start.slice(3)) / 60) + (e.minute - 1) / 60)} · ${e.title} · ${e.channels.length} channel(s)`),
        ...eventFields(`e-${i}-`, e, places, {
          addChannel: () => { ctx.scratch.openEvent = e.id; mutate(d => d.events[i].channels.push({ name: 'perceived', places: [], text: '', tags: [] })); },
          removeChannel: j => { ctx.scratch.openEvent = e.id; mutate(d => d.events[i].channels.splice(j, 1)); },
        }, [field('At minute', minuteSel(`e-${i}-minute`, e.minute))]),
        h('div', { class: 'row' }, btn('Remove event', () => mutate(d => d.events.splice(i, 1)), 'small danger')))),
      h('div', { class: 'row' }, btn('+ World event', () => { const id = uid('ev'); ctx.scratch.openEvent = id; mutate(d => d.events.push({ id, minute: 1, title: 'New event', place: places[0] || '', truth: '', channels: [{ name: 'perceived', places: [], text: '', tags: [] }] })); }, 'small'))),
    h('fieldset', {}, h('legend', {}, `Action options (${ent.options.length})`),
      h('p', { class: 'dim' }, 'Every awake character chooses one option each minute from those whose conditions they meet, using their own values, goals, fears, memories and beliefs.'),
      ent.options.map((o, k) => {
        const px = `o-${k}-`, x = o.effects.emits;
        return h('details', { class: 'option', open: ctx.scratch.openOption === o.id ? true : null },
          h('summary', {}, `${o.label} · ${o.requires.awake === 'asleep' ? 'sleepers' : o.requires.awake === 'any' ? 'anyone' : 'awake'}${o.requires.places.length ? ` · at ${o.requires.places.join('/')}` : ''}`),
          h('div', { class: 'grid2' }, field('Label', input(`${px}label`, o.label)), field('Tags (values, goals, fears it touches)', input(`${px}tags`, o.tags.join(' ')))),
          field('Presumes beliefs (+claim true; -claim false)', input(`${px}beliefs`, beliefsText(o.beliefs))),
          h('fieldset', {}, h('legend', {}, 'Available when'),
            h('div', { class: 'grid2' }, field('Who', select(`${px}awake`, o.requires.awake, [['awake', 'Awake characters'], ['asleep', 'Sleeping characters'], ['any', 'Anyone']])),
              field('Fact conditions (fact=value, or someoneAsleep)', input(`${px}world`, o.requires.world.join(' ')))),
            field('Only at', placeChecks(`${px}places`, o.requires.places, places)),
            field('Not at', placeChecks(`${px}notPlaces`, o.requires.notPlaces, places)),
            h('div', { class: 'grid2' }, field('Knows (memory tags they must hold)', input(`${px}knows`, o.requires.knows.join(' '))), field('Not yet done (memory tags they must lack)', input(`${px}lacks`, o.requires.lacks.join(' ')))),
            flag(`${px}company`, o.requires.company, 'Needs someone else present')),
          h('fieldset', {}, h('legend', {}, 'What it does'),
            h('div', { class: 'grid2' }, field('Move to', placeSelect(`${px}moveTo`, o.effects.moveTo, places, '— stay —')), field('Set facts (key = value)', input(`${px}setFacts`, kvText(o.effects.setFacts).replace(/\n/g, ', ')))),
            h('div', { class: 'grid2' }, field('They remember', input(`${px}remember`, o.effects.remember.text)), field('Memory tags', input(`${px}rememberTags`, o.effects.remember.tags.join(' ')))),
            h('div', { class: 'grid2' }, field('Memory valence', input(`${px}rememberValence`, String(o.effects.remember.valence), { inputmode: 'decimal' })), field('Memory arousal', input(`${px}rememberArousal`, String(o.effects.remember.arousal), { inputmode: 'decimal' }))),
            h('div', { class: 'grid2' }, field('Wake sleepers, telling them memory tagged', input(`${px}wakeWith`, o.effects.wakeWith)), field('Tell people here memory tagged', input(`${px}tellHere`, o.effects.tellHere))),
            flag(`${px}emits`, !!x, 'Causes a world event others can perceive'),
            x ? h('fieldset', {}, h('legend', {}, 'World event caused by this action'),
              ...eventFields(`${px}x-`, x, places, {
                addChannel: () => { ctx.scratch.openOption = o.id; mutate(d => d.options[k].effects.emits.channels.push({ name: 'perceived', places: [], text: '', tags: [] })); },
                removeChannel: j => { ctx.scratch.openOption = o.id; mutate(d => d.options[k].effects.emits.channels.splice(j, 1)); },
              }),
              h('div', { class: 'grid2' }, field('What the actor remembers doing', input(`${px}x-actorText`, x.actorText)), field('Actor memory tags', input(`${px}x-actorTags`, x.actorTags.join(' '))))) : null),
          h('div', { class: 'row' }, btn('Remove option', () => mutate(d => d.options.splice(k, 1)), 'small danger')));
      }),
      h('div', { class: 'row' }, btn('+ Action option', () => { const id = uid('opt'); ctx.scratch.openOption = id; mutate(d => d.options.push({ id, label: 'New action', tags: [], requires: { awake: 'awake' }, effects: {} })); }, 'small'))),
    h('div', { class: 'row sticky-save' }, h('button', { type: 'submit', class: 'btn primary' }, 'Save scenario'),
      started ? h('span', { class: 'warn' }, `Started (minute ${st.tick}). Edits apply to later minutes only.`) : null));

  return h('div', { class: 'single studio' },
    h('p', {}, h('a', { href: '#/simulator' }, '‹ Simulator')),
    editorHeader(ctx, 'scenario', ent),
    runPanel,
    panel('Scenario', form));
}
