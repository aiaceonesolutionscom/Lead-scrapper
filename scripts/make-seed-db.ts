// Produce a consistent, self-contained snapshot of the live database for
// seed/crm.db. Uses SQLite's VACUUM INTO because the live database runs in WAL
// mode with a multi-megabyte -wal file: copying crm.db on its own would drop
// every write that has not been checkpointed yet.
//
// Usage: npx tsx scripts/make-seed-db.ts
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(repoRoot, 'server', 'data', 'crm.db');
const seedDir = resolve(repoRoot, 'seed');
const dest = resolve(seedDir, 'crm.db');

if (!existsSync(src)) throw new Error(`No database at ${src}`);
mkdirSync(seedDir, { recursive: true });
for (const f of [dest, `${dest}-wal`, `${dest}-shm`]) if (existsSync(f)) rmSync(f);

const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();

const out = new DatabaseSync(dest, { readOnly: true });
const counts = (['leads', 'searches', 'search_leads', 'lead_sources', 'users'] as const).map(
  (t) => `${t}=${(out.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c}`
);
console.log(`seed/crm.db written -> ${counts.join(' ')}`);
console.log('integrity:', Object.values(out.prepare('PRAGMA integrity_check').get() as Record<string, unknown>)[0]);
out.close();
