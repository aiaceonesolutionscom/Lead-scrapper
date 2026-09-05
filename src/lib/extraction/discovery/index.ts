import type { DiscoveryBusiness } from '@/types';
import { discoverFromGoogleMaps } from './google-maps';
import { discoverFromOSM } from './osm';
import { discoverFromWebSearch } from './web-search';
import { discoverFromBing } from './bing-search';
import { isIllFormedBusiness } from './filters';
import { normalizeString, extractDomain } from '@/lib/utils';

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
}

export async function discoverBusinesses(
  options: DiscoveryOptions
): Promise<{ businesses: DiscoveryBusiness[]; totalCount: number }> {
  const { keyword, city, country, limit, round = 0 } = options;

  console.log(`[Discovery] Starting discovery for "${keyword}" in ${city || country} (limit: ${limit}, round: ${round})`);

  const allBusinesses: DiscoveryBusiness[] = [];

  // Source 0: Google Maps (Playwright) — PRIMARY source. Real business
  // listings with phone/email/website/address/social for any keyword or
  // arbitrary location. Read via a normal headless browser; no stealth.
  try {
    console.log('[Discovery] Querying Google Maps (Playwright)...');
    const gmResults = await discoverFromGoogleMaps(keyword, city || '', country, limit, {
      headless: true,
      fetchDetails: true,
    });
    console.log(`[Discovery] Google Maps returned ${gmResults.length} results`);
    allBusinesses.push(...gmResults);
  } catch (error) {
    console.log('[Discovery] Google Maps source failed (continuing with other sources)');
    console.error(error);
  }

  await sleep(1500);

  // Source 1: OpenStreetMap
  try {
    console.log('[Discovery] Querying OpenStreetMap...');
    const osmResults = await discoverFromOSM(keyword, city || '', country, Math.ceil(limit * 0.6), round);
    console.log(`[Discovery] OSM returned ${osmResults.length} results`);
    allBusinesses.push(...osmResults);
  } catch (error) {
    console.error('[Discovery] OSM source failed:', error);
  }

  await sleep(1000);

  // Source 2: DuckDuckGo Web Search
  try {
    console.log('[Discovery] Querying DuckDuckGo...');
    const webResults = await discoverFromWebSearch(keyword, city || '', country, Math.ceil(limit * 0.8), round);
    console.log(`[Discovery] Web search returned ${webResults.length} results`);
    allBusinesses.push(...webResults);
  } catch (error) {
    console.error('[Discovery] Web search source failed:', error);
  }

  await sleep(1000);

  // Source 3: Bing Web Search (second free engine — more raw candidates,
  // and a fallback when DuckDuckGo's index is thin for a given keyword)
  try {
    console.log('[Discovery] Querying Bing...');
    const bingResults = await discoverFromBing(keyword, city || '', country, Math.ceil(limit * 0.8), round);
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

  return {
    businesses: deduplicated.slice(0, limit),
    totalCount: deduplicated.length,
  };
}
