import { discoverBusinesses, getDeduplicationKey } from './discovery';
import { enrichBusiness } from './enrichment';
import { deduplicateBusinesses } from './deduplication';
import { isIllFormedBusiness } from './discovery/filters';
import { hasJunkUrl } from './relevance';
import { mapWithConcurrency } from '@/lib/utils/concurrency';
import { logExtraction } from './logger';
import { resetBrowserSession, closeSessionContext, extractionSessionStore, setActiveSearchCount } from './browser';
import { buildCitySchedule } from './multi-city';
import { countryNameToISO2, canonicalCountryName } from '@/lib/utils/countries';
import type { ExtractionStore, EnrichedBusiness } from '@/types';

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
const ENRICHMENT_CONCURRENCY = 6;

/**
 * Post-enrichment country check. Every available signal that resolves to a
 * country must AGREE with the target, otherwise the lead is dropped. Signals:
 * discovery country_code (Maps/OSM), free-text country, and the validated
 * phone_country. A contradiction from ANY source (e.g. a listing tagged
 * country_code=PK but a validated phone_country=SA) means this business is
 * not reliably in the target country â€” fail-closed on contradictions, and
 * fail-open only when NO signal resolves at all.
 *
 * NOTE: the email domain is deliberately NOT used here â€” a `.com`/`.gr`
 * domain is a weak country signal and would false-positive on legitimately
 * local businesses using foreign-hosted sites.
 */
function isEnrichedCountryMatch(biz: EnrichedBusiness, targetCountry: string): boolean {
  const targetISO2 = countryNameToISO2(targetCountry);
  if (!targetISO2) return true;

  const signals: Array<string | null | undefined> = [biz.country_code, biz.phone_country];
  if (biz.country) signals.push(countryNameToISO2(biz.country));

  let anyResolved = false;
  for (const raw of signals) {
    if (!raw) continue;
    const iso2 = String(raw).toUpperCase();
    if (iso2.length !== 2) continue; // not an ISO2 code
    anyResolved = true;
    if (iso2 !== targetISO2) return false; // any contradiction = drop
  }
  return !anyResolved || true;
}

// In-process semaphore: up to N extractions may run at once (N must match
// MAX_CONCURRENT_SEARCHES â€” the API-level DB guard). Each extraction gets its
// OWN Chrome session/profile via extractionSessionStore (see browser.ts), so
// parallel runs never share cookies. BUT a serial setup (1) is what keeps the
// warm profile in play: only a solo search reuses the warm profile directly,
// and THAT is what makes country-wide Google Maps deliver a full feed (70+
// cards) instead of a collapsed 1-4-card cold feed.
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_SEARCHES || 1));

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
      } else {
        try {
          await closeSessionContext();
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
    setActiveSearchCount(activeExtractions);
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
    setActiveSearchCount(activeExtractions);
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
  const shouldAbort = isCancelled;

  const seenKeys = new Set<string>();
  let persistedCount = 0;
  // Counts only leads that did not already exist in the database when this run
  // started. This â€” not the total linked into the search â€” is what the requested
  // count is measured against, otherwise a repeat search re-counts saved
  // businesses and finishes instantly without collecting anything new.
  let newLeadCount = 0;
  let totalDiscovered = 0;
  let stopReason: string | null = null;
  // Timestamp used to tell a genuinely new lead row from one that already
  // existed in the database before this run started.
  const runStartedAtMs = Date.now();

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
      const remaining = requestedCount - newLeadCount;
      if (remaining <= 0) break;

      // Phase 1: Discovery â€” over-fetch aggressively so enrichment/dedup
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
        shouldAbort,
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

      // A location that yields nothing new is a dead end â€” but don't kill the
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
            // Bail out fast once the user cancels: every queued item returns
            // immediately instead of burning time on a dead round.
            if (await shouldAbort()) return null;
            try {
              return await enrichBusiness(biz, keyword, shouldAbort);
            } catch (err) {
              console.error(`[Extraction] Failed to enrich "${biz.name}":`, err);
              return null;
            }
          }
        );
        const enrichedOk = enrichedRaw.filter((e): e is NonNullable<typeof e> => e !== null);
        logExtraction(searchId, `Round ${locIdx + 1}: Enrichment done â€” ${enrichedOk.length}/${freshBusinesses.length} successful`);

        if (await isCancelled()) {
          stopReason = 'Cancelled by user';
          break;
        }

        // Phase 3: Deduplication
        const deduplicated = deduplicateBusinesses(enrichedOk);
        console.log(
          `[Extraction] Round ${locIdx}: after dedup ${deduplicated.length} unique businesses (from ${enrichedOk.length} enriched)`
        );

        // Phase 4: Persist â€” only verified (real phone or verified email)
        // leads count toward the requested quota. Unverified leads with a
        // real phone or email are still saved (useful, contactable data) but
        // don't fill the quota. Website-only UNVERIFIED leads are dropped:
        // without a phone/email there is no usable contact and a generic
        // corporate page (google.com, netflix.com, an account/login page)
        // proves nothing about the business â€” those are exactly the junk
        // cards that polluted past searches. Ill-formed names are garbage
        // regardless of contact data.
        const verified = (biz: EnrichedBusiness) => biz.verified === true;
        const noDialableContact = (biz: EnrichedBusiness) => !biz.phone && !biz.email;
        const junkWebsite = (biz: EnrichedBusiness) => !verified(biz) && !!biz.website && hasJunkUrl(biz.website);
        for (const biz of deduplicated) {
          if (await isCancelled()) {
            stopReason = 'Cancelled by user';
            cancelledDuringPersist = true;
            break;
          }

          try {
            // Post-enrichment country gate: drop leads that enrichment
            // revealed as belonging to a different country (e.g. a phone
            // with +880 country code in a Pakistan search).
            if (!isEnrichedCountryMatch(biz, country)) {
              logExtraction(searchId, `Skipped (wrong country): "${biz.name}" â€” country_code=${biz.country_code || biz.phone_country || 'unknown'}`);
              continue;
            }

            // Each skip reason is logged separately. A single generic
            // "garbage/no contact" message made it impossible to tell a
            // genuinely contact-less business from a good one that merely
            // failed verification, which is exactly what has to be auditable
            // before a lead is thrown away.
            const skipReason = isIllFormedBusiness(biz.name)
              ? 'ill-formed name'
              : verified(biz)
                ? null
                : noDialableContact(biz)
                  ? 'no phone and no email'
                  : junkWebsite(biz)
                    ? `unverified with unusable website ${biz.website}`
                    : 'failed verification';
            if (skipReason) {
              logExtraction(
                searchId,
                `Skipped (${skipReason}): "${biz.name}" â€” phone=${biz.phone ?? 'none'}, email=${biz.email ?? 'none'}, website=${biz.website ?? 'none'}, verified=${biz.verified === true}`
              );
              continue;
            }
            // Irrelevant engine-sourced leads are never persisted â€” they are
            // junk that slipped through enrichment (the safety net).
            if (biz.relevant === false) {
              logExtraction(searchId, `Skipped (not relevant to "${keyword}"): "${biz.name}"`);
              continue;
            }

            // Store one canonical spelling of the country so exports and filters do not
            // split a single country across "UK" / "United Kingdom" / "UAE".
            if (biz.country) biz.country = canonicalCountryName(biz.country) || biz.country;

            const lead = await store.upsertLead(biz);
            if (lead) {
              await store.linkSearchLead(searchId, lead.id);
              if (biz.verified) {
                persistedCount++;
                // Only a lead that did not exist in the database before this run
                // may count towards the requested total. Without this, re-running
                // the same search "completes" instantly by re-counting businesses
                // that are already saved, and the run reports a full quota while
                // adding nothing new. lead_sources/merges never touch created_at,
                // so a row born during this run is reliably identifiable.
                const createdThisRun =
                  !lead.created_at || Date.parse(lead.created_at) >= runStartedAtMs - 60_000;
                if (createdThisRun) {
                  newLeadCount++;
                  newVerifiedThisRound++;
                }
                await store.updateSearch(searchId, { enriched_count: persistedCount });
              }
              logExtraction(
                searchId,
                `Persisted: "${biz.name}" (${persistedCount} verified in search, ${newLeadCount}/${requestedCount} new)${biz.verified ? '' : ' [unverified]'}`
              );
            }
          } catch (err) {
            console.error(`[Extraction] Failed to persist "${biz.name}":`, err);
          }

          if (newLeadCount >= requestedCount) break;
        }
      }

      if (cancelledDuringPersist || newLeadCount >= requestedCount) break;

      // Count this location as "empty" when it produced nothing new or far
      // too few verified leads; two weak locations in a row = stop sweeping.
      if (freshBusinesses.length === 0 || newVerifiedThisRound < MIN_NEW_VERIFIED_PER_ROUND) {
        consecutiveEmptyLocations++;
      } else {
        consecutiveEmptyLocations = 0;
      }

      if (consecutiveEmptyLocations >= 3 && locIdx > 0) {
        stopReason = `Diminishing returns: ${consecutiveEmptyLocations} consecutive locations yielded no new verified leads for "${keyword}". Tried ${schedule.locations.slice(0, locIdx + 1).map(describeLocation).join(', ')}.`;
        break;
      }
    }

    if (!stopReason && newLeadCount < requestedCount) {
      stopReason = `Reached the round limit after sweeping ${schedule.locations.length} location(s) with ${newLeadCount} of ${requestedCount} new verified leads (${persistedCount} matched in total, including ones already saved) found via free sources (OpenStreetMap + web search) for "${keyword}" in ${city || country}.`;
    }

    const currentStatus = await store.getStatus(searchId);
    const finalStatus =
      currentStatus === 'cancelled'
        ? 'cancelled'
        : newLeadCount >= requestedCount
          ? 'completed'
          : 'partially_completed';

    await store.updateSearch(searchId, {
      status: finalStatus,
      error_message: finalStatus === 'completed' ? null : stopReason,
    });
    logExtraction(searchId, `Extraction complete: status=${finalStatus}, new=${newLeadCount}/${requestedCount}, matched=${persistedCount}, discovered=${totalDiscovered}`);
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