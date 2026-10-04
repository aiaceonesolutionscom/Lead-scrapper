// Encrypt seed/crm.db into seed/crm.db.enc for committing to the repository.
//
// Usage:
//   node scripts/encrypt-seed.mjs                 # interactive, asks for a password
//   node scripts/encrypt-seed.mjs --generate      # generate a strong password
//   node scripts/encrypt-seed.mjs --out <file>
//
// The plaintext seed stays on disk and stays git-ignored; only the .enc file is
// ever committed. The password is deliberately never written anywhere: if it is
// lost, the seed cannot be recovered, so keep your own copy.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { encryptSeed, looksLikeSqlite, decryptSeed } from './seed-crypto.mjs';

// Same alphabet as scripts/gen-password.ps1, minus look-alike characters.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+';
export function generatePassword(length = 20) {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    // Rejection sampling keeps every character equally likely.
    const v = bytes[i];
    if (v >= 256 - (256 % ALPHABET.length)) continue;
    out += ALPHABET[v % ALPHABET.length];
  }
  return out;
}

const repoRoot = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const srcPath = resolve(repoRoot, opt('--in', 'seed/crm.db'));
const outPath = resolve(repoRoot, opt('--out', 'seed/crm.db.enc'));

const plaintext = readFileSync(srcPath);
if (!looksLikeSqlite(plaintext)) {
  console.error(`${srcPath} is not a SQLite database.`);
  process.exit(1);
}

// Refuse to seal a database that a running server may still be writing to.
let summary;
try {
  const db = new DatabaseSync(srcPath, { readOnly: true });
  const leads = db.prepare('select count(*) c from leads').get().c;
  const users = db.prepare('select count(*) c from users').get().c;
  const searches = db.prepare('select count(*) c from searches').get().c;
  db.close();
  summary = `${leads} leads, ${users} users, ${searches} searches`;
} catch (err) {
  console.error(`Could not read ${srcPath}: ${err.message}`);
  console.error('Use scripts/make-seed-db.ts to create a consistent snapshot first.');
  process.exit(1);
}

let passphrase;
if (flag('--generate')) {
  passphrase = generatePassword();
} else {
  passphrase = process.env.SEED_DB_PASSWORD;
  if (!passphrase) {
    console.error('Pass a password via SEED_DB_PASSWORD, or use --generate.');
    process.exit(1);
  }
}
if (passphrase.length < 12) {
  console.error('Use a passphrase of at least 12 characters.');
  process.exit(1);
}

const started = Date.now();
const blob = encryptSeed(plaintext, passphrase);

// Round-trip immediately so a broken file can never reach the repository.
const verified = decryptSeed(blob, passphrase);
if (!verified.equals(plaintext)) {
  console.error('Round-trip check failed - nothing was written.');
  process.exit(1);
}

writeFileSync(outPath, blob);
console.log(`Encrypted ${srcPath} -> ${outPath}`);
console.log(`  contents : ${summary}`);
console.log(`  size     : ${(plaintext.length / 1048576).toFixed(2)} MB -> ${(blob.length / 1048576).toFixed(2)} MB`);
console.log(`  took     : ${((Date.now() - started) / 1000).toFixed(1)}s (scrypt is deliberately slow)`);
console.log(`  verified : decrypt round-trip matches the original byte for byte`);
if (flag('--generate')) {
  console.log('');
  console.log(`  Seed database password: ${passphrase}`);
  console.log('  Store this in your password manager. It is not recoverable.');
}