// Decrypt seed/crm.db.enc into the live database location.
//
// Called by scripts/install-config.ps1 during 1-INSTALL.BAT. The passphrase is
// read from SEED_DB_PASSWORD, which install-config.ps1 populates from an
// interactive prompt; it is never written to disk or passed on a command line
// where other processes could see it.
//
// Usage:
//   node scripts/decrypt-seed.mjs --dest server/data/crm.db
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decryptSeed, looksLikeSqlite } from './seed-crypto.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const srcPath = resolve(repoRoot, opt('--in', 'seed/crm.db.enc'));
const destPath = resolve(repoRoot, opt('--dest', 'server/data/crm.db'));
const passphrase = process.env.SEED_DB_PASSWORD;

if (!passphrase) {
  console.error('SEED_DB_PASSWORD is not set.');
  process.exit(1);
}

let plaintext;
try {
  plaintext = decryptSeed(readFileSync(srcPath), passphrase);
} catch (err) {
  console.error(`Decryption failed: ${err.message}`);
  process.exit(1);
}

if (!looksLikeSqlite(plaintext)) {
  console.error('Decrypted data is not a SQLite database - refusing to write it.');
  process.exit(1);
}

mkdirSync(dirname(destPath), { recursive: true });

// Write to a temporary file, verify it really is the CRM database, then move
// it into place. An interrupted install must never leave a half-written
// database in server\data, and a file that decrypts but has the wrong schema
// must never land there either.
const tmpPath = `${destPath}.tmp`;
writeFileSync(tmpPath, plaintext);

let leads = 0;
let users = 0;
try {
  const db = new DatabaseSync(tmpPath, { readOnly: true });
  leads = db.prepare('select count(*) c from leads').get().c;
  users = db.prepare('select count(*) c from users').get().c;
  db.close();
} catch (err) {
  console.error(`The decrypted file is not a usable CRM database: ${err.message}`);
  process.exit(1);
}

renameSync(tmpPath, destPath);
console.log(`  Decrypted seed database: ${leads} leads, ${users} users.`);