// Deterministic hashed randomness (NUE-CR-001 proposal: derive each draw from a
// hash of its purpose so unchanged inputs always roll the same way).

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Uniform in [0,1) from the given parts. */
export function hashUnit(...parts) {
  return fnv1a(parts.map(String).join('␟')) / 4294967296;
}

/** Roughly normal noise (Irwin–Hall of 4 uniforms), mean 0, sd = scale. */
export function hashNoise(scale, ...parts) {
  let s = 0;
  for (let i = 0; i < 4; i++) s += hashUnit(...parts, 'n' + i);
  return (s - 2) * scale * Math.sqrt(3);
}

/** Short stable digest of any JSON-serialisable value (not cryptographic). */
export function digest(value) {
  const s = stableStringify(value);
  const a = fnv1a(s).toString(16).padStart(8, '0');
  const b = fnv1a('salt:' + s).toString(16).padStart(8, '0');
  return a + b;
}

export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

export function uid(prefix = 'id') {
  const r = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(16).slice(2, 14);
  return `${prefix}-${r}`;
}
