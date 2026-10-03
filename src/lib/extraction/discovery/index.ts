import type { DiscoveryBusiness } from '@/types';
import { discoverFromGoogleMaps } from './google-maps';
import { discoverFromOSM } from './osm';
import { discoverFromWebSearch } from './web-search';
import { discoverFromBing } from './bing-search';
import { isIllFormedBusiness } from './filters';
import { resetBrowserSession } from '../browser';
import { normalizeString, extractDomain } from '@/lib/utils';
import { hasJunkUrl } from '../relevance';
import { countryNameToISO2 } from '@/lib/utils/countries';

/**
 * Check whether a business belongs to the target country. Returns true when
 * the country cannot be determined (fail-open) so legitimate leads are never
 * wrongly dropped — only clearly-mismatched ones are filtered.
 */
function isCountryMatch(business: DiscoveryBusiness, targetCountry: string): boolean {
  const targetISO2 = countryNameToISO2(targetCountry);
  if (!targetISO2) return true; // unknown country, accept everything

  // 1. country_code (ISO2) from Google Maps detail panel or OSM tag — strongest signal
  if (business.country_code) {
    return business.country_code.toUpperCase() === targetISO2;
  }

  // 2. Full country name from discovery source
  if (business.country) {
    const srcISO2 = countryNameToISO2(business.country);
    if (srcISO2) return srcISO2 === targetISO2;
  }

  // 3. Phone country code — a +92 number is Pakistani even if country field is blank
  if (business.phone) {
    const phoneDigits = business.phone.replace(/\D/g, '');
    if (phoneDigits.startsWith('92') && targetISO2 === 'PK') return true;
    if (phoneDigits.startsWith('880') && targetISO2 === 'BD') return true;
    if (phoneDigits.startsWith('91') && targetISO2 === 'IN') return true;
    // Add more as needed; fail-open for unknown codes
  }

  // 4. City heuristic: well-known cities that unambiguously belong to one country
  if (business.city) {
    const c = business.city.toLowerCase();
    const pakCities = new Set(['karachi', 'lahore', 'faisalabad', 'rawalpindi', 'islamabad', 'multan', 'hyderabad', 'gujranwala', 'peshawar', 'quetta', 'sialkot']);
    const bdCities = new Set(['dhaka', 'chittagong', 'khulna', 'rajshahi', 'sylhet', 'barisal', 'rangpur', 'cumilla']);
    if (pakCities.has(c)) return targetISO2 === 'PK';
    if (bdCities.has(c)) return targetISO2 === 'BD';
  }

  // 5. No signals at all — fail-open (accept)
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getDeduplicationKey(business: DiscoveryBusiness): string {
  const parts: string[] = [];

  if (business.name) {
    parts.push(`name:${normalizeString(business.name)}`);
  }
  if (business.website) {
    const domain = extractDomain(business.website);
    if (domain) parts.push(`domain:${domain.toLowerCase()}`);
  }
  if (business.phone) {
    const digits = business.phone.replace(/\D/g, '');
    if (digits.length >= 7) parts.push(`phone:${digits}`);
  }
  if (business.address && business.city) {
    parts.push(`addr:${normalizeString(business.address)}:${normalizeString(business.city)}`);
  }

  return parts.join('|');
}

function mergeBusinesses(existing: DiscoveryBusiness, incoming: DiscoveryBusiness): DiscoveryBusiness {
  return {
    name: existing.name || incoming.name,
    address: existing.address || incoming.address,
    city: existing.city || incoming.city,
    country: existing.country || incoming.country,
    country_code: existing.country_code || incoming.country_code,
    website: existing.website || incoming.website,
    phone: existing.phone || incoming.phone,
    email: existing.email || incoming.email,
    instagram: existing.instagram || incoming.instagram,
    facebook: existing.facebook || incoming.facebook,
    linkedin: existing.linkedin || incoming.linkedin,
    latitude: existing.latitude || incoming.latitude,
    longitude: existing.longitude || incoming.longitude,
    source: existing.source,
    source_url: existing.source_url || incoming.source_url,
    category: existing.category || incoming.category,
  };
}

export interface DiscoveryOptions {
  keyword: string;
  city: string;
  country: string;
  limit: number;
  round?: number;
  /** When this resolves truthy, discovery stops at the next safe boundary
   * and returns whatever it already collected (cancellation halts the
   * current location WITHOUT waiting for the full crawl). */
  shouldAbort?: () => Promise<boolean>;
}

export async function discoverBusinesses(
  options: DiscoveryOptions
): Promise<{ businesses: DiscoveryBusiness[]; totalCount: number }> {
  const { keyword, city, country, limit, round = 0, shouldAbort } = options;

  console.log(`[Discovery] Starting discovery for "${keyword}" in ${city || country} (limit: ${limit}, round: ${round})`);

  const aborted = async () => (shouldAbort ? await shouldAbort() : false);
  const earlyReturn = (): { businesses: DiscoveryBusiness[]; totalCount: number } => {
    console.log(`[Discovery] Cancelled — returning ${allBusinesses.length} businesses (before dedup)`);
    return { businesses: [], totalCount: 0 };
  };

  const allBusinesses: DiscoveryBusiness[] = [];

  // Source 0: Google Maps (Playwright) — PRIMARY source. Real business
  // listings with phone/email/website/address/social for any keyword or
  // arbitrary location. Read via a normal headless browser; no stealth.
  //
  // Right now Google Maps is throttled for country-wide queries ("salt
  // dealers in United States" -> 0 cards while metro queries still return
  // 15-99). A flagged/cold session quietly returns an empty or 1-4 card feed
  // instead of the 50-100 the historical best runs got. So: if the first
  // attempt comes back nearly empty, rotate the browser session (fresh
  // profile) and retry Google Maps ONCE before falling back to the web
  // engines — that single retry is what recovers the metro-sized feed.
  const GM_MIN_ACCEPTABLE = 5;
  let gmResults: DiscoveryBusiness[] = [];
  try {
    console.log('[Discovery] Querying Google Maps (Playwright)...');
    gmResults = await discoverFromGoogleMaps(keyword, city || '', country, limit, {
      headless: true,
      fetchDetails: true,
      shouldAbort,
    });
    console.log(`[Discovery] Google Maps returned ${gmResults.length} results`);

    if (gmResults.length < GM_MIN_ACCEPTABLE) {
      if (await aborted()) return earlyReturn();
      console.log(`[Discovery] Google Maps feed too thin (${gmResults.length} < ${GM_MIN_ACCEPTABLE}), rotating session and retrying...`);
      await resetBrowserSession();
      try {
        const retried = await discoverFromGoogleMaps(keyword, city || '', country, limit, {
          headless: true,
          fetchDetails: true,
          shouldAbort,
        });
        console.log(`[Discovery] Google Maps retry returned ${retried.length} results`);
        if (retried.length > gmResults.length) gmResults = retried;
      } catch {
        console.log('[Discovery] Google Maps retry failed (keeping original results)');
      }
    }
    allBusinesses.push(...gmResults);
  } catch (error) {
    console.log('[Discovery] Google Maps source failed (continuing with other sources)');
    console.error(error);
    // The first call usually only throws on a hard block. One retry with a
    // fresh session can clear a transient consent/flag wall.
    try {
      if (await aborted()) return earlyReturn();
      console.log('[Discovery] Google Maps failed, rotating session and retrying once...');
      await resetBrowserSession();
      const retried = await discoverFromGoogleMaps(keyword, city || '', country, limit, {
        headless: true,
        fetchDetails: true,
        shouldAbort,
      });
      console.log(`[Discovery] Google Maps retry returned ${retried.length} results`);
      allBusinesses.push(...retried);
    } catch {
      console.log('[Discovery] Google Maps retry also failed');
    }
  }

  if (await aborted()) return earlyReturn();

  await sleep(1500);

  // Source 1: OpenStreetMap
  try {
    console.log('[Discovery] Querying OpenStreetMap...');
    const osmResults = await discoverFromOSM(keyword, city || '', country, Math.ceil(limit * 0.6), round, shouldAbort);
    console.log(`[Discovery] OSM returned ${osmResults.length} results`);
    allBusinesses.push(...osmResults);
  } catch (error) {
    console.error('[Discovery] OSM source failed:', error);
  }

  if (await aborted()) return earlyReturn();

  await sleep(1000);

  // Source 2: DuckDuckGo Web Search
  try {
    console.log('[Discovery] Querying DuckDuckGo...');
    const webResults = await discoverFromWebSearch(keyword, city || '', country, Math.ceil(limit * 0.8), round, shouldAbort);
    console.log(`[Discovery] Web search returned ${webResults.length} results`);
    allBusinesses.push(...webResults);
  } catch (error) {
    console.error('[Discovery] Web search source failed:', error);
  }

  if (await aborted()) return earlyReturn();

  await sleep(1000);

  // Source 3: Bing Web Search (second free engine — more raw candidates,
  // and a fallback when DuckDuckGo's index is thin for a given keyword)
  try {
    console.log('[Discovery] Querying Bing...');
    const bingResults = await discoverFromBing(keyword, city || '', country, Math.ceil(limit * 0.8), round, shouldAbort);
    console.log(`[Discovery] Bing returned ${bingResults.length} results`);
    allBusinesses.push(...bingResults);
  } catch (error) {
    console.error('[Discovery] Bing source failed:', error);
  }

  // Deduplicate results
  const seen = new Map<string, DiscoveryBusiness>();
  for (const business of allBusinesses) {
    // Drop ill-formed / garbage candidates before they reach enrichment
    if (isIllFormedBusiness(business.name)) continue;
    // Hard-drop global corporate/product/marketplace domains (Google Maps
    // and OSM can occasionally surface e.g. a domain-only listing for a
    // recognised brand that has no real local contact).
    if (hasJunkUrl(business.website || business.source_url || '')) continue;

    const key = getDeduplicationKey(business);
    if (!key) continue;

    if (seen.has(key)) {
      const existing = seen.get(key)!;
      seen.set(key, mergeBusinesses(existing, business));
    } else {
      seen.set(key, business);
    }
  }

  const deduplicated = Array.from(seen.values());
  console.log(`[Discovery] After deduplication: ${deduplicated.length} unique businesses`);

  // Country gate: drop businesses that clearly belong to a different country
  // (e.g. Bangladesh leads leaking into a Pakistan search). Fail-open when
  // no country signal exists so legitimate leads are not wrongly dropped.
  const countryFiltered = deduplicated.filter((b) => isCountryMatch(b, country));
  const dropped = deduplicated.length - countryFiltered.length;
  if (dropped > 0) {
    console.log(`[Discovery] Country filter removed ${dropped} businesses not matching "${country}"`);
  }

  return {
    businesses: countryFiltered.slice(0, limit),
    totalCount: countryFiltered.length,
  };
}
