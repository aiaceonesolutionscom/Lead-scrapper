// Snapshot the local SQLite database to D:\...\backups\backup-YYYY-MM-DD-HH-mm\crm.db
// Usage: npm run backup
//
// Uses SQLite's `VACUUM INTO` so the copy is always a consistent, compacted
// single file -- safe to run while the backend is live (WAL mode allows a
// second reader connection), unlike a raw filesystem copy of crm.db which
// could grab a half-written WAL/SHM state.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dbPath = resolve(repoRoot, 'server', 'data', 'crm.db');
const backupsRoot = resolve(repoRoot, 'backups');

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function main() {
  if (!existsSync(dbPath)) {
    console.error(`No database found at ${dbPath} -- nothing to back up.`);
    process.exit(1);
  }

  const folder = resolve(backupsRoot, `backup-${timestamp()}`);
  mkdirSync(folder, { recursive: true });
  const dest = resolve(folder, 'crm.db');

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}';`);
  } finally {
    db.close();
  }

  const sizeMb = (statSync(dest).size / 1024 / 1024).toFixed(2);
  console.log(`Backup written: ${dest} (${sizeMb} MB)`);
}

main();
