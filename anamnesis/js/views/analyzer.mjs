import { h, field, textarea, select, btn, panel, table } from '../ui.mjs';
import { liveList } from '../core/store.mjs';
import { analyzeText } from '../core/analyzer.mjs';

export function analyzerView(ctx) {
  const docs = liveList(ctx.state, 'library');
  const srcId = ctx.params[0] || ctx.scratch.analyzeId || (docs[0]?.id ?? 'paste');
  const doc = ctx.state.entities.library[srcId];
  const text = doc ? doc.text : (ctx.scratch.pasted || '');
  const names = liveList(ctx.state, 'character').map(c => c.name);
  const r = analyzeText(text, { names });
  const sel = select('src', doc ? srcId : 'paste', [...docs.map(d => [d.id, d.title]), ['paste', 'Paste text…']]);
  sel.addEventListener('change', () => { ctx.scratch.analyzeId = sel.value; ctx.go('analyzer', sel.value === 'paste' ? '' : sel.value); });
  const paste = !doc ? field('Text', textarea('pasted', ctx.scratch.pasted || '', 8, { class: 'prose', oninput: e => { ctx.scratch.pasted = e.target.value; } })) : null;
  const metric = (k, v, note) => h('div', { class: 'metric' }, h('div', { class: 'metric-v' }, String(v)), h('div', { class: 'metric-k' }, k), note ? h('div', { class: 'metric-n' }, note) : null);
  const maxT = Math.max(1, ...r.paragraphStats.map(p => p.tension));
  return h('div', { class: 'single' },
    panel('Source', h('div', { class: 'row' }, field('Analyze', sel), !doc ? btn('Run analysis', () => ctx.rerender(), 'primary') : null), paste),
    panel('Metrics', h('div', { class: 'metrics' },
      metric('Words', r.words), metric('Sentences', r.sentences), metric('Paragraphs', r.paragraphs),
      metric('Avg sentence', r.avgSentence, `± ${r.sentenceVariation}`), metric('Flesch ease', r.fleschReadingEase, r.fleschReadingEase >= 60 ? 'plain' : 'dense'),
      metric('Dialogue %', r.dialogueRatio), metric('Questions %', r.questionRatio), metric('Read min', r.readingMinutes),
      metric('Tension %', r.tensionMean, 'dread lexicon')),
      h('p', { class: 'dim' }, r.method)),
    panel('Pacing · tension per paragraph',
      r.paragraphStats.length ? h('div', { class: 'bars', role: 'img', 'aria-label': 'Tension per paragraph; see table below' },
        r.paragraphStats.map(p => h('div', { class: 'bar-col', title: `¶${p.index}: ${p.words} words, tension ${p.tension}% ${p.cues.join(', ')}` },
          h('div', { class: 'bar', style: { height: `${Math.max(3, (p.tension / maxT) * 100)}%` } }), h('div', { class: 'bar-label' }, String(p.index))))) : h('p', { class: 'dim' }, 'No paragraphs.'),
      r.paragraphStats.length ? table(['¶', 'Words', 'Sentences', 'Avg sent.', 'Tension %', 'Cues'], r.paragraphStats.map(p => [p.index, p.words, p.sentences, p.avgSentence, p.tension, p.cues.join(' ')])) : null),
    h('div', { class: 'grid2' },
      panel('Top words', table(['Word', 'Count'], r.topWords.map(w => [w.word, w.count]))),
      panel('Character mentions', names.length ? table(['Character', 'Mentions (first name)'], names.map(n => [n, r.mentions[n] ?? 0])) : h('p', { class: 'dim' }, 'No characters defined.'))));
}
