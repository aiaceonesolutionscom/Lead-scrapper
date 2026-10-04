// Repair UTF-8 text that was read as Windows-1252 ("mojibake").
//
// PowerShell 5.1's Get-Content defaults to the ANSI code page, so a UTF-8 file
// containing an em-dash (E2 80 94) came back as the three characters
// "â€”". Writing that back out destroyed the original bytes.
//
// This reverses the damage: every run of characters that maps back to
// high (>= 0x80) cp1252 bytes is re-decoded as UTF-8. A replacement is only
// kept when the result is valid UTF-8 containing no U+FFFD, so real text is
// never altered.
//
// Usage: node scripts/fix-mojibake.mjs <file...>          (dry run: report)
//        node scripts/fix-mojibake.mjs --write <file...>   (rewrite files)
import { readFileSync, writeFileSync } from 'node:fs';

// Windows-1252 differs from Latin-1 only in 0x80-0x9F.
const HIGH = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

// A run is at most 3 chars: the longest UTF-8 sequence we care about is 3 bytes
// (e.g. the em-dash), and each of those bytes is one cp1252 char.
function decodeRun(run) {
  const bytes = [];
  for (const ch of run) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x80 && cp <= 0xff) bytes.push(cp);
    else if (HIGH[cp] !== undefined) bytes.push(HIGH[cp]);
    else return null;
  }
  const text = Buffer.from(bytes).toString('utf8');
  // Reject anything that did not round-trip cleanly.
  if (text.includes('\uFFFD')) return null;
  return text;
}

function isHigh(ch) {
  const cp = ch.codePointAt(0);
  return cp >= 0x80 && cp <= 0xff ? true : HIGH[cp] !== undefined;
}

function fix(text) {
  let out = '';
  let i = 0;
  let changes = 0;
  while (i < text.length) {
    if (!isHigh(text[i])) { out += text[i]; i++; continue; }
    // Greedily take the longest run that decodes to valid UTF-8.
    let done = false;
    for (let len = Math.min(3, text.length - i); len >= 2; len--) {
      const run = text.slice(i, i + len);
      if (![...run].every(isHigh)) continue;
      const decoded = decodeRun(run);
      if (decoded !== null) {
        out += decoded;
        i += len;
        changes++;
        done = true;
        break;
      }
    }
    if (!done) { out += text[i]; i++; }
  }
  return { out, changes };
}

const write = process.argv.includes('--write');
const files = process.argv.slice(2).filter((a) => a !== '--write');
let total = 0;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const { out, changes } = fix(before);
  total += changes;
  if (!changes) { console.log(`${file}: nothing to fix`); continue; }
  console.log(`${file}: fixed ${changes} mojibake sequence(s)`);
  if (write) writeFileSync(file, out, 'utf8');
}
console.log(`\ntotal: ${total}${write ? ' (written)' : ' (dry run - rerun with --write)'}`);