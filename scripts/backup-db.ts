// Snapshot the local SQLite database to BACKUP_ROOT\backup-YYYY-MM-DD-HH-mm\crm.db
// Usage: npm run backup
//   BACKUP_ROOT env (default: <repo>\backups) — output folder
//   BACKUP_KEEP  env (default: 14) — number of newest backups to keep
//
// The default lives inside the repo so a fresh clone on any drive backs up
// correctly out of the box; the old "D:\CRM Backups\leadlead" default made
// backup/restore fail on every machine without a D: drive.
//
// Uses SQLite's `VACUUM INTO` so the copy is always a consistent, compacted
// single file -- safe to run while the backend is live (WAL mode allows a
// second reader connection), unlike a raw filesystem copy of crm.db which
// could grab a half-written WAL/SHM state.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dbPath = resolve(repoRoot, 'server', 'data', 'crm.db');
const backupsRoot = process.env.BACKUP_ROOT
  ? resolve(process.env.BACKUP_ROOT)
  : resolve(repoRoot, 'backups');
const keepCount = Number(process.env.BACKUP_KEEP || 14) || 14;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function rotate() {
  if (!existsSync(backupsRoot)) return;
  const backups = readdirSync(backupsRoot)
    .filter((name) => /^backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(name))
    .sort()
    .reverse();
  for (const old of backups.slice(keepCount)) {
    const full = join(backupsRoot, old);
    rmSync(full, { recursive: true, force: true });
    console.log(`Removed old backup: ${basename(full)}`);
  }
}

function main() {
  if (!existsSync(dbPath)) {
    console.error(`No database found at ${dbPath} -- nothing to back up.`);
    process.exit(1);
  }

  mkdirSync(backupsRoot, { recursive: true });
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
  rotate();
}

main();
