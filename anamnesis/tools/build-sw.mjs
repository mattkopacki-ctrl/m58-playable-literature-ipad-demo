// Regenerates the service worker's file list and version (a hash of shipped content).
// Run after adding, removing or changing any shipped file:  npm run sw
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const walk = d => readdirSync(join(root, d)).flatMap(f => { const p = join(d, f); return statSync(join(root, p)).isDirectory() ? walk(p) : [p]; });
const files = ['index.html', 'manifest.webmanifest', ...['css', 'js', 'icons'].flatMap(walk)].sort();
const hash = createHash('sha256'); for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
const sw = readFileSync(join(root, 'sw.js'), 'utf8')
  .replace(/const VERSION = '[^']*';/, `const VERSION = 'anamnesis-shell-${hash.digest('hex').slice(0, 12)}';`)
  .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n    './',\n${files.map(f => `    './${f}',`).join('\n')}\n];`);
writeFileSync(join(root, 'sw.js'), sw);
console.log(`sw.js: ${files.length} files`);
