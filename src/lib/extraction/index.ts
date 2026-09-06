import { discoverBusinesses, getDeduplicationKey } from './discovery';
import { enrichBusiness } from './enrichment';
import { deduplicateBusinesses } from './deduplication';
import { isIllFormedBusiness } from './discovery/filters';
import { mapWithConcurrency } from '@/lib/utils/concurrency';
import { logExtraction } from './logger';
import { resetBrowserSession, extractionSessionStore } from './browser';
import { buildCitySchedule } from './multi-city';
import type { ExtractionStore } from '@/types';

export interface ExtractionParams {
  searchId: string;
  keyword: string;
  country: string;
  city: string | null;
  searchMode: 'city' | 'country';
  requestedCount: number;
}

const MAX_ROUNDS = 24;
const MIN_NEW_VERIFIED_PER_ROUND = 3;
const ENRICHMENT_CONCURRENCY = 4;

// In-process semaphore: up to N extractions may run at once (N must match
// MAX_CONCURRENT_SEARCHES — the API-level DB guard). Each extraction gets its
// OWN Chrome session/profile via extractionSessionStore (see browser.ts), so
// parallel runs never share cookies and don't flag each other the way two
// searches on one profile did (the 17:01 + 17:06 Karachi runs).
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_SEARCHES || 3));

// How weak a search must be before its browser profile gets rotated. A
// persistent profile is what keeps Google Maps serving a returning-visitor
// feed; wiping it after a healthy search throws away that trust. Only a
// throttled run (tiny discovery) justifies rotating.
const MIN_DISCOVERED_TO_KEEP_PROFILE = 10;

export async function runExtraction(params: ExtractionParams, store: ExtractionStore): Promise<void> {
  await acquireSlot();
  try {
    // Run the whole search inside its own AsyncLocalStorage scope so every
    // withPage/resetBrowserSession call resolves to this search's Chrome
    // profile (concurrent searches each get their own).
    await extractionSessionStore.run(params.searchId, async () => {
      const discovered = await runExtractionInner(params, store);
      // In this search's own session scope: a weak run rotates (discards) the
      // profile so the NEXT search starts fresh instead of inheriting a
      // possibly-flagged one; a healthy run keeps its cookies so it stays a
      // "returning visitor" for the next search.
      if (discovered >= 0 && discovered < MIN_DISCOVERED_TO_KEEP_PROFILE) {
        try {
          await resetBrowserSession();
        } catch {
          // Best-effort.
        }
      }
    });
  } finally {
    releaseSlot();
  }
}

let activeExtractions = 0;
const waitingQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeExtractions < MAX_CONCURRENT) {
    activeExtractions++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waitingQueue.push(resolve));
}

function releaseSlot(): void {
  const next = waitingQueue.shift();
  if (next) {
    next();
  } else {
    activeExtractions--;
  }
}

async function runExtractionInner(params: ExtractionParams, store: ExtractionStore): Promise<number> {
  const { searchId, keyword, country, city, searchMode, requestedCount } = params;

  // Ordered sweep of locations: city searches stay in the one chosen city;
  // country searches start country-wide then sweep the country's major
  // metros (still inside the country) so a big quota can be filled honestly.
  const schedule = buildCitySchedule({ city, country, searchMode, requestedCount });
  const describeLocation = (loc: string) => loc || country;

  const isCancelled = async () => (await store.getStatus(searchId)) === 'cancelled';

  const seenKeys = new Set<string>();
  let persistedCount = 0;
  let totalDiscovered = 0;
  let stopReason: string | null = null;

  logExtraction(
    searchId,
    `Starting extraction: "${keyword}" across ${schedule.locations.map(describeLocation).join(', ')} (target: ${requestedCount} leads)`
  );

  try {
    let consecutiveEmptyLocations = 0;

    for (let locIdx = 0; locIdx < schedule.locations.length && locIdx < MAX_ROUNDS; locIdx++) {
      if (await isCancelled()) {
        stopReason = 'Cancelled by user';
        logExtraction(searchId, 'Search cancelled by user');
        break;
      }

      const location = schedule.locations[locIdx];
      const place = describeLocation(location);
      const remaining = requestedCount - persistedCount;
      if (remaining <= 0) break;

      // Phase 1: Discovery — over-fetch aggressively so enrichment/dedup
      // drop-off still leaves enough to reach the target.
      await store.updateSearch(searchId, { status: 'discovering' });
      logExtraction(searchId, `Round ${locIdx + 1}: Starting discovery in ${place} (need ${remaining} more leads, fetching ${Math.max(remaining * 2, 20)})`);

      const roundLimit = Math.max(remaining * 2, 20);
      const { businesses: rawDiscovered } = await discoverBusinesses({
        keyword,
        city: location,
        country,
        limit: roundLimit,
        round: locIdx,
      });

      const freshBusinesses: typeof rawDiscovered = [];
      for (const biz of rawDiscovered) {
        const key = getDeduplicationKey(biz);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        freshBusinesses.push(biz);
      }

      totalDiscovered += freshBusinesses.length;
      await store.updateSearch(searchId, { discovered_count: totalDiscovered });
      logExtraction(searchId, `Round ${locIdx + 1}: Discovered ${freshBusinesses.length} new businesses in ${place} (${totalDiscovered} total)`);

      // A flagged Chrome session quietly returns a thin feed (a handful of
      // results instead of 50-100). If a round finds almost nothing, rotate
      // the browser session so the NEXT location starts with a fresh profile
      // instead of compounding the throttling.
      if (locIdx > 0 && freshBusinesses.length < 5) {
        logExtraction(searchId, `Round ${locIdx + 1}: thin discovery (${freshBusinesses.length}), rotating browser session`);
        await resetBrowserSession();
      }

      if (await isCancelled()) {
        stopReason = 'Cancelled by user';
        break;
      }

      // A location that yields nothing new is a dead end — but don't kill the
      // whole search yet; the next location in the schedule may be rich.
      // Two consecutive empty locations is a strong overall diminishing-returns
      // signal, so stop sweeping instead of scraping the last cities uselessly.
      let newVerifiedThisRound = 0;
      let cancelledDuringPersist = false;

      if (freshBusinesses.length > 0) {
        // Phase 2: Enrichment (bounded concurrency instead of fully serial)
        await store.updateSearch(searchId, { status: 'enriching' });
        logExtraction(searchId, `Round ${locIdx + 1}: Enriching ${freshBusinesses.length} businesses from ${place} (concurrency: ${ENRICHMENT_CONCURRENCY})`);

        const enrichedRaw = await mapWithConcurrency(
          freshBusinesses,
          ENRICHMENT_CONCURRENCY,
          async (biz) => {
            try {
              return await enrichBusiness(biz);
            } catch (err) {
              console.error(`[Extraction] Failed to enrich "${biz.name}":`, err);
              return null;
            }
          }
        );
        const enrichedOk = enrichedRaw.filter((e): e is NonNullable<typeof e> => e !== null);
        logExtraction(searchId, `Round ${locIdx + 1}: Enrichment done — ${enrichedOk.length}/${freshBusinesses.length} successful`);

        if (await isCancelled()) {
          stopReason = 'Cancelled by user';
          break;
        }

        // Phase 3: Deduplication
        const deduplicated = deduplicateBusinesses(enrichedOk);
        console.log(
          `[Extraction] Round ${locIdx}: after dedup ${deduplicated.length} unique businesses (from ${enrichedOk.length} enriched)`
        );

        // Phase 4: Persist — only verified (real phone or verified email)
        // leads count toward the requested quota; unverified ones are still
        // saved (nothing thrown away) but don't fill the quota. Leads with
        // no contact channel at all (no phone/email/website) and an
        // ill-formed name are dropped entirely as garbage.
        for (const biz of deduplicated) {
          if (await isCancelled()) {
            stopReason = 'Cancelled by user';
            cancelledDuringPersist = true;
            break;
          }

          try {
            const hasContact = !!(biz.phone || biz.email || biz.website);
            if (isIllFormedBusiness(biz.name) || (!hasContact && biz.verified === false)) {
              logExtraction(searchId, `Skipped (garbage/no contact): "${biz.name}"`);
              continue;
            }

            const lead = await store.upsertLead(biz);
            if (lead) {
              await store.linkSearchLead(searchId, lead.id);
              if (biz.verified) {
                persistedCount++;
                newVerifiedThisRound++;
                await store.updateSearch(searchId, { enriched_count: persistedCount });
              }
              logExtraction(searchId, `Persisted: "${biz.name}" (${persistedCount}/${requestedCount} verified)${biz.verified ? '' : ' [unverified]'}`);
            }
          } catch (err) {
            console.error(`[Extraction] Failed to persist "${biz.name}":`, err);
          }

          if (persistedCount >= requestedCount) break;
        }
      }

      if (cancelledDuringPersist || persistedCount >= requestedCount) break;

      // Count this location as "empty" when it produced nothing new or far
      // too few verified leads; two weak locations in a row = stop sweeping.
      if (freshBusinesses.length === 0 || newVerifiedThisRound < MIN_NEW_VERIFIED_PER_ROUND) {
        consecutiveEmptyLocations++;
      } else {
        consecutiveEmptyLocations = 0;
      }

      if (consecutiveEmptyLocations >= 2 && locIdx > 0) {
        stopReason = `Diminishing returns: ${consecutiveEmptyLocations} consecutive locations yielded no new verified leads for "${keyword}". Tried ${schedule.locations.slice(0, locIdx + 1).map(describeLocation).join(', ')}.`;
        break;
      }
    }

    if (!stopReason && persistedCount < requestedCount) {
      stopReason = `Reached the round limit after sweeping ${schedule.locations.length} location(s) with ${persistedCount} of ${requestedCount} verified leads found via free sources (OpenStreetMap + web search) for "${keyword}" in ${city || country}.`;
    }

    const currentStatus = await store.getStatus(searchId);
    const finalStatus =
      currentStatus === 'cancelled'
        ? 'cancelled'
        : persistedCount >= requestedCount
          ? 'completed'
          : 'partially_completed';

    await store.updateSearch(searchId, {
      status: finalStatus,
      error_message: finalStatus === 'completed' ? null : stopReason,
    });
    logExtraction(searchId, `Extraction complete: status=${finalStatus}, verified=${persistedCount}/${requestedCount}, discovered=${totalDiscovered}`);
    return totalDiscovered;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown extraction error';
    logExtraction(searchId, `Extraction failed: ${msg}`, 'error');
    await store.updateSearch(searchId, {
      status: 'failed',
      error_message: err instanceof Error ? err.message : 'Unknown extraction error',
    });
    throw err;
  }
}