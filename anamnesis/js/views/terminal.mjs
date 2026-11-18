import { h } from '../ui.mjs';
import { runCommand } from '../core/terminal.mjs';

export function terminalView(ctx) {
  ctx.scratch.term ||= ['ANAMNESIS OS · BUILD 001 · terminal ready.', 'Type help for commands.'];
  ctx.scratch.hist ||= [];
  const screen = h('pre', { class: 'screen', 'aria-live': 'polite', role: 'log' }, ctx.scratch.term.join('\n'));
  let hi = ctx.scratch.hist.length;
  const inp = h('input', { class: 'prompt-in', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'send', 'aria-label': 'Command' });
  const exec = async line => {
    ctx.scratch.term.push('> ' + line);
    if (line.trim()) ctx.scratch.hist.push(line);
    const { out, actions } = runCommand(line, { state: ctx.state, events: ctx.events });
    ctx.scratch.term.push(...out);
    for (const a of actions) {
      if (a.type === 'clear') ctx.scratch.term = [];
      else if (a.type === 'dispatch') await ctx.dispatch(a.event, a.payload, { silent: true });
      else if (a.type === 'export') ctx.exportLog();
      else if (a.type === 'go') { ctx.go(a.route); return; }
    }
    ctx.scratch.term = ctx.scratch.term.slice(-400);
    ctx.rerender();
  };
  const form = h('form', { class: 'prompt', onsubmit: e => { e.preventDefault(); const v = inp.value; inp.value = ''; exec(v); } },
    h('span', { class: 'caret', 'aria-hidden': 'true' }, 'A:\\>'), inp, h('button', { type: 'submit', class: 'btn primary' }, 'Run'));
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && hi > 0) { hi--; inp.value = ctx.scratch.hist[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hi = Math.min(ctx.scratch.hist.length, hi + 1); inp.value = ctx.scratch.hist[hi] || ''; e.preventDefault(); }
  });
  const quick = h('div', { class: 'chips' }, ['help', 'stats', 'intel', 'situations', 'decide ines 1', 'decide theo 1', 'log'].map(c =>
    h('button', { type: 'button', class: 'chip', onclick: () => exec(c) }, c)));
  queueMicrotask(() => { screen.scrollTop = screen.scrollHeight; if (!matchMedia('(pointer: coarse)').matches) inp.focus(); });
  return h('div', { class: 'single terminal' }, screen, form, quick);
}
