import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { enrichBusiness } from '../src/lib/extraction/enrichment';
import type { DiscoveryBusiness, EnrichedBusiness } from '../src/types';

// Re-pushes the batch of leads that were written with the old, lenient
// enrichment (the "Shadi halls / Karachi" run of 2026-09-07 12:01 UTC). Those
// leads got: wrong-country phones (HK/US), 12-digit "+92 ..." garbage,
// foreign-brand websites (regenthotels.com, fairmont.com, galaxycine.vn…), and
// socials leaking from those wrong brands.
//
// Option (b): re-run enrichment IN PLACE — keep the lead rows, rediscover the
// real phone/website/socials with the new STRICT rules, and overwrite the
// contact data. Nothing is deleted.

// Run from the repo root so browser.ts resolves its profile dir (.runtime)
// exactly like the live backend does (solo mode reuses the warm profile).
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
process.chdir(repoRoot);

const dbPath = join(repoRoot, 'server', 'data', 'crm.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA journal_mode = WAL');

// Only the batch the user reported, narrowed to rows that are STILL suspicious
// (wrong-country or implausibly long phone). Never-touched leads stay included
// regardless of how old/new their updated_at is; clean ones are skipped.
const FROM = '2026-09-07T12:00:00.000Z';
const TO = '2026-09-07T13:00:00.000Z';

interface LeadRow {
  id: string;
  business_name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  country_code: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  category: string | null;
}

function rowToDiscovery(row: LeadRow): DiscoveryBusiness {
  return {
    name: row.business_name,
    address: row.address || undefined,
    city: row.city || undefined,
    country: row.country || undefined,
    country_code: row.country_code || undefined,
    website: row.website || undefined,
    phone: row.phone || undefined,
    email: row.email || undefined,
    instagram: row.instagram || undefined,
    facebook: row.facebook || undefined,
    linkedin: row.linkedin || undefined,
    category: row.category || undefined,
    source: 're-enrich',
  };
}

const short = (v: string | null | undefined, n = 52) => {
  if (!v) return '—';
  return v.length > n ? v.slice(0, n - 1) + '…' : v;
};

const update = db.prepare(
  `UPDATE leads SET
     contact_person = ?, phone = ?, phone_valid = ?, phone_country = ?,
     email = ?, website = ?, instagram = ?, facebook = ?, linkedin = ?,
     confidence = ?, verified = ?, last_checked = ?, updated_at = ?
   WHERE id = ?`
);

const FORCE_NAMES = ['Galaxy Palace Banquet', 'Emerald Banquet', 'Golden Garden Banquet'];
const rows = db
  .prepare(
    `SELECT * FROM leads
     WHERE created_at >= ? AND created_at < ?
       AND ( business_name IN (?, ?, ?)
          OR (phone IS NOT NULL AND (length(replace(replace(replace(phone,'-',''),' ',''),'.','')) > 13))
          OR (country_code IS NOT NULL AND phone_country IS NOT NULL AND phone_country <> country_code) )
     ORDER BY created_at ASC`
  )
  .all(FROM, TO, ...FORCE_NAMES) as unknown as LeadRow[];

async function main() {
  console.log(`Re-enriching ${rows.length} leads…`);

  let ok = 0;
  let failed = 0;
  let nowPhone = 0;
  for (const row of rows) {
    try {
      const enriched: EnrichedBusiness = await enrichBusiness(rowToDiscovery(row));
      const stamp = new Date().toISOString();
      update.run(
        enriched.contact_person ?? null,
        enriched.phone ?? null,
        enriched.phone_valid ? 1 : 0,
        enriched.phone_country ?? null,
        enriched.email ?? null,
        enriched.website ?? null,
        enriched.instagram ?? null,
        enriched.facebook ?? null,
        enriched.linkedin ?? null,
        enriched.confidence ?? null,
        enriched.verified ? 1 : 0,
        stamp,
        stamp,
        row.id
      );
      if (enriched.phone) nowPhone++;
      console.log(
        `[ok] ${row.business_name} | phone ${short(enriched.phone)} | web ${short(enriched.website)} | ig ${short(enriched.instagram)} | verified ${enriched.verified ? 'yes' : 'no'}`
      );
      ok++;
    } catch (err) {
      console.error(`[FAIL] ${row.business_name}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  console.log(`\nDone: ${ok} ok, ${failed} failed, ${nowPhone} now have a phone.`);

  const bad = db
    .prepare(
      `SELECT business_name, phone, website, instagram, facebook, linkedin FROM leads
       WHERE created_at >= ? AND created_at < ?
         AND ( (phone IS NOT NULL AND (length(replace(replace(replace(phone,'-',''),' ',''),'.','')) > 13))
            OR (country_code IS NOT NULL AND phone_country IS NOT NULL AND phone_country <> country_code) )
       ORDER BY business_name`
    )
    .all(FROM, TO) as { business_name: string; phone: string | null }[];

  console.log(`Remaining suspicious after re-enrich: ${bad.length}`);
  for (const b of bad) console.log(`  ${b.business_name} — ${b.phone || 'phone null'}`);

  db.close();
}

main().catch((err) => {
  console.error(err);
  db.close();
  process.exit(1);
});