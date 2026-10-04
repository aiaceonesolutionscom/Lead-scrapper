// Report every corrupted character in the given files. Run with Node, not
// PowerShell: PowerShell 5.1 reads files as cp1252 and corrupts UTF-8, which
// is what created these bugs in the first place.
// Usage: node scripts/find-mojibake.mjs <file...>
import { readFileSync } from 'node:fs';

const BAD = /[�â€]/g;
let total = 0;

for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const hits = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(BAD)) {
      const code = m[0].codePointAt(0);
      hits.push({ n: i + 1, bad: m[0], code: code.toString(16).toUpperCase(), line: line });
    }
  });
  if (!hits.length) { console.log(`${file}: clean`); continue; }
  console.log(`${file}: ${hits.length} bad char(s)`);
  for (const h of hits) {
    total++;
    console.log(`  line ${h.n}  U+${h.code} (${h.bad})`);
    console.log(`    ${h.line.trim()}`);
  }
}
console.log(`\ntotal: ${total}`);