// Tiny DOM helpers. All user text goes through textContent; no innerHTML.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const panel = (title, ...body) => h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, title), ...body);

export function field(label, control, hint) {
  const id = control.id || ('f-' + Math.random().toString(36).slice(2, 9));
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export const input = (name, value = '', attrs = {}) => h('input', { name, value, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs });
export const textarea = (name, value = '', rows = 4, attrs = {}) => { const t = h('textarea', { name, rows, ...attrs }); t.value = value; return t; };

export function select(name, value, options) {
  const s = h('select', { name });
  for (const o of options) {
    const [v, label] = Array.isArray(o) ? o : [o, o];
    s.append(h('option', { value: v, selected: v === value ? 'selected' : null }, label));
  }
  s.value = value;
  return s;
}

export function slider(name, value, label) {
  const out = h('output', {}, Number(value).toFixed(2));
  const r = h('input', { type: 'range', name, min: 0, max: 1, step: 0.05, value, oninput: () => { out.textContent = Number(r.value).toFixed(2); } });
  return h('div', { class: 'slider' }, h('label', {}, label), r, out);
}

export function btn(label, onclick, cls = '', attrs = {}) {
  return h('button', { type: 'button', class: `btn ${cls}`.trim(), onclick, ...attrs }, label);
}

export function badge(text, kind = '') {
  return h('span', { class: `badge ${kind}`.trim() }, text);
}

export function table(headers, rows) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, headers.map(x => h('th', { scope: 'col' }, x)))),
    h('tbody', {}, rows.map(r => h('tr', {}, r.map(c => h('td', {}, c)))))));
}

export function formData(form) {
  const out = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') {
      (out[el.name] ||= []);
      if (el.checked) out[el.name].push(el.value);
    } else out[el.name] = el.value;
  }
  return out;
}

export const lines = text => String(text || '').split('\n').map(s => s.trim()).filter(Boolean);

/** "text | weight | tag tag" rows <-> objects. */
export function parseWeighted(text) {
  return lines(text).map(l => {
    const [t, w, tags] = l.split('|').map(s => (s || '').trim());
    return { text: t, weight: w === '' || w == null ? 0.5 : Number(w), tags: (tags || '').split(/[,\s]+/).filter(Boolean) };
  });
}
export const formatWeighted = arr => arr.map(g => `${g.text} | ${g.weight} | ${g.tags.join(' ')}`).join('\n');

export function fmtTime(iso) {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; }
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
