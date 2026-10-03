// Temporary test runner:  runs a real extraction for a given search, exactly
// like POST /api/search/start but scripted (bypasses HTTP login/Turnstile).
// Usage:
//   tsx server/src/run-test-search.ts <username> "<keyword>" "<country>" [city] [searchMode] [requestedCount]
import { randomUUID } from 'node:crypto';
import { db, nowIso, logEvent } from './db';
import { createExtractionStore } from './store';
import { createNotification } from './notifications';

const [,, username, keyword, country, cityArg, modeArg, countArg] = process.argv;

const city = cityArg === 'null' ? null : cityArg || null;
const searchMode = (modeArg === 'city' ? 'city' : 'country') as 'city' | 'country';
const requestedCount = countArg ? Number(countArg) : 50;

const user = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username) as
  | { id: string }
  | undefined;
if (!user) {
  console.error(`User "${username}" not found`);
  process.exit(1);
}

const searchId = randomUUID();
const now = nowIso();
db.prepare(
  `INSERT INTO searches (id, keyword, country, city, search_mode, requested_count,
     discovered_count, enriched_count, status, error_message, created_by, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'pending', NULL, ?, ?, ?)`
).run(searchId, keyword, country, city, searchMode, requestedCount, user.id, now, now);

logEvent('SEARCH', 'info', `[TEST] Search ${searchId} started: "${keyword}" in ${city || country} (${searchMode}), target ${requestedCount} by ${username}`);

console.log(`STARTING search ${searchId} for user ${username}: "${keyword}" in ${city || country}, mode=${searchMode}, target=${requestedCount}`);

const { runExtraction } = await import('@/lib/extraction');
try {
  await runExtraction(
    { searchId, keyword, country, city, searchMode, requestedCount },
    createExtractionStore()
  );
  const row = db.prepare('SELECT status, keyword, enriched_count, discovered_count, created_by FROM searches WHERE id = ?').get(searchId) as
    | { status: string; keyword: string; enriched_count: number; discovered_count: number; created_by: string | null }
    | undefined;
  console.log(`DONE search ${searchId}: status=${row?.status} enriched=${row?.enriched_count} discovered=${row?.discovered_count}`);
  if (row?.created_by) {
    createNotification(
      row.created_by,
      row.status === 'failed' ? 'warning' : 'search',
      row.status === 'completed' ? `Search "${row.keyword}" completed` : `Search "${row.keyword}" ${row.status.replace(/_/g, ' ')}`,
      `${row.enriched_count} verified leads found (${row.discovered_count} discovered).`,
      `/search/${searchId}`
    );
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : 'Unknown extraction error';
  logEvent('EXTRACTION', 'error', `[TEST] Extraction failed for ${searchId}: ${msg}`);
  try {
    const store = createExtractionStore();
    await store.updateSearch(searchId, { status: 'failed', error_message: msg });
    createNotification(user.id, 'warning', 'Search failed', msg, `/search/${searchId}`);
  } catch {
    // last resort
  }
  console.error(`FAILED search ${searchId}: ${msg}`);
  process.exit(1);
}
process.exit(0);
