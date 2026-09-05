// Import the exported Supabase JSON into the local SQLite backend.
// Usage: npm run import:local  (reads server/data/supabase-export.json)
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dataDir = resolve(repoRoot, 'server', 'data');
const dbPath = resolve(dataDir, 'crm.db');
const exportFile = resolve(dataDir, 'supabase-export.json');

interface Row { id?: string; [k: string]: unknown }

function toBool(v: unknown): number {
  return v == null ? 0 : (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
}

function main() {
  const raw = JSON.parse(readFileSync(exportFile, 'utf8'));
  const D = raw as {
    searches: Row[]; leads: Row[]; lead_sources: Row[];
    search_leads: Row[]; lead_notes: Row[];
  };

  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  // Ensure schema exists.
  const schema = readFileSync(resolve(repoRoot, 'server', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);

  const t0 = Date.now();
  db.exec('BEGIN');

  const upsert = (table: string, row: Row, booleans: string[] = []) => {
    const id = (row as { id: string }).id;
    if (!id) return;
    const entries = Object.entries(row).filter(([k]) => k !== 'id');
    const cols = [...entries.map(([k]) => k)];
    const placeholders = cols.map(() => '?').join(', ');
    const vals = entries.map(([k, v]) =>
      booleans.includes(k) ? toBool(v) : v == null ? null : (typeof v === 'boolean' ? toBool(v) : v)
    );
    db.prepare(
      `INSERT OR REPLACE INTO ${table} (id, ${cols.join(', ')}) VALUES (?, ${placeholders})`
    ).run(id, ...vals);
  };

  for (const s of D.searches) {
    upsert('searches', s, ['discovered_count', 'enriched_count']);
    // Normalize status
    const sid = s.id;
    const status = String(s.status || 'pending');
    db.prepare('UPDATE searches SET status = ? WHERE id = ?').run(status, sid);
  }
  for (const l of D.leads) {
    upsert('leads', l, ['phone_valid', 'verified']);
  }
  for (const src of D.lead_sources) upsert('lead_sources', src);
  for (const sl of D.search_leads) upsert('search_leads', sl);
  for (const n of D.lead_notes) upsert('lead_notes', n);

  db.exec('COMMIT');

  const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  console.log('Import complete in', `${Date.now() - t0}ms`);
  console.log('  searches    :', count('searches'));
  console.log('  leads       :', count('leads'));
  console.log('  lead_sources:', count('lead_sources'));
  console.log('  search_leads:', count('search_leads'));
  console.log('  lead_notes  :', count('lead_notes'));
  console.log('DB:', dbPath);
}

main();