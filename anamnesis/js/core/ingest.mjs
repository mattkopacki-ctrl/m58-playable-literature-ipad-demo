// Research ingestion (T-026). Turns a Markdown, plain-text or PDF file into a research
// item plus an untouched copy of the original bytes. No network, no libraries.
// PDF text extraction is best effort and says so: it reads simple text operators only.

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 1000000;
export const PDF_METHOD = 'anamnesis-pdf-text-1: content-stream text operators (Tj, TJ, \', "), Flate streams, Latin-1 glyph decoding; best effort';

export async function sha256Hex(bytes) {
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function detectKind(name, mime, bytes) {
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head === '%PDF-') return 'pdf';
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (['md', 'markdown', 'mdown'].includes(ext) || mime === 'text/markdown') return 'markdown';
  if (ext === 'txt' || String(mime).startsWith('text/')) return 'text';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  return null;
}

export function decodeText(bytes) {
  const warnings = [];
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { text = new TextDecoder('latin1').decode(bytes); warnings.push('Not valid UTF-8; decoded as Latin-1. The original bytes are kept unchanged.'); }
  if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); warnings.push('Byte-order mark removed from the text view; the original bytes are kept unchanged.'); }
  return { text, warnings };
}

export function markdownMeta(text) {
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const fmTitle = fm?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const headings = [...text.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map(m => ({ level: m[1].length, text: m[2] }));
  return { title: fmTitle || headings.find(x => x.level === 1)?.text || headings[0]?.text || '', headings,
    links: (text.match(/\[[^\]]*\]\([^)]+\)/g) || []).length };
}

// ---------- PDF

const latin1 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return s; };

async function inflate(bytes) {
  for (const fmt of ['deflate', 'deflate-raw']) {
    try {
      const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(fmt)));
      return new Uint8Array(await out.arrayBuffer());
    } catch { /* try the next format */ }
  }
  return null;
}

/** Decode a PDF literal string body (between the outer parentheses). */
function literal(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\') { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n'; else if (n === 'r') out += '\r'; else if (n === 't') out += '\t'; else if (n === 'b') out += '\b'; else if (n === 'f') out += '\f';
    else if (n === '\r' || n === '\n') { if (n === '\r' && s[i + 1] === '\n') i++; }
    else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]; out += String.fromCharCode(parseInt(o, 8) & 255); }
    else out += n;
  }
  return out;
}
const hexString = h => { const t = h.replace(/\s+/g, ''); let out = ''; for (let i = 0; i < t.length; i += 2) out += String.fromCharCode(parseInt((t[i] + (t[i + 1] || '0')), 16)); return out; };

/** Read text-showing operators from one content stream. */
export function textFromContent(src) {
  let out = '', i = 0, inText = false;
  const stack = [];
  const push = t => stack.push(t);
  const emit = s => { out += s; };
  while (i < src.length) {
    const c = src[i];
    if (c === '%') { while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
    if (c === '(') { let depth = 1, j = i + 1, body = ''; while (j < src.length && depth) { const d = src[j]; if (d === '\\') { body += d + (src[j + 1] ?? ''); j += 2; continue; } if (d === '(') depth++; if (d === ')') depth--; if (depth) body += d; j++; } push({ str: literal(body) }); i = j; continue; }
    if (c === '<' && src[i + 1] === '<') { i += 2; continue; }
    if (c === '>' && src[i + 1] === '>') { i += 2; continue; }
    if (c === '<') { const j = src.indexOf('>', i); push({ str: hexString(src.slice(i + 1, j)) }); i = j + 1; continue; }
    if (c === '[') { push({ arrStart: true }); i++; continue; }
    if (c === ']') { const arr = []; while (stack.length && !stack.at(-1).arrStart) arr.unshift(stack.pop()); stack.pop(); push({ arr }); i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    let j = i; while (j < src.length && !/[\s()<>[\]{}/%]/.test(src[j])) j++;
    if (j === i) { if (src[i] === '/') { j = i + 1; while (j < src.length && !/[\s()<>[\]{}/%]/.test(src[j])) j++; push({ name: src.slice(i, j) }); i = j; continue; } i++; continue; }
    const tok = src.slice(i, j); i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { push({ num: Number(tok) }); continue; }
    switch (tok) {
      case 'BT': inText = true; break;
      case 'ET': inText = false; emit('\n'); break;
      case 'Tj': if (inText) emit(stack.at(-1)?.str ?? ''); break;
      case "'": case '"': if (inText) emit('\n' + (stack.at(-1)?.str ?? '')); break;
      case 'TJ': if (inText) for (const el of stack.at(-1)?.arr || []) { if (el.str != null) emit(el.str); else if (el.num != null && el.num < -180 && !/\s$/.test(out)) emit(' '); } break;
      case 'T*': if (inText) emit('\n'); break;
      case 'Td': case 'TD': if (inText) { const y = stack.at(-1)?.num; if (y) emit('\n'); else if (stack.at(-2)?.num) emit(' '); } break;
      case 'Tm': if (inText) emit('\n'); break;
      default: break;
    }
    stack.length = 0;
  }
  return out;
}

export async function extractPdfText(bytes) {
  const warnings = [];
  const raw = latin1(bytes);
  const pages = (raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
  if (/\/Encrypt\s/.test(raw)) {
    warnings.push('The PDF is encrypted; no text could be read. The original file is kept unchanged.');
    return { text: '', pages, method: PDF_METHOD, warnings, streamsRead: 0, streamsSkipped: 0 };
  }
  let text = '', read = 0, skipped = 0, unsupportedFilters = new Set();
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    const dictStart = raw.lastIndexOf('<<', m.index);
    const dict = raw.slice(dictStart, m.index);
    const lenMatch = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    let end = lenMatch ? m.index + m[0].length + Number(lenMatch[1]) : raw.indexOf('endstream', m.index + m[0].length);
    if (end < 0 || raw.slice(end, end + 20).indexOf('endstream') < 0) end = raw.indexOf('endstream', m.index + m[0].length);
    if (end < 0) break;
    re.lastIndex = end;
    if (/\/Subtype\s*\/Image|\/Length1|\/Type\s*\/(XRef|Metadata|ObjStm|EmbeddedFile)/.test(dict)) { skipped++; continue; }
    let data = bytes.subarray(m.index + m[0].length, end);
    const filters = [...(dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/)?.[1] || '').matchAll(/\/(\w+)/g)].map(x => x[1]);
    let ok = true;
    for (const f of filters) {
      if (f === 'FlateDecode') { const out = await inflate(data); if (!out) { ok = false; break; } data = out; }
      else { unsupportedFilters.add(f); ok = false; break; }
    }
    if (!ok) { skipped++; continue; }
    const content = latin1(data);
    if (!/\bBT\b/.test(content)) { skipped++; continue; }
    read++;
    text += textFromContent(content) + '\n';
  }
  text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (unsupportedFilters.size) warnings.push(`Some streams use encodings this reader does not support (${[...unsupportedFilters].join(', ')}); their text may be missing.`);
  if (!text) warnings.push('No text found. The PDF may be scanned images or use fonts this reader cannot decode. The original file is kept unchanged.');
  else {
    const printable = (text.match(/[\x20-\x7e -ÿ\n\t]/g) || []).length / text.length;
    if (printable < 0.85) warnings.push('Much of the extracted text looks garbled; the PDF probably uses embedded font encodings this reader cannot map. Check against the original.');
  }
  return { text, pages, method: PDF_METHOD, warnings, streamsRead: read, streamsSkipped: skipped };
}

// ---------- research item

/** file = { name, type, size, lastModified, bytes: Uint8Array }. Returns { data, original } or throws. */
export async function buildIngest(file) {
  if (!file?.bytes?.length) throw new Error(`${file?.name || 'File'} is empty`);
  if (file.bytes.length > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than ${MAX_FILE_BYTES / 1048576} MB`);
  const kind = detectKind(file.name, file.type, file.bytes);
  if (!kind) throw new Error(`${file.name}: only Markdown (.md), plain text (.txt) and PDF files can be imported`);
  const sha256 = await sha256Hex(file.bytes);
  let text, warnings = [], pages = null, method, title = '';
  if (kind === 'pdf') {
    const r = await extractPdfText(file.bytes);
    ({ text, pages, method } = r); warnings = r.warnings;
    title = text.split('\n').map(s => s.trim()).find(s => s.length > 3)?.slice(0, 120) || '';
  } else {
    const r = decodeText(file.bytes);
    text = r.text; warnings = r.warnings; method = kind === 'markdown' ? 'utf-8 text (Markdown kept as written)' : 'utf-8 text';
    if (kind === 'markdown') title = markdownMeta(text).title;
  }
  const truncated = text.length > MAX_TEXT_CHARS;
  if (truncated) { text = text.slice(0, MAX_TEXT_CHARS); warnings.push(`Text view truncated to ${MAX_TEXT_CHARS.toLocaleString('en')} characters; the original file is complete.`); }
  const base = file.name.replace(/\.[^.]+$/, '');
  const mime = kind === 'pdf' ? 'application/pdf' : kind === 'markdown' ? 'text/markdown' : 'text/plain';
  return {
    data: {
      title: title || base || 'Imported file', source: file.name, original: text, stage: 'OBSERVED', status: 'NEW', evidence: 'UNREVIEWED',
      tags: ['imported', kind],
      notes: 'Imported from a file. Replace "Source" with a full citation (author, year, title, publisher).',
      file: { name: file.name, size: file.bytes.length, mime, kind, sha256, lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : '',
        extraction: { method, pages, chars: text.length, truncated, warnings } },
    },
    original: { sha256, mime, size: file.bytes.length, name: file.name, bytes: file.bytes },
  };
}

export function findImported(state, sha256) {
  return Object.values(state.entities.inbox).find(i => i.file?.sha256 === sha256) || null;
}

// ---------- export helpers (base64 without size limits)
export function toBase64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); }
export function fromBase64(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

/** Check exported originals: every one decodes and matches its hash. Returns the decoded list. */
export async function verifyOriginals(list = []) {
  const out = [];
  for (const o of list) {
    const bytes = fromBase64(o.base64 || '');
    const h = await sha256Hex(bytes);
    if (h !== o.sha256) throw new Error(`Original file ${o.name || o.sha256.slice(0, 12)} does not match its recorded hash`);
    out.push({ sha256: o.sha256, mime: o.mime, size: bytes.length, name: o.name, bytes });
  }
  return out;
}
