'use strict';
// Dependency-free lint stage: syntax-checks every JavaScript file and flags debug leftovers.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = ['server.js', 'src', 'tests', 'scripts', 'public'];
const files = [];
(function walk(p) {
  if (!fs.existsSync(p)) return;
  if (p.includes('node_modules') || p.includes('.git')) return;
  if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((f) => walk(path.join(p, f)));
  else if (p.endsWith('.js')) files.push(p);
})('.');
let failed = 0;
for (const f of files.filter((f) => roots.some((r) => f === r || f.startsWith(r + path.sep)) && !f.includes('node_modules'))) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  const src = fs.readFileSync(f, 'utf8');
  if (r.status !== 0) { failed += 1; console.error(`SYNTAX ${f}\n${r.stderr}`); }
  if (/\bdebugger\b/.test(src)) { failed += 1; console.error(`DEBUGGER statement in ${f}`); }
}
console.log(`Linted ${files.length} files, ${failed} problem(s).`);
process.exit(failed ? 1 : 0);
