import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

export function formatDateShort(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

export function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// A small set of 2-letter ccTLDs that are commonly used as global/branding
// domains far outside their registering country (.io for tech, .ai for AI
// products, .co as a surrogate for .com, .me for personal sites, .tv for
// media). Treating them as a country signal would falsely reject legitimate
// businesses, so these are NEVER treated as a "wrong country" evidence even
// when the target country is known.
const GLOBAL_OR_TRACKING_CC_TLDS = new Set([
  'io', 'ai', 'co', 'me', 'tv', 'fm', 'gg', 'je', 'sh', 'so', 'ws',
  'cc', 'tk', 'ga', 'cf', 'gq', 'ml', 'am', 'as', 'cx', 'la', 'li',
  'ly', 'nu', 'pw', 'st', 'tc', 'vg',
]);

/**
 * When a target ISO2 country is known and a host's top-level label is a ccTLD
 * that maps to a DIFFERENT country, that is strong evidence the domain does
 * not belong to this business (a Karachi "Builder Burger" is not hosted on
 * builder.bg). Returns true when the host is inconsistent with the country;
 * false when the TLD is generic (.com), matches the target, is a
 * globally-reused ccTLD, or no country context is given.
 */
export function isForeignCcTldMatch(
  host: string | null | undefined,
  countryCode?: string | null
): boolean {
  if (!host || !countryCode) return false;
  const c1 = countryCode.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(c1)) return false;
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length < 2) return false;
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2}$/.test(tld)) return false;
  if (GLOBAL_OR_TRACKING_CC_TLDS.has(tld)) return false;
  return tld !== c1;
}

// Builds a plain Google Maps deep-link so a lead's exact location opens in
// one click — it only constructs a URL for the user's own browser to navigate
// to (like any "get directions" button), it does not scrape Maps.
// When we have the business name it searches "{name}, {address}" so Google
// opens that exact place's details card instead of a generic coordinate pin.
export function getMapUrl(input: {
  businessName?: string | null;
  business_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
}): string | null {
  const name = (input.businessName ?? input.business_name)?.trim();
  if (name) {
    const locationParts = [input.address, input.city, input.country].filter(Boolean);
    const query = locationParts.length > 0 ? `${name}, ${locationParts.join(', ')}` : name;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }
  if (input.latitude != null && input.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${input.latitude},${input.longitude}`;
  }
  const parts = [input.address, input.city, input.country].filter(Boolean);
  if (parts.length === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Generic venue/category words stripped from a business name before matching a
// website domain against it, so a single shared word like "banquet" or
// "palace" never makes an unrelated global company's site look credible
// (e.g. "Fairmont Banquet" vs fairmont.com, "Regent Banquet" vs
// regenthotels.com, "Liberty Banquet" vs libertyinsurance.com.vn).
const GENERIC_CATEGORY_WORDS = new Set([
  // venues
  'banquet', 'banquets', 'halls', 'hall', 'venue', 'venues', 'wedding', 'weddings',
  'marriage', 'marquee', 'marquees', 'lawn', 'lawns', 'palace', 'haveli', 'lounge',
  'loungees', 'rooftop',
  // food & hospitality
  'restaurant', 'restaurants', 'hotel', 'hotels', 'cafe', 'café', 'cafes', 'bistro',
  'grill', 'kitchen', 'house', 'home', 'diner',
  // misc
  'club', 'resort', 'resorts', 'center', 'centre', 'studio', 'studios', 'services',
  'company', 'group', 'pvt', 'private', 'limited', 'ltd', 'llc', 'inc', 'trading',
  'enterprises', 'associates', 'solutions',
]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4);
}

/** Business-name tokens that carry the brand, after generic category words
    (banquet/hall/venue/...) are removed. Location words may remain, which is
    fine — the credibility rule needs the BRAND token to match, not every one. */
export function distinctiveBusinessTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  const all = nameTokens(name);
  const distinctive = all.filter((t) => !GENERIC_CATEGORY_WORDS.has(t));
  return distinctive.length > 0 ? distinctive : all;
}

/**
 * A website is "credible" for a business when its domain clearly overlaps the
 * business brand (e.g. rocksaltusa.com ~ "Rock Salt USA", bulksalt.com ~
 * "Bulk Salt"). Google Maps/OSM/web-search sometimes surface a neighbouring or
 * unrelated company's site on the wrong listing (saltboxrecordsla.com on a
 * crystals company; fairmont.com on a Karachi "Fairmont Banquet"); trusting
 * that domain to source phone/email/socials is exactly how wrong-but-"verified"
 * data leaks in.
 *
 * Rules (professional/strict):
 *  - 2+ distinctive tokens -> at least 2 must appear in the domain, OR exactly
 *    the second-level domain must BE the single matched token (keeps real
 *    "kaybees.com.pk" vs "Galaxy Palace Banquet"->galaxycine.vn apart).
 *  - 1 distinctive token -> a location/country signal is required when the
 *    business country is known (ccTLD matches, or city/country appears in the
 *    host). This rejects global-brand lookalikes (fairmont.com, regenthotels.
 *    com, emerald.com, galaxycine.vn) while keeping kaybees.com.pk /
 *    ourmoments.pk.
 */
export function isCredibleWebsiteMatch(
  website: string | undefined | null,
  businessName: string | null | undefined,
  geo?: { city?: string | null; country?: string | null; countryCode?: string | null }
): boolean {
  if (!website || !businessName) return false;
  let host: string;
  try {
    host = new URL(website).hostname.replace(/^www\./, '').toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  const labels = host.split('.');
  if (labels.length < 2) return false;

  const tld = labels[labels.length - 1];
  const isCountryCC = /^[a-z]{2}$/.test(tld);
  const penultimate = labels[labels.length - 2] || '';
  // Peel a public suffix (.co.uk, .com.pk) so the apex name is the real brand.
  let rootLabels = labels;
  if (isCountryCC && ['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'ltd', 'me', 'in', 'biz', 'web'].includes(penultimate)) {
    rootLabels = labels.slice(0, -2);
  } else if (isCountryCC) {
    rootLabels = labels.slice(0, -1);
  }
  const sld = rootLabels[rootLabels.length - 1] || '';
  const domainPhrase = rootLabels.join('');

  // Country/ccTLD consistency is a hard precondition: a domain on a foreign
  // country-code TLD can never be the site of a business whose country is
  // known (a Karachi "Builder Burger" is not builder.bg). Note the peeled root
  // labels — for shahi.com.pk the array is ['shahi'], whose last label (.pk)
  // is NOT what we compare; we must use the raw host TLD here.
  if (isForeignCcTldMatch(host, geo?.countryCode)) return false;

  const tokens = distinctiveBusinessTokens(businessName);
  const matched = tokens.filter(
    (tok) => domainPhrase.includes(tok) || sld.includes(tok) || tok.includes(sld)
  );

  if (matched.length === 0) return false;

  if (tokens.length >= 2) {
    // Brand must be substantially covered by the domain. A single shared word
    // is not enough: "Galaxy Palace" matching the "galaxy" in galaxycine.vn
    // must fail, while "Kaybees - Gulshan-e-Iqbal" matching kaybees.com.pk
    // (sld === the one matched token) still passes.
    if (matched.length >= 2) return true;
    return matched.length === 1 && sld === matched[0];
  }

  // Single distinctive token: require a location/country signal.
  const token = tokens[0];
  const ccMatches = isCountryCC && !!geo?.countryCode && tld === geo.countryCode.toLowerCase();
  let geoHint = false;
  if (geo) {
    const hints = [geo.city, geo.country]
      .filter(Boolean)
      .map((h) => (h as string).toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter((h) => h.length >= 4);
    geoHint = hints.some((h) => domainPhrase.includes(h));
  }
  if (geo?.countryCode || (geo && (geo.city || geo.country))) {
    return ccMatches || geoHint;
  }
  // No country context at all — fall back to a strong apex-name match.
  return sld === token || domainPhrase === token;
}
