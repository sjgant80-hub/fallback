#!/usr/bin/env node
// Inline the witness-gated kernel into the page between the /* KERNEL-BEGIN */ markers, so the refund
// engine that runs is the exact engine that was proven. Idempotent (a fixpoint); CI diffs the rebuild.
import { readFileSync, writeFileSync } from 'node:fs';
const OPEN = '/* KERNEL-BEGIN */', CLOSE = '/* KERNEL-END */';
const kernel = readFileSync(new URL('./kernel.mjs', import.meta.url), 'utf8')
  .replace(/^export default[\s\S]*?;\s*$/m, '')                 // drop the default re-export
  .replace(/^export (function|const|async function)/gm, '$1')  // strip the export keyword
  .replace(/\r\n/g, '\n').trimEnd();
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const a = html.indexOf(OPEN), b = html.indexOf(CLOSE);
if (a < 0 || b < 0 || b < a) { console.error('kernel markers missing'); process.exit(1); }
const out = html.slice(0, a + OPEN.length) + '\n' + kernel + '\n' + html.slice(b);
writeFileSync(new URL('./index.html', import.meta.url), out);
for (const fn of ['function detectFindings', 'function parseCSV', 'const KNOWN_SUBS', 'function sealFindings', 'function verifyFindings']) {
  if (!out.includes(fn)) { console.error('the page does not contain ' + fn); process.exit(1); }
}
if (/\bexport\s/.test(out.slice(a, out.indexOf(CLOSE)))) { console.error('module syntax survived into the page'); process.exit(1); }
console.log('kernel injected: ' + kernel.length + ' chars');
