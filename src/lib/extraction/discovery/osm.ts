import axios from 'axios';
import type { DiscoveryBusiness } from '@/types';
import { countryNameToISO2 } from '@/lib/utils/countries';

interface OverpassElement {
  type: string;
  id: number;
  tags: Record<string, string>;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
}

interface OverpassResponse {
  elements: OverpassElement[];
}

interface NominatimResult {
  lat: string;
  lon: string;
  boundingbox?: string[];
  display_name?: string;
  name?: string;
  type?: string;
  addresstype?: string;
  address?: { country_code?: string; [key: string]: string | undefined };
}

// Public Overpass mirrors, ordered by measured reachability from this network
// (verified live: de, mail.ru, osm.ch — the rest fail connect/DNS/timeout and
// sit at the end, so a dead instance can never block the healthy ones).
// Discovery only needs ONE mirror to answer; a healthy mirror answers a
// small local-bbox query in 1-3 seconds.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// A hanging mirror must not monopolize a location's discovery slot: fail it
// after 15s and move on (the old 40s x several mirrors turned one dead mirror
// into ~3 minutes of blocking, which is exactly the "upstream failed" wall).
const OVERPASS_TIMEOUT_MS = 15000;
const OVERPASS_RETRY_DELAY_MS = 2000;
const NOMINATIM_API = 'https://nominatim.openstreetmap.org/search';

const KEYWORD_TO_OSM_TAG: Record<string, { key: string; value: string }[]> = {
  dentist: [
    { key: 'amenity', value: 'dentist' },
    { key: 'healthcare', value: 'dentist' },
  ],
  doctor: [
    { key: 'amenity', value: 'doctors' },
    { key: 'healthcare', value: 'doctor' },
  ],
  hospital: [
    { key: 'amenity', value: 'hospital' },
    { key: 'healthcare', value: 'hospital' },
  ],
  clinic: [
    { key: 'amenity', value: 'clinic' },
    { key: 'healthcare', value: 'clinic' },
  ],
  pharmacy: [
    { key: 'amenity', value: 'pharmacy' },
    { key: 'healthcare', value: 'pharmacy' },
  ],
  restaurant: [
    { key: 'amenity', value: 'restaurant' },
  ],
  cafe: [
    { key: 'amenity', value: 'cafe' },
  ],
  hotel: [
    { key: 'tourism', value: 'hotel' },
  ],
  motel: [
    { key: 'tourism', value: 'motel' },
  ],
  school: [
    { key: 'amenity', value: 'school' },
  ],
  university: [
    { key: 'amenity', value: 'university' },
  ],
  bank: [
    { key: 'amenity', value: 'bank' },
  ],
  gym: [
    { key: 'leisure', value: 'fitness_centre' },
    { key: 'amenity', value: 'gym' },
  ],
  fitness: [
    { key: 'leisure', value: 'fitness_centre' },
  ],
  lawyer: [
    { key: 'office', value: 'lawyer' },
  ],
  attorney: [
    { key: 'office', value: 'lawyer' },
  ],
  accountant: [
    { key: 'office', value: 'accountant' },
  ],
  realestate: [
    { key: 'office', value: 'estate_agent' },
  ],
  'real estate': [
    { key: 'office', value: 'estate_agent' },
  ],
  supermarket: [
    { key: 'shop', value: 'supermarket' },
  ],
  store: [
    { key: 'shop', value: '' },
  ],
  shop: [
    { key: 'shop', value: '' },
  ],
  car: [
    { key: 'shop', value: 'car' },
    { key: 'amenity', value: 'car_repair' },
  ],
  beauty: [
    { key: 'shop', value: 'beauty' },
    { key: 'amenity', value: 'beauty' },
  ],
  salon: [
    { key: 'shop', value: 'beauty' },
    { key: 'shop', value: 'hairdresser' },
  ],
  laundry: [
    { key: 'shop', value: 'laundry' },
  ],
  therapist: [
    { key: 'healthcare', value: 'therapist' },
  ],
  physio: [
    { key: 'healthcare', value: 'physiotherapist' },
  ],
  physiotherapist: [
    { key: 'healthcare', value: 'physiotherapist' },
  ],
  optician: [
    { key: 'shop', value: 'optician' },
  ],
  bakery: [
    { key: 'shop', value: 'bakery' },
    { key: 'amenity', value: 'bakery' },
  ],
  butcher: [
    { key: 'shop', value: 'butcher' },
  ],
  pet: [
    { key: 'shop', value: 'pet' },
  ],
  veterinary: [
    { key: 'amenity', value: 'veterinary' },
  ],
  vet: [
    { key: 'amenity', value: 'veterinary' },
  ],
  gas: [
    { key: 'amenity', value: 'fuel' },
  ],
  fuel: [
    { key: 'amenity', value: 'fuel' },
  ],
  cinema: [
    { key: 'amenity', value: 'cinema' },
  ],
  library: [
    { key: 'amenity', value: 'library' },
  ],
  community: [
    { key: 'amenity', value: 'community_centre' },
  ],
  plumber: [
    { key: 'craft', value: 'plumber' },
  ],
  electrician: [
    { key: 'craft', value: 'electrician' },
  ],
  photographer: [
    { key: 'craft', value: 'photographer' },
    { key: 'shop', value: 'photo' },
  ],
  tailor: [
    { key: 'shop', value: 'tailor' },
    { key: 'craft', value: 'tailor' },
  ],
  insurance: [
    { key: 'office', value: 'insurance' },
  ],
  'travel agency': [
    { key: 'office', value: 'travel_agent' },
    { key: 'shop', value: 'travel_agency' },
  ],
  'advertising agency': [
    { key: 'office', value: 'advertising_agency' },
  ],
  'marketing agency': [
    { key: 'office', value: 'advertising_agency' },
  ],
  'it company': [
    { key: 'office', value: 'it' },
  ],
  'software company': [
    { key: 'office', value: 'it' },
  ],
  'tech company': [
    { key: 'office', value: 'it' },
  ],
  coworking: [
    { key: 'office', value: 'coworking' },
  ],
  architect: [
    { key: 'office', value: 'architect' },
  ],
  consulting: [
    { key: 'office', value: 'consulting' },
  ],
  consultant: [
    { key: 'office', value: 'consulting' },
  ],
  'construction company': [
    { key: 'office', value: 'construction_company' },
  ],
  ngo: [
    { key: 'office', value: 'ngo' },
  ],
  'employment agency': [
    { key: 'office', value: 'employment_agency' },
  ],
  'recruitment agency': [
    { key: 'office', value: 'employment_agency' },
  ],
  'financial advisor': [
    { key: 'office', value: 'financial_advisor' },
  ],
  notary: [
    { key: 'office', value: 'notary' },
  ],
  'car dealer': [
    { key: 'shop', value: 'car' },
  ],
  'car dealership': [
    { key: 'shop', value: 'car' },
  ],
  'furniture store': [
    { key: 'shop', value: 'furniture' },
  ],
  'electronics store': [
    { key: 'shop', value: 'electronics' },
  ],
  'mobile phone shop': [
    { key: 'shop', value: 'mobile_phone' },
  ],
  'clothing store': [
    { key: 'shop', value: 'clothes' },
  ],
  bookstore: [
    { key: 'shop', value: 'books' },
  ],
  'hardware store': [
    { key: 'shop', value: 'hardware' },
  ],
  spa: [
    { key: 'leisure', value: 'spa' },
  ],
  'logistics company': [
    { key: 'office', value: 'logistics' },
  ],
  'courier service': [
    { key: 'shop', value: 'couriers' },
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeLocation(query: string): Promise<NominatimResult | null> {
  try {
    const response = await axios.get<NominatimResult[]>(NOMINATIM_API, {
      params: {
        q: query,
        format: 'json',
        limit: 1,
        addressdetails: 1,
        'accept-language': 'en',
      },
      headers: {
        'User-Agent': 'LeadExtractor/1.0',
      },
      timeout: 15000,
    });

    await sleep(1000); // Respect Nominatim's rate limit (1 req/sec)

    if (response.data && response.data.length > 0) {
      return response.data[0];
    }
    return null;
  } catch (error) {
    console.error('[OSM] Geocoding failed for:', query, error);
    return null;
  }
}

function buildOverpassBBoxQuery(keyword: string, bbox: { south: number; west: number; north: number; east: number }, limit: number): string {
  const normalizedTags = normalizeOsmKeyword(keyword);

  const { south, west, north, east } = bbox;
  const coord = `${south},${west},${north},${east}`;

  let tagFilters: string;

  if (normalizedTags) {
    tagFilters = normalizedTags
      .map((tag) => {
        if (!tag.value) {
          return `node["${tag.key}"](${coord});way["${tag.key}"](${coord});relation["${tag.key}"](${coord});`;
        }
        return `node["${tag.key}"="${tag.value}"](${coord});way["${tag.key}"="${tag.value}"](${coord});relation["${tag.key}"="${tag.value}"](${coord});`;
      })
      .join('\n');
  } else {
    // No known OSM category for this keyword (common for B2B/online-only
    // categories like "SaaS company" that aren't mapped as physical POIs).
    // Fall back to a case-insensitive substring match against the business
    // name itself, instead of the old exact-match query which almost always
    // returned zero results. Web search is expected to carry most of the
    // weight for these keywords — OSM only helps when the keyword also
    // happens to appear in the business's literal name.
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    tagFilters = `node["name"~"${escaped}",i](${coord});way["name"~"${escaped}",i](${coord});relation["name"~"${escaped}",i](${coord});`;
  }

  const limitClause = limit > 0 ? `out center ${limit};` : `out center;`;

  return `[out:json][timeout:30];
(${tagFilters}
);
${limitClause}`;
}

function normalizeOsmKeyword(keyword: string): { key: string; value: string }[] | null {
  const lower = keyword.toLowerCase().trim();

  const aliases: Record<string, string> = {
    restraunt: 'restaurant',
    resturant: 'restaurant',
    restaraunt: 'restaurant',
    restrauct: 'restaurant',
    resturent: 'restaurant',
    restaurent: 'restaurant',
    restraurant: 'restaurant',
    coffee: 'cafe',
    coffeeshop: 'cafe',
    'coffee shop': 'cafe',
    gymnasium: 'gym',
    'insurance agent': 'insurance',
    'insurance agency': 'insurance',
    'car wash': 'car',
    'car repair': 'car',
    mechanic: 'car',
    pharmacy: 'pharmacy',
    optometrist: 'optician',
    'day care': 'school',
    daycare: 'school',
    'daycare center': 'school',
    'play school': 'school',
    kindergarten: 'school',
    florist: 'shop',
    'flower shop': 'shop',
    jeweler: 'shop',
    jewelry: 'shop',
    'beauty salon': 'salon',
    'hair salon': 'salon',
    'salon de beaute': 'salon',
    'beauty parlor': 'beauty',
    'barber': 'beauty',
    'barber shop': 'beauty',
    'cleaning service': '',
    'pet store': 'pet',
    'pet shop': 'pet',
    'veterinary clinic': 'veterinary',
    'veterinary hospital': 'veterinary',
  };

  const normalized = aliases[lower] || lower;
  const tags = KEYWORD_TO_OSM_TAG[normalized];

  if (tags) return tags;

  // Try partial match against known categories
  for (const [category, catTags] of Object.entries(KEYWORD_TO_OSM_TAG)) {
    if (lower.includes(category) && category.length >= 4) {
      return catTags;
    }
  }

  return null;
}

function parseOverpassResults(elements: OverpassElement[], sourceKeyword: string, city: string, country: string, countryCode?: string): DiscoveryBusiness[] {
  const businesses: DiscoveryBusiness[] = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'] || tags['name:en-GB'];
    if (!name) continue;

    const website = tags.website || tags.url || null;
    const phone = tags.phone || tags['contact:phone'] || tags['phone:mobile'] || null;
    const email = tags.email || tags['contact:email'] || null;
    const instagram = tags['contact:instagram'] || tags.instagram || null;
    const facebook = tags['contact:facebook'] || tags.facebook || null;
    const linkedin = tags['contact:linkedin'] || tags.linkedin || null;

    const lat = el.lat || el.center?.lat;
    const lon = el.lon || el.center?.lon;

    let address = '';
    const addrParts: string[] = [];
    if (tags['addr:housenumber']) addrParts.push(tags['addr:housenumber']);
    if (tags['addr:street']) addrParts.push(tags['addr:street']);
    if (tags['addr:city']) addrParts.push(tags['addr:city']);
    if (tags['addr:state']) addrParts.push(tags['addr:state']);
    if (tags['addr:postcode']) addrParts.push(tags['addr:postcode']);
    address = addrParts.join(', ');

    businesses.push({
      name,
      address: address || undefined,
      city: city || tags['addr:city'] || undefined,
      country,
      country_code: countryCode || undefined,
      website: website || undefined,
      phone: phone || undefined,
      email: email || undefined,
      instagram: instagram || undefined,
      facebook: facebook || undefined,
      linkedin: linkedin || undefined,
      latitude: lat,
      longitude: lon,
      source: 'osm',
      category: sourceKeyword,
    });
  }

  return businesses;
}

async function overpassRequest(query: string, shouldAbort?: () => Promise<boolean>): Promise<OverpassResponse | null> {
  // Rotate through the mirror list with a short per-mirror timeout. A healthy
  // mirror answers a local-bbox query in <10s; 15s is generous. When one
  // mirror fails we move to the next quickly instead of each attempt burning
  // 40s, so a dead instance can never stall the whole location.
  for (const mirror of OVERPASS_MIRRORS) {
    if (shouldAbort && (await shouldAbort())) return null;
    try {
      const response = await axios.post<OverpassResponse>(
        mirror,
        `data=${encodeURIComponent(query)}`,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'LeadExtractor/1.0',
          },
          timeout: OVERPASS_TIMEOUT_MS,
          validateStatus: (status) => status >= 200 && status < 500,
        }
      );

      if (response.status === 200) {
        return response.data;
      }

      console.warn(`[OSM] Overpass mirror ${mirror} returned status ${response.status}; trying next...`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[OSM] Overpass mirror ${mirror} failed: ${message}`);
    }

    await sleep(OVERPASS_RETRY_DELAY_MS);
  }

  return null;
}

function widenBBox(
  bbox: { south: number; west: number; north: number; east: number },
  multiplier: number
): { south: number; west: number; north: number; east: number } {
  const centerLat = (bbox.south + bbox.north) / 2;
  const centerLon = (bbox.west + bbox.east) / 2;
  const halfHeight = ((bbox.north - bbox.south) / 2) * multiplier;
  const halfWidth = ((bbox.east - bbox.west) / 2) * multiplier;
  return {
    south: centerLat - halfHeight,
    north: centerLat + halfHeight,
    west: centerLon - halfWidth,
    east: centerLon + halfWidth,
  };
}

/**
 * Clamp a bbox to `maxSpanDeg` per axis, centred on the bbox centroid.
 * A name-regex Overpass query over a multi-degree city/country bbox scans
 * hundreds of thousands of nodes and makes every mirror hang (504/timeout) —
 * the "upstream failed" wall. A ~0.3deg bbox answers in ~2s. Keeps queries
 * fast while still covering a full metro area.
 */
function capBBoxSpan(
  bbox: { south: number; west: number; north: number; east: number },
  maxSpanDeg: number
): { south: number; west: number; north: number; east: number } {
  const centerLat = (bbox.south + bbox.north) / 2;
  const centerLon = (bbox.west + bbox.east) / 2;
  const half = maxSpanDeg / 2;
  return {
    south: centerLat - half,
    north: centerLat + half,
    west: centerLon - half,
    east: centerLon + half,
  };
}

export async function discoverFromOSM(
  keyword: string,
  city: string,
  country: string,
  limit: number = 50,
  round: number = 0,
  shouldAbort?: () => Promise<boolean>
): Promise<DiscoveryBusiness[]> {
  try {
    // Step 1: Geocode the location
    if (shouldAbort && (await shouldAbort())) return [];
    const locationQuery = city
      ? `${city}, ${country}`
      : country;

    const geoResult = await geocodeLocation(locationQuery);

    if (!geoResult) {
      console.error(`[OSM] Could not geocode location: ${locationQuery}`);
      return [];
    }

    if (shouldAbort && (await shouldAbort())) return [];

    await sleep(1500);

    // Step 2: Build bbox if available, otherwise use area query
    const lat = parseFloat(geoResult.lat);
    const lon = parseFloat(geoResult.lon);

    // Create a bounding box around the geocoded location (roughly 15km x 15km for cities)
    // Adjust based on whether we're searching a city or whole country
    let bbox: { south: number; west: number; north: number; east: number };

    if (geoResult.boundingbox && geoResult.boundingbox.length >= 4) {
      const south = parseFloat(geoResult.boundingbox[0]);
      const north = parseFloat(geoResult.boundingbox[1]);
      const west = parseFloat(geoResult.boundingbox[2]);
      const east = parseFloat(geoResult.boundingbox[3]);
      bbox = { south, west, north, east };
    } else {
      // Default bbox ~15km around the point
      const delta = city ? 0.15 : 2.0; // cities: ~15km, countries: ~200km
      bbox = {
        south: lat - delta,
        west: lon - delta,
        north: lat + delta,
        east: lon + delta,
      };
    }

    // Later rounds widen the search area to surface businesses missed by a
    // tight bbox, capped at 4x so it never blows up into a country-scale
    // query for a single-city search. Overpass's own `out center <limit>`
    // clause still bounds the result size regardless of bbox size.
    if (round > 0) {
      const multiplier = Math.min(1 + round * 0.75, 4);
      bbox = widenBBox(bbox, multiplier);
    }

    // Always clamp the final bbox: a name-regex scan over a huge city/country
    // box stalls every mirror (this was the #1 OSM failure). 0.3deg cities /
    // 0.5deg countries keep queries in the 1-5s range while covering a metro.
    bbox = capBBoxSpan(bbox, city ? 0.3 : 0.5);

    const countryCode = geoResult.address?.country_code?.toUpperCase() || countryNameToISO2(country) || undefined;

    // Step 3: Query Overpass with bbox (mirror rotation + retry)
    if (shouldAbort && (await shouldAbort())) return [];
    const query = buildOverpassBBoxQuery(keyword, bbox, limit);
    console.log(`[OSM] Querying Overpass bbox=${JSON.stringify(bbox)} keyword="${keyword}" round=${round}`);

    const overpassData = await overpassRequest(query, shouldAbort);

    if (!overpassData) {
      console.error('[OSM] All Overpass mirrors failed');
      return [];
    }

    const elements = overpassData.elements || [];
    const businesses = parseOverpassResults(elements, keyword, city, country, countryCode);

    return businesses.slice(0, limit);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown OSM error';
    console.error(`OSM discovery failed for "${keyword}" in ${city || country}:`, message);
    return [];
  }
}
