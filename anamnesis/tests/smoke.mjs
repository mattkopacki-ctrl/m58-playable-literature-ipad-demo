// Browser smoke test: iPad viewport, every module, decision record + verify,
// simulation run, terminal command, persistence across reload.
// Usage: node tests/smoke.mjs <base-url> [screenshot-dir]
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');

const base = process.argv[2] || 'http://127.0.0.1:8058/';
const shots = process.argv[3] || null;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices['iPad Pro 11'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(base);
await page.getByRole('button', { name: 'Load SAMPLE project' }).click();
await page.waitForFunction(() => window.__anamnesis?.events.length >= 12);
const seeded = await page.evaluate(() => window.__anamnesis.events.length);
check('sample project loads', seeded === 12, `${seeded} events`);

const modules = ['library', 'inbox', 'analyzer', 'characters', 'worlds', 'plots', 'themes', 'simulator', 'intelligence', 'terminal'];
for (const m of modules) {
  await page.goto(base + '#/' + m);
  await page.waitForTimeout(150);
  const txt = await page.locator('main').innerText();
  check(`module ${m} renders`, txt.length > 20 && !/View error/.test(txt));
  if (shots && ['intelligence', 'terminal'].includes(m)) await page.screenshot({ path: `${shots}/ipad-${m}.png` });
}

await page.goto(base + '#/characters/character-ines');
await page.getByRole('button', { name: 'Decide ▸' }).click();
const verdict = await page.locator('.verdict').first().innerText();
check('decision lab computes a verdict', /Ines Varga chooses/.test(verdict), verdict);
check('decision trace includes logged fear term on cellar option', (await page.locator('.decision').first().textContent()).includes('triggers fear via [cellar, dark]'));
if (shots) await page.screenshot({ path: `${shots}/ipad-decision-lab.png`, fullPage: false });
await page.getByRole('button', { name: 'Record decision' }).click();
await page.waitForFunction(() => window.__anamnesis.state.decisions.length === 1);
await page.locator('details.option summary', { hasText: 'UNVERIFIED' }).first().click();
await page.getByRole('button', { name: 'Verify by replay' }).first().click();
await page.waitForFunction(() => window.__anamnesis.state.decisions[0].verifications.length === 1);
const ver = await page.evaluate(() => window.__anamnesis.state.decisions[0].verifications[0]);
check('recorded decision verifies by replay', ver.ok, ver.detail);

await page.goto(base + '#/simulator');
await page.getByRole('button', { name: 'Run simulation ▸' }).click();
await page.waitForFunction(() => window.__anamnesis.state.simruns.length === 1);
const simTxt = await page.locator('main').innerText();
check('simulation run recorded with divergence label', /DIVERGENT|CONVERGENT/.test(simTxt));
if (shots) await page.screenshot({ path: `${shots}/ipad-simulator.png` });

await page.goto(base + '#/inbox/inbox-new');
await page.getByRole('button', { name: 'TRIAGED', exact: true }).click();
await page.waitForFunction(() => window.__anamnesis.state.entities.inbox['inbox-new'].status === 'TRIAGED');
check('inbox triage writes an event', true);

await page.goto(base + '#/terminal');
await page.locator('.prompt-in').fill('new theme Salt and silence');
await page.locator('.prompt-in').press('Enter');
await page.waitForFunction(() => Object.values(window.__anamnesis.state.entities.theme).some(t => t.name === 'Salt and silence'));
check('terminal creates entity', true);

await page.goto(base + '#/analyzer/library-ch1');
const anl = await page.locator('main').innerText();
check('analyzer shows metrics', /WORDS/i.test(anl) && /Flesch/i.test(anl));
if (shots) await page.screenshot({ path: `${shots}/ipad-analyzer.png` });

await page.goto(base + '#/characters/character-theo');
check('character shows linked research backlink', (await page.locator('.research-links').innerText()).includes('Biased retellings'));
await page.goto(base + '#/themes/theme-unreliable');
check('theme shows linked research backlink', (await page.locator('.research-links').innerText()).includes('Established'));

// Conversation: Ines tells Theo; Theo holds it as hearsay and his belief moves.
await page.goto(base + '#/characters/character-ines');
await page.locator('select[name="listener"]').selectOption('character-theo');
await page.locator('select[name="memory"]').selectOption('mem-ines-2');
await page.locator('textarea[name="asTold"]').fill('Something came up from the cellar for me');
await page.locator('form:has(select[name="listener"]) input[name="claim"]').fill('The house is wrong');
await page.getByRole('button', { name: 'Tell ▸' }).click();
await page.waitForFunction(() => window.__anamnesis.state.conversations.length === 1);
const theoMem = await page.evaluate(() => window.__anamnesis.state.entities.character['character-theo'].memories.filter(m => m.source === 'told').map(m => m.text));
check('conversation gives listener a "told" memory with the slanted words', theoMem.length === 1 && theoMem[0] === 'Something came up from the cellar for me', JSON.stringify(theoMem));
check('listener never receives the untold memory', await page.evaluate(() => !window.__anamnesis.state.entities.character['character-theo'].memories.some(m => m.text.includes('records basement'))));
await page.goto(base + '#/characters/character-theo');
check('listener memory table shows "told by Ines"', (await page.locator('main').innerText()).includes('told by Ines Varga'));
// Belief update from evidence, with perseverance shown.
await page.locator('form:has(select[name="source"]) input[name="claim"]').fill('Everything here has a mechanical explanation');
await page.locator('form:has(select[name="source"]) select[name="direction"]').selectOption('-1');
await page.getByRole('button', { name: 'Apply evidence' }).click();
await page.waitForFunction(() => window.__anamnesis.state.beliefUpdates.length === 2);
const bel = await page.evaluate(() => window.__anamnesis.state.beliefUpdates.at(-1));
check('belief update lowers confidence and logs perseverance', bel.after < bel.before && bel.terms.some(t => t.label === 'perseverance' && t.value < 1), `${bel.before} → ${bel.after}`);
if (shots) await page.screenshot({ path: `${shots}/ipad-beliefs-conversations.png`, fullPage: true });
await page.goto(base + '#/terminal');
await page.locator('.prompt-in').fill('tell theo ines 1 48');
await page.locator('.prompt-in').press('Enter');
await page.waitForTimeout(300);
check('terminal refuses an unrecallable memory (feasibility)', (await page.locator('.screen').innerText()).includes('cannot tell'));

// Research progression: gate blocks, then passes after the hypothesis is saved; original is preserved.
await page.goto(base + '#/inbox/inbox-new');
await page.getByRole('button', { name: '2 Hypothesized' }).click();
check('research stage gate blocks without a hypothesis', (await page.locator('#status').innerText()).includes('needs a written hypothesis'));
await page.locator('textarea[name="hypothesis"]').fill('Returning to the cellar will not by itself bring the memory back.');
await page.locator('textarea[name="original"]').fill('Pasted source paragraph for the record.');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForFunction(() => window.__anamnesis.state.entities.inbox['inbox-new'].hypothesis.length > 0);
await page.getByRole('button', { name: '2 Hypothesized' }).click();
await page.waitForFunction(() => window.__anamnesis.state.entities.inbox['inbox-new'].stage === 'HYPOTHESIZED');
check('research item advances to HYPOTHESIZED once the hypothesis is saved', true);
check('original is shown read-only with capture time and digest', (await page.locator('main').innerText()).includes('read-only') && await page.locator('textarea[name="original"]').count() === 0);
await page.locator('form:has(select[name="category"]) input[name="note"]').fill('Place alone is a weak cue');
await page.getByRole('button', { name: '+ Add annotation' }).click();
await page.waitForFunction(() => window.__anamnesis.state.entities.inbox['inbox-new'].annotations.length === 1);
check('annotation added', true);
if (shots) await page.screenshot({ path: `${shots}/ipad-research.png` });

// Old House: install, advance, perception matrix, private knowledge, terminal parity.
await page.goto(base + '#/simulator');
await page.getByRole('button', { name: 'Install Old House ▸' }).click();
await page.waitForFunction(() => window.__anamnesis.state.entities.character['oh-june']);
await page.getByRole('button', { name: 'Advance one minute ▸' }).click();
await page.waitForFunction(() => window.__anamnesis.state.scenario?.tick === 1);
await page.waitForTimeout(200);
const ohTxt = await page.locator('main').innerText();
check('Old House tick 1: clock, residents and knowledge matrix shown', /02:13/.test(ohTxt) && /AWAKE/.test(ohTxt) && /WHO KNOWS WHAT/i.test(ohTxt) && /told by Daniel/.test(ohTxt), ohTxt.slice(0, 200));
await page.getByRole('button', { name: 'Run to 02:20' }).click();
await page.waitForFunction(() => window.__anamnesis.state.scenario?.tick === 8);
const oh = await page.evaluate(() => { const s = window.__anamnesis.state; const cast = ['mara', 'daniel', 'elise', 'thomas', 'june'].map(n => s.entities.character['oh-' + n]);
  return { rejected: s.rejected.length, keyHolders: cast.filter(c => c.memories.some(m => m.tags.includes('key'))).map(c => c.name),
    leak: cast.some(c => c.memories.some(m => /Source unknown|inner face/.test(m.text))), eliseTold: cast[2].memories.some(m => m.source === 'told' && m.from === 'oh-daniel'), runs: s.simruns.filter(r => r.scenarioId === 'oldhouse').length }; });
check('Old House ran to 02:20 with no rejected events', oh.rejected === 0 && oh.runs === 8, JSON.stringify(oh));
check('Old House privacy: only Daniel knows the key; no truth leak; Elise knows by hearsay', oh.keyHolders.join() === 'Daniel Hale' && !oh.leak && oh.eliseTold);
await page.waitForTimeout(200);
if (shots) await page.screenshot({ path: `${shots}/ipad-oldhouse.png` });
await page.goto(base + '#/terminal');
await page.locator('.prompt-in').fill('inspect elise');
await page.locator('.prompt-in').press('Enter');
await page.waitForTimeout(200);
check('terminal inspect shows hearsay source', (await page.locator('.screen').innerText()).includes('told by Daniel Hale'));

// Draft protection: typed text survives an unrelated re-render, then saves cleanly.
await page.goto(base + '#/characters/character-theo');
await page.locator('input[name="role"]').fill('Engineer with a secret');
await page.getByRole('button', { name: 'Decide ▸' }).click();
const kept = await page.locator('input[name="role"]').inputValue();
check('unsaved edit survives re-render', kept === 'Engineer with a secret', kept);
check('unsaved-changes bar shown', await page.locator('.draft-bar').count() === 1);
await page.getByRole('button', { name: 'Save character' }).click();
await page.waitForFunction(() => window.__anamnesis.state.entities.character['character-theo'].role === 'Engineer with a secret');
check('save clears draft bar', await page.locator('.draft-bar').count() === 0);

// Offline: service worker caches the shell; app reloads with network cut.
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller);
await context.setOffline(true);
await page.reload();
await page.waitForFunction(() => window.__anamnesis?.events);
check('app shell loads offline (service worker)', (await page.locator('#nav a').count()) === 10);
await context.setOffline(false);

const before = await page.evaluate(() => window.__anamnesis.events.length);
await page.reload();
await page.waitForFunction(() => window.__anamnesis?.events);
const after = await page.evaluate(() => window.__anamnesis.events.length);
const rejected = await page.evaluate(() => window.__anamnesis.state.rejected.length);
check('IndexedDB persists across reload', before === after && after > seeded, `${before} → ${after}, rejected ${rejected}`);
check('storage backend is IndexedDB', await page.evaluate(() => window.__anamnesis.log.kind === 'indexeddb'));

const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('no horizontal page overflow (iPad)', !overflow);
const small = await page.evaluate(() => [...document.querySelectorAll('button, .nav a')].filter(el => { const r = el.getBoundingClientRect(); return r.width && r.height < 36; }).length);
check('touch targets ≥ 36px', small === 0, `${small} small`);

// Phone-width sanity
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '#/characters/character-theo');
await page.waitForTimeout(200);
const overflowPhone = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check('no horizontal overflow at 390px', !overflowPhone);
if (shots) await page.screenshot({ path: `${shots}/phone-character.png` });

check('no console/page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
