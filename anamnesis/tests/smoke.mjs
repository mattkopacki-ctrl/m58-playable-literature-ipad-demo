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

const modules = ['library', 'inbox', 'analyzer', 'characters', 'worlds', 'plots', 'themes', 'simulator', 'intelligence', 'terminal', 'monitor'];
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

// Research ingestion (T-026): import Markdown and PDF, provenance shown, original kept and verified.
const { deflateSync } = await import('node:zlib');
const pdfBody = deflateSync(Buffer.from('BT /F1 12 Tf 72 720 Td (Three knocks from the cellar.) Tj ET', 'latin1'));
const pdfBytes = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length ${pdfBody.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), pdfBody, Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')]);
const { createHash } = await import('node:crypto');
const pdfHash = createHash('sha256').update(pdfBytes).digest('hex');
await page.goto(base + '#/inbox');
await page.locator('.import-file input[type=file]').setInputFiles([
  { name: 'retelling-notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Retelling notes\n\nTheo changes his story after breakfast.\n') },
  { name: 'cellar-report.pdf', mimeType: 'application/pdf', buffer: pdfBytes }]);
await page.waitForFunction(() => Object.values(window.__anamnesis.state.entities.inbox).filter(i => i.file).length === 2);
const imp = await page.evaluate(() => Object.values(window.__anamnesis.state.entities.inbox).filter(i => i.file).map(i => ({ t: i.title, k: i.file.kind, h: i.file.sha256, o: i.original, st: i.stage })));
check('T-026: Markdown imported with its heading as title', imp.some(i => i.k === 'markdown' && i.t === 'Retelling notes' && i.o.includes('Theo changes his story')));
check('T-026: PDF text extracted and hash recorded', imp.some(i => i.k === 'pdf' && i.o.includes('Three knocks from the cellar.') && i.h === pdfHash), JSON.stringify(imp.map(i => i.o.slice(0, 40))));
const pdfItem = await page.evaluate(() => Object.values(window.__anamnesis.state.entities.inbox).find(i => i.file?.kind === 'pdf').id);
await page.goto(base + '#/inbox/' + pdfItem);
await page.getByRole('button', { name: 'Check original' }).click();
await page.waitForSelector('.file-check');
check('T-026: stored original verifies against its SHA-256', (await page.locator('.file-check').innerText()).includes('ORIGINAL VERIFIED'));
check('T-026: provenance panel shows file, hash and method', /cellar-report\.pdf/.test(await page.locator('main').innerText()) && (await page.locator('main').innerText()).includes(pdfHash));
if (shots) await page.screenshot({ path: `${shots}/ipad-import-pdf.png` });
await page.goto(base + '#/inbox');
await page.locator('.import-file input[type=file]').setInputFiles([{ name: 'again.pdf', mimeType: 'application/pdf', buffer: pdfBytes }]);
await page.waitForTimeout(400);
check('T-026: re-importing the same file is detected, not duplicated', (await page.locator('#status').innerText()).includes('already imported') && await page.evaluate(() => Object.values(window.__anamnesis.state.entities.inbox).filter(i => i.file).length) === 2);
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
const exported = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
check('T-026: export carries the original file bytes', (exported.originals || []).some(o => o.sha256 === pdfHash && Buffer.from(o.base64, 'base64').equals(pdfBytes)));

// Scenario Studio (T-028): author a scenario in the GUI, check, preview (nothing saved), run.
await page.goto(base + '#/simulator');
await page.getByRole('button', { name: '+ New scenario' }).click();
await page.waitForFunction(() => /#\/simulator\/scenario-/.test(location.hash));
const scnId = await page.evaluate(() => location.hash.split('/')[2]);
await page.locator('input[name="name"]').fill('Breakfast test');
await page.locator('input[name="cast"][value="character-ines"]').check();
await page.locator('select[name="place-character-ines"]').selectOption('Kitchen');
await page.locator('input[name="cast"][value="character-theo"]').check();
await page.locator('select[name="place-character-theo"]').selectOption('Front hall');
await page.getByRole('button', { name: '+ World event' }).click();
await page.waitForFunction(id => window.__anamnesis.state.entities.scenario[id].events.length === 1, scnId);
check('Studio: structural edit saved the cast typed before it', await page.evaluate(id => window.__anamnesis.state.entities.scenario[id].cast.length === 2 && window.__anamnesis.state.entities.scenario[id].name === 'Breakfast test', scnId));
check('Studio: incomplete event is reported, not run', (await page.locator('main').innerText()).includes('PROBLEM') && await page.getByRole('button', { name: 'Run one minute' }).isDisabled());
await page.locator('input[name="e-0-title"]').fill('A cup falls');
await page.locator('input[name="e-0-c-0-places"][value="Kitchen"]').check();
await page.locator('textarea[name="e-0-c-0-text"]').fill('A cup slid off the shelf and broke');
await page.locator('input[name="e-0-c-0-tags"]').fill('cup kitchen');
await page.getByRole('button', { name: 'Save scenario' }).click();
await page.waitForFunction(id => window.__anamnesis.state.entities.scenario[id].events[0].channels[0].text.length > 0, scnId);
check('Studio: scenario becomes READY TO RUN', (await page.locator('main').innerText()).includes('READY TO RUN'));
const evBeforePreview = await page.evaluate(() => window.__anamnesis.events.length);
await page.getByRole('button', { name: 'Preview (not saved) ▸' }).click();
await page.waitForSelector('.preview');
check('Studio: preview shows a timeline and writes nothing', (await page.locator('.preview').innerText()).includes('A cup falls') && evBeforePreview === await page.evaluate(() => window.__anamnesis.events.length));
if (shots) await page.screenshot({ path: `${shots}/ipad-studio-preview.png` });
await page.getByRole('button', { name: 'Run one minute' }).click();
await page.waitForFunction(id => window.__anamnesis.state.scenarios?.[id]?.tick === 1, scnId);
const inesSaw = await page.evaluate(() => window.__anamnesis.state.entities.character['character-ines'].memories.some(m => m.text === 'A cup slid off the shelf and broke'));
const theoSaw = await page.evaluate(() => window.__anamnesis.state.entities.character['character-theo'].memories.some(m => m.text === 'A cup slid off the shelf and broke'));
check('Studio: real run perceived only where authored (Ines in kitchen yes, Theo in hall no)', inesSaw && !theoSaw);
await page.goto(base + '#/simulator');
await page.getByRole('button', { name: 'Make an editable copy of the Old House' }).click();
await page.waitForFunction(() => /#\/simulator\/scenario-/.test(location.hash) && /editable copy/i.test(document.querySelector('main').innerText));
check('Studio: editable Old House copy passes its checks', (await page.locator('main').innerText()).includes('READY TO RUN'));
await page.goto(base + '#/terminal');
await page.locator('.prompt-in').fill('scenarios');
await page.locator('.prompt-in').press('Enter');
await page.waitForTimeout(200);
check('terminal lists authored scenarios', /2 authored scenario/.test(await page.locator('.screen').innerText()));

// Controlled comparisons (T-027): register, run in memory, reproduce, explain, conclude. Live project untouched.
await page.goto(base + '#/simulator');
const liveBefore = await page.evaluate(() => { const s = window.__anamnesis.state; return JSON.stringify([s.entities.character, s.scenarios, s.worldEvents.length, s.actions.length, s.simruns.length, s.conversations.length]); });
await page.getByRole('button', { name: 'Load the Old House example' }).click();
await page.waitForFunction(() => location.hash === '#/simulator/exp-new');
await page.waitForSelector('select[name="kind"]');
check('T-027: example draft passes its checks', (await page.locator('main').innerText()).includes('READY TO REGISTER'));
const evDraft = await page.evaluate(() => window.__anamnesis.events.length);
await page.locator('select[name="kind"]').selectOption('option.remove');
await page.locator('select[name="kind"]').selectOption('belief.set');
check('T-027: editing a draft writes nothing', evDraft === await page.evaluate(() => window.__anamnesis.events.length));
await page.locator('input[name="value"]').fill('0.2');
await page.getByRole('button', { name: 'Register (locks the definition) ▸' }).click();
await page.waitForFunction(() => /#\/simulator\/exp-[0-9a-f]+/.test(location.hash));
const expId = await page.evaluate(() => location.hash.split('exp-')[1]);
await page.getByRole('button', { name: 'Run in memory ▸' }).click();
await page.waitForFunction(id => window.__anamnesis.state.experiments[id].results.length === 1, expId, { timeout: 60000 });
const exr = await page.evaluate(id => { const r = window.__anamnesis.state.experiments[id].results[0].results; return { c: r.comparisons[0], d: r.resultDigest, base: r.baseSeq }; }, expId);
check('T-027: Old House experiment shows a measurable difference caused by the one change', exr.c.seedsWithAnyDifference > 0 && exr.c.firstDifference.characterId === 'oh-thomas' && exr.c.firstDifference.minute === 1, JSON.stringify(exr.c.firstDifference));
await page.getByRole('button', { name: 'Show why' }).click();
await page.waitForSelector('#why');
check('T-027: the difference is explained by the belief term', (await page.locator('#why').innerText()).includes('The noises are just the heating'));
if (shots) await page.screenshot({ path: `${shots}/ipad-comparison.png` });
await page.getByRole('button', { name: 'Run again (checks it reproduces) ▸' }).click();
await page.waitForFunction(id => window.__anamnesis.state.experiments[id].results.length === 2, expId, { timeout: 60000 });
check('T-027: re-run reproduces the first result exactly', await page.evaluate(id => window.__anamnesis.state.experiments[id].results[1].reproduced === true, expId));
await page.getByRole('button', { name: 'Recompute and show' }).click();
await page.waitForSelector('#inspect');
check('T-027: a single run can be inspected minute by minute', (await page.locator('#inspect').innerText()).includes('02:13'));
await page.locator('.form-plain select[name="verdict"]').selectOption('SUPPORTED');
await page.locator('.form-plain input[name="note"]').fill('Thomas skipped the heating test in most dice sets.');
await page.getByRole('button', { name: 'Record conclusion' }).click();
await page.waitForFunction(id => window.__anamnesis.state.experiments[id].conclusions.length === 1, expId);
const liveAfter = await page.evaluate(() => { const s = window.__anamnesis.state; return JSON.stringify([s.entities.character, s.scenarios, s.worldEvents.length, s.actions.length, s.simruns.length, s.conversations.length]); });
check('T-027: live characters, scenarios and story records are unchanged by the whole experiment', liveBefore === liveAfter);
const expTypes = await page.evaluate(n => [...new Set(window.__anamnesis.events.slice(n).map(e => e.type))].sort().join(','), evDraft);
check('T-027: only experiment events were written', expTypes === 'experiment.conclude,experiment.register,experiment.result', expTypes);

// Experimental mechanisms P1/P3 (OD-005): off by default, comparisons and Preview only, never in a saved run.
await page.goto(base + '#/simulator');
const mechLive = () => page.evaluate(() => { const s = window.__anamnesis.state; return JSON.stringify([s.entities.character, s.scenarios, s.worldEvents.length, s.actions.length, s.simruns.length, s.beliefUpdates.length, s.rejected.length]); });
const mechBefore = await mechLive();
const evMech = await page.evaluate(() => window.__anamnesis.events.length);
await page.getByRole('button', { name: 'Load the P1 fixture example' }).click();
await page.waitForSelector('#fixture-note');
const draftTxt = await page.locator('main').innerText();
check('P1/P3: the fixture comparison is labelled as a synthetic test fixture and passes its checks', /SYNTHETIC TEST FIXTURE/.test(draftTxt) && /not approved story content/.test(draftTxt) && draftTxt.includes('READY TO REGISTER'));
await page.getByRole('button', { name: 'Register (locks the definition) ▸' }).click();
await page.waitForFunction(() => /#\/simulator\/exp-[0-9a-f]+/.test(location.hash));
const mechId = await page.evaluate(() => location.hash.split('exp-')[1]);
await page.getByRole('button', { name: 'Run in memory ▸' }).click();
await page.waitForFunction(id => window.__anamnesis.state.experiments[id].results.length === 1, mechId, { timeout: 60000 });
const mr = await page.evaluate(id => { const r = window.__anamnesis.state.experiments[id].results[0].results; const late = v => v.aggregate.byMinute.slice(4).reduce((x, m) => x + m.activeShare, 0) / 4;
  return { a: late(r.variants[0]), b: late(r.variants[1]), ma: r.measures.variants.A.mechanisms, mb: r.measures.variants.B.mechanisms, loop: r.measures.variants.B.loopIndex.overall.index, ooc: r.measures.variants.B.outOfCharacter.map(x => x.runs), fixture: r.measures.fixture, digest: r.resultDigest }; }, mechId);
check('P1: in the browser, repeatable actions raise late activity (same numbers as the acceptance run)', Math.abs(mr.a - 0.225) < 1e-9 && Math.abs(mr.b - 0.435) < 1e-9, JSON.stringify(mr));
check('P1: control ran with the switch off, variant B with only P1 on; no must-not-happen action; loop index within the guide', !mr.ma.repeatableActions && !mr.ma.experienceBeliefs && mr.mb.repeatableActions && !mr.mb.experienceBeliefs && mr.ooc.every(n => n === 0) && mr.loop <= 0.10);
const measTxt = await page.locator('#mech-measures').innerText();
check('P1: the results screen shows the loop index, use counts and the fixture warning', /Loop index, all characters/.test(measTxt) && /SYNTHETIC TEST FIXTURE/.test(measTxt) && /Most times one character took the same action/.test(measTxt));
if (shots) { await page.locator('#mech-measures').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/ipad-mechanism-measures.png` }); }
await page.getByRole('button', { name: 'Run again (checks it reproduces) ▸' }).click();
await page.waitForFunction(id => window.__anamnesis.state.experiments[id].results.length === 2, mechId, { timeout: 60000 });
check('P1: the fixture comparison reproduces exactly on re-run', await page.evaluate(id => window.__anamnesis.state.experiments[id].results[1].reproduced === true, mechId));
const mechTypes = await page.evaluate(n => [...new Set(window.__anamnesis.events.slice(n).map(e => e.type))].sort().join(','), evMech);
check('P1/P3: the comparison wrote only its definition and results; the live project is unchanged', mechTypes === 'experiment.register,experiment.result' && mechBefore === await mechLive(), mechTypes);

// Studio: declare a repeat rule and evidence on the editable Old House copy, switch both on for Preview, then prove a real Run ignores them.
const copyId = await page.evaluate(() => Object.values(window.__anamnesis.state.entities.scenario).find(e => /editable copy/i.test(e.name)).id);
await page.goto(base + '#/simulator/' + copyId);
await page.waitForSelector('#mechanisms');
check('Studio: both experimental switches exist and are off by default', await page.evaluate(() => !document.querySelector('[name=mechP1]').checked && !document.querySelector('[name=mechP3]').checked) && !(await page.locator('#mech-note').count()));
await page.evaluate(() => document.querySelectorAll('details.option').forEach(d => { d.open = true; }));
const listenK = await page.evaluate(id => window.__anamnesis.state.entities.scenario[id].options.findIndex(o => o.label === 'Listen at the basement door'), copyId);
await page.locator(`input[name="o-${listenK}-repeatTag"]`).fill('listened');
await page.locator(`input[name="o-${listenK}-repeatCooldown"]`).fill('1');
await page.locator(`input[name="o-${listenK}-repeatMax"]`).fill('3');
await page.locator(`input[name="o-${listenK}-repeatReopen"]`).fill('knock');
await page.locator('input[name="e-1-c-0-evidence"]').fill('-0.7 The noises are just the heating; +0.6 Something is in the basement');
await page.locator('input[name="e-1-c-1-evidence"]').fill('-0.4 The noises are just the heating');
await page.locator('[name=mechP1]').check();
await page.locator('[name=mechP3]').check();
await page.getByRole('button', { name: 'Save scenario' }).click();
await page.waitForFunction(id => window.__anamnesis.state.entities.scenario[id].mechanisms?.experienceBeliefs === true, copyId);
check('Studio: a repeat pause shorter than 2 minutes is refused in plain words', /repeat cooldown must be 2 to 240 minutes \(it is 1\)/.test(await page.locator('main').innerText()));
await page.evaluate(() => document.querySelectorAll('details.option').forEach(d => { d.open = true; }));
await page.locator(`input[name="o-${listenK}-repeatCooldown"]`).fill('2');
await page.getByRole('button', { name: 'Save scenario' }).click();
await page.waitForFunction(([id, k]) => window.__anamnesis.state.entities.scenario[id].options[k].repeat?.cooldown === 2, [copyId, listenK]);
const saved = await page.evaluate(([id, k]) => { const e = window.__anamnesis.state.entities.scenario[id]; return { repeat: e.options[k].repeat, ev: e.events[1].channels[0].evidence, mech: e.mechanisms }; }, [copyId, listenK]);
check('Studio: repeat rule, evidence and switches are saved as typed', JSON.stringify(saved.repeat) === JSON.stringify({ tag: 'listened', cooldown: 2, maxUses: 3, reopenOn: ['knock'] }) && saved.ev.length === 2 && saved.ev[0].direction === -1 && saved.ev[0].strength === 0.7 && saved.mech.repeatableActions && saved.mech.experienceBeliefs, JSON.stringify(saved));
const noteTxt = await page.locator('#mech-note').innerText();
check('Studio: says the switches are for Preview only and Run ignores them', /Preview only/.test(noteTxt) && /Run always ignores/.test(noteTxt) && (await page.locator('main').innerText()).includes('READY TO RUN'));
const evPv = await page.evaluate(() => window.__anamnesis.events.length);
await page.getByRole('button', { name: 'Preview (not saved) ▸' }).click();
await page.waitForSelector('#pv-mech');
const pvTxt = await page.locator('.preview').innerText();
check('Studio: Preview runs with the mechanisms on, shows the loop index, and writes nothing', /EXPERIMENTAL MECHANISMS ON IN THIS PREVIEW/.test(pvTxt) && /Loop index/.test(pvTxt) && evPv === await page.evaluate(() => window.__anamnesis.events.length));
check('Studio: Preview lists beliefs changed by experience with the memory that caused each', (await page.locator('#pv-beliefs').count()) === 1 && /→/.test(await page.locator('#pv-beliefs').innerText()), (await page.locator('#pv-beliefs').count()) ? (await page.locator('#pv-beliefs').innerText()).slice(0, 200) : 'no belief table');
if (shots) { await page.locator('#pv-mech').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${shots}/ipad-studio-mechanism-preview.png` }); }
await page.getByRole('button', { name: 'Run to end' }).click();
await page.waitForFunction(id => window.__anamnesis.state.scenarios[id]?.tick === 8, copyId, { timeout: 60000 });
const liveRun = await page.evaluate(([id, n]) => { const a = window.__anamnesis; const evs = a.events.slice(n);
  return { mech: evs.some(e => e.payload.mechanisms || e.payload.situation?.mechanisms), exp: evs.some(e => e.type === 'belief.update'), engines: [...new Set(evs.filter(e => e.type === 'sim.run').flatMap(e => e.payload.decisions.map(d => d.engine)))],
    repeatSeen: JSON.stringify(evs).includes('"repeat"'), pinned: a.state.scenarios[id].mechanisms || null, rejected: a.state.rejected.length,
    listens: Object.values(evs.filter(e => e.type === 'world.act' && e.payload.optionId && e.payload.label === 'Listen at the basement door').reduce((m, e) => { m[e.payload.characterId] = (m[e.payload.characterId] || 0) + 1; return m; }, {})) }; }, [copyId, evPv]);
check('OD-005: a real Run with both switches ticked is made without them (no mechanism on the run, no experience updates, plain engine id, nobody repeats)',
  !liveRun.mech && !liveRun.exp && !liveRun.repeatSeen && liveRun.pinned === null && liveRun.engines.join() === 'anamnesis-decide-3' && liveRun.listens.every(n => n === 1) && liveRun.rejected === 0, JSON.stringify(liveRun));

// System Monitor: integrity checks read-only and pass.
await page.goto(base + '#/monitor');
const evBefore = await page.evaluate(() => window.__anamnesis.events.length);
await page.getByRole('button', { name: 'Verify stored log' }).click();
await page.waitForSelector('#verify-log');
check('System Monitor: stored log verifies against on-screen state', (await page.locator('#verify-log').innerText()).includes('LOG OK'), await page.locator('#verify-log').innerText());
await page.getByRole('button', { name: 'Verify every decision by replay' }).click();
await page.waitForSelector('#verify-dec');
const decTxt = await page.locator('#verify-dec').innerText();
check('System Monitor: every recorded decision recomputes identically', /DECISIONS OK/.test(decTxt) && /(\d+) of \1 recomputed/.test(decTxt), decTxt);
check('System Monitor checks write nothing to the log', evBefore === await page.evaluate(() => window.__anamnesis.events.length));
await page.getByRole('button', { name: 'Verify original files' }).click();
await page.waitForSelector('#verify-files');
check('System Monitor: imported originals present and unchanged', (await page.locator('#verify-files').innerText()).includes('ORIGINALS OK'), await page.locator('#verify-files').innerText());
if (shots) await page.screenshot({ path: `${shots}/ipad-monitor.png` });
// Theme: navy by default, phosphor optional, choice survives reload.
const bgOf = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('default theme is navy', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'navy' && (await bgOf()) === 'rgb(13, 18, 32)', await bgOf());
await page.locator('select[name="theme"]').selectOption('phosphor');
check('green phosphor theme can be selected', (await bgOf()) === 'rgb(11, 15, 12)', await bgOf());
if (shots) await page.screenshot({ path: `${shots}/ipad-monitor-phosphor.png` });
await page.reload(); await page.waitForFunction(() => window.__anamnesis?.events);
check('theme choice survives reload', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'phosphor');
await page.locator('select[name="theme"]').selectOption('navy');


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
check('app shell loads offline (service worker)', (await page.locator('#nav a').count()) === 11);
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

// Database upgrade: a project saved by the schema-1 build opens in schema 2 with nothing lost.
{
  const ctx2 = await browser.newContext({ ...devices['iPad Pro 11'] });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push('upgrade: ' + e.message));
  await p2.goto(base + 'manifest.webmanifest');
  await p2.evaluate(() => new Promise((res, rej) => {
    const r = indexedDB.open('anamnesis-os', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('events', { keyPath: 'seq' });
    r.onsuccess = () => { const tx = r.result.transaction('events', 'readwrite');
      tx.objectStore('events').add({ seq: 1, type: 'entity.create', at: '2026-11-18T00:00:00.000Z', payload: { kind: 'world', id: 'w-old', data: { name: 'Saved before the upgrade', places: ['Hall'] } } });
      tx.objectStore('events').add({ seq: 2, type: 'system.note', at: '2026-11-18T00:00:01.000Z', payload: { text: 'v1 note' } });
      tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
    r.onerror = () => rej(r.error);
  }));
  await p2.goto(base + '?nosw#/worlds');
  await p2.waitForFunction(() => window.__anamnesis?.events);
  const up = await p2.evaluate(async () => ({ n: window.__anamnesis.events.length, w: window.__anamnesis.state.entities.world['w-old']?.name, kind: window.__anamnesis.log.kind,
    stores: await new Promise(r => { const o = indexedDB.open('anamnesis-os'); o.onsuccess = () => { r([...o.result.objectStoreNames]); o.result.close(); }; }) }));
  check('schema-1 database upgrades to schema 2 with every event kept', up.n === 2 && up.w === 'Saved before the upgrade' && up.kind === 'indexeddb' && up.stores.includes('originals'), JSON.stringify(up));
  await ctx2.close();
}

check('no console/page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
