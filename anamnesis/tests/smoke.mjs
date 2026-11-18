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
