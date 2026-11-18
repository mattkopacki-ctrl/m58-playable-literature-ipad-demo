// Deterministic text analysis for manuscripts. No network, no LLM.

const STOP = new Set(('a an and are as at be been but by for from had has have he her hers him his i if in into is it its ' +
  'me my no not of on or our she so than that the their them then there they this to too up us was we were what when ' +
  'which who will with would you your all any can could did do does just like more one only out over some such very ' +
  'about after again against before being below between both down during each few further here how off once other own ' +
  'same should through under until while why where again said says say now back went go get got').split(' '));

// Small dread lexicon for a tension heuristic. Status: SIMULATION TECHNIQUE.
const TENSION = new Set(('dark darkness dread fear afraid scream screamed blood cold shadow shadows silence silent whisper ' +
  'whispered locked lock cellar door knock knocked bell alone empty dead death grave night midnight wrong strange ' +
  'stranger vanish vanished missing gone hollow trembling shaking breath breathing footsteps stairs stairwell hide ' +
  'hidden watching watched eyes behind ' +
  'unlit abandoned').split(' '));

export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function words(text) {
  return (String(text).match(/[A-Za-zÀ-ɏ]+(?:['’][A-Za-z]+)?/g) || []);
}

export function sentences(text) {
  return String(text).replace(/\s+/g, ' ').split(/(?<=[.!?…])\s+(?=["“'A-Z0-9])/).map(s => s.trim()).filter(s => words(s).length);
}

export function analyzeText(text, { names = [] } = {}) {
  const t = String(text || '');
  const ws = words(t);
  const ss = sentences(t);
  const paras = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  const wc = ws.length, sc = Math.max(1, ss.length);
  const flesch = wc ? 206.835 - 1.015 * (wc / sc) - 84.6 * (syl / wc) : 0;
  const dialogueChars = (t.match(/[“"][^”"]*[”"]/g) || []).reduce((a, q) => a + q.length, 0);
  const freq = new Map();
  for (const w of ws) {
    const k = w.toLowerCase();
    if (STOP.has(k) || k.length < 3) continue;
    freq.set(k, (freq.get(k) || 0) + 1);
  }
  const topWords = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([word, count]) => ({ word, count }));
  const mentions = {};
  for (const n of names) {
    const first = String(n).split(/\s+/)[0];
    if (!first) continue;
    const re = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    mentions[n] = (t.match(re) || []).length;
  }
  const paragraphs = paras.map((p, i) => {
    const pw = words(p);
    const hits = pw.filter(w => TENSION.has(w.toLowerCase()));
    const ps = Math.max(1, sentences(p).length);
    return { index: i + 1, words: pw.length, sentences: ps, avgSentence: Math.round((pw.length / ps) * 10) / 10,
      tension: pw.length ? Math.round((hits.length / pw.length) * 1000) / 10 : 0, cues: [...new Set(hits.map(h => h.toLowerCase()))] };
  });
  const lens = ss.map(s => words(s).length);
  const mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lens.length));
  return {
    words: wc, sentences: ss.length, paragraphs: paras.length, characters: t.length,
    avgSentence: Math.round(mean * 10) / 10, sentenceVariation: Math.round(sd * 10) / 10,
    fleschReadingEase: Math.round(flesch * 10) / 10,
    readingMinutes: Math.round((wc / 230) * 10) / 10,
    dialogueRatio: t.length ? Math.round((dialogueChars / t.length) * 1000) / 10 : 0,
    questionRatio: ss.length ? Math.round((ss.filter(s => s.endsWith('?')).length / ss.length) * 1000) / 10 : 0,
    topWords, mentions, paragraphStats: paragraphs,
    tensionMean: paragraphs.length ? Math.round(paragraphs.reduce((a, p) => a + p.tension, 0) / paragraphs.length * 10) / 10 : 0,
    method: 'Deterministic heuristics: Flesch reading ease; dread-lexicon tension % (simulation technique); quoted-text dialogue ratio.',
  };
}
