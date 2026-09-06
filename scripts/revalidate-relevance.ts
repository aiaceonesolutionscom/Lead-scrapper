// One-off revalidation: marks existing leads that were discovered via
// web/Bing but do not match the search keyword as unverified (verified=0,
// confidence='low'). Intended for a single run after the relevance gate
// ships — will NOT be called by the runtime.
//
// Usage:   npm run revalidate-relevance
// Requires: Node >= 20.12 (node:sqlite DatabaseSync)

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Relevance helpers (tsx resolves the .ts file directly — no tsconfig alias needed).
import { isRelevantToKeyword, buildKeywordTokens } from '../src/lib/extraction/relevance.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const dbPath = process.env.DB_PATH || resolve(repoRoot, 'server', 'data', 'crm.db');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sql(values: readonly unknown[]): SQLInputValue[] {
  return values as SQLInputValue[];
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  if (!existsSync(dbPath)) {
    console.error(`No database found at ${dbPath} — nothing to revalidate.`);
    process.exit(1);
  }

  const db = new DatabaseSync(dbPath);
  const engineSources = new Set(['web_search', 'bing_search']);

  // All (search_id, keyword, lead_id, business_name, website) pairs.
  const pairs = db.prepare(`
    SELECT
      s.id        AS search_id,
      s.keyword   AS keyword,
      l.id        AS lead_id,
      l.business_name,
      l.website,
      l.verified,
      l.confidence
    FROM searches s
    JOIN search_leads sl ON sl.search_id = s.id
    JOIN leads l         ON l.id = sl.lead_id
  `).all() as Record<string, unknown>[];

  console.log(`Found ${pairs.length} search-lead pairs to evaluate.`);

  // Group by lead_id so each lead is updated at most once.
  const byLead = new Map<string, { searchId: string; keyword: string; businessName: string; website: string | null; wasVerified: boolean; wasConfidence: string | null }>();
  for (const row of pairs) {
    const leadId = String(row.lead_id);
    if (!byLead.has(leadId)) {
      byLead.set(leadId, {
        searchId: String(row.search_id),
        keyword: String(row.keyword),
        businessName: String(row.business_name),
        website: (row.website as string) ?? null,
        wasVerified: Boolean(row.verified),
        wasConfidence: (row.confidence as string) ?? null,
      });
    }
  }

  let flagged = 0;
  let alreadyUnverified = 0;
  let passed = 0;
  let noToken = 0;

  const updateStmt = db.prepare(`
    UPDATE leads SET verified = 0, confidence = 'low', updated_at = ?
    WHERE id = ?
  `);

  for (const [leadId, { keyword, businessName, website, wasVerified, wasConfidence }] of byLead) {
    const tokens = buildKeywordTokens(keyword);
    if (tokens.length === 0) {
      noToken++;
      continue;
    }

    const text = [businessName, website || ''].join(' ');
    const relevant = isRelevantToKeyword(keyword, text);

    if (!relevant) {
      if (!wasVerified && wasConfidence === 'low') {
        alreadyUnverified++;
      } else {
        updateStmt.run(...sql([nowIso(), leadId]));
        flagged++;
      }
    } else {
      passed++;
    }
  }

  db.close();

  console.log('\n=== Revalidation complete ===');
  console.log(`  Passed (relevant):      ${passed}`);
  console.log(`  Flagged (unverified):   ${flagged}`);
  console.log(`  Already low/unverified:  ${alreadyUnverified}`);
  console.log(`  Keyword had no tokens:  ${noToken}`);
}

main();
