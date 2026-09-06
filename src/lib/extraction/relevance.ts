// Relevance guards for discovery/enrichment.
//
// The web/Bing search engines turn each SERP result (title + snippet) into a
// candidate business. That admits non-business pages (Intel driver downloads,
// XBOX product pages) and unrelated companies (a courier showing up for
// "salt dealers") — all of which pass the technical verified check once they
// expose any valid-looking phone/email. These helpers impose the missing
// *relevance* requirement:
//   - isRelevantToKeyword  — candidate text must echo at least one keyword token
//   - hasJunkTitle         — page patterns (driver/download/manual) + mostly
//                            non-Latin titles that aren't real business names
//   - hasJunkUrl           — global corporate/product/marketplace domains and
//                            docs/login paths that are never local businesses
//
// Pure string helpers: no IO, no framework, no alias imports (keeps the
// standalone revalidation script in scripts/ dependency-free).

const STOPWORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'near', 'for', 'of', 'to', 'and', 'or', 'with',
  'any', 'all', 'best', 'top', 'rated', 'located', 'around', 'call', 'phone',
  'contact', 'number', 'list', 'listing', 'listings', 'service', 'services',
]);

const JUNK_TITLE_PATTERNS = [
  /\b(?:driver|drivers)\b/i,
  /\bfirmware\b/i,
  /\bbios\b/i,
  /\b(?:download|downloads)\b/i,
  /\b(?:installer|installation)\b/i,
  /\buser(?:'s)?\s+(?:guide|manual)\b|\bowner(?:'s)?\s+(?:guide|manual)\b|\bservice\s+manual\b/i,
  /\b(?:specifications?|spec\s*sheet)\b/i,
  /\b(?:sign\s*in|sign\s*up|log\s*in|log\s*on|create\s+account|cookie\s+policy|privacy\s+policy|terms\s+of\s+service|terms\s+and\s+conditions)\b/i,
  /\b(?:cart|checkout|wishlist)\b/i,
  /\b(?:wiki|documentation|known\s+issues?)\b/i,
  /\b(?:error|not\s+found)\s*\d*\b/i,
];

// Clearly non-local-business domains: global tech/corporate pages, product
// marketplaces, news, forums. A real local dealer is never "intel.com".
// NOTE: search-engine hostnames (bing.com, duckduckgo.com) are deliberately
// absent — Bing wraps organic results in a /ck/a redirect wrapper, so the
// hostname seen at discovery is bing.com for EVERY result. The title/snippet
// relevance check is what filters those, not the domain list.
const JUNK_URL_DOMAINS = [
  'intel.com', 'microsoft.com', 'xbox.com', 'nvidia.com', 'amd.com', 'qualcomm.com',
  'arm.com', 'broadcom.com', 'realtek.com', 'dell.com', 'hp.com', 'lenovo.com',
  'acer.com', 'asus.com', 'msi.com', 'gigabyte.com', 'apple.com', 'samsung.com',
  'sony.com', 'lg.com', 'google.com', 'android.com', 'news.google.com', 'docs.google.com',
  'amazon.com', 'amazon.in', 'amazon.co.uk', 'amazon.de', 'aliexpress.com', 'alibaba.com',
  'ebay.com', 'etsy.com', 'walmart.com', 'bestbuy.com', 'target.com', 'newegg.com',
  'flipkart.com', 'snapdeal.com', 'alan.com',
  'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com',
  'medium.com', 'wikipedia.org', 'wiktionary.org', 'britannica.com', 'investopedia.com',
  'reddit.com', 'quora.com', 'cnn.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com',
  'wsj.com', 'reuters.com', 'theguardian.com', 'foxnews.com', 'msn.com', 'cnbc.com',
  'vizaca.com', 'lenster.app',
  'fedex.com', 'ups.com', 'usps.com', 'dhl.com',
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stemVariants(token: string): string[] {
  const set = new Set<string>([token]);
  set.add(`${token}s`);
  set.add(`${token}es`);
  set.add(`${token}ies`);
  if (token.endsWith('y') && token.length > 2) set.add(`${token.slice(0, -1)}ies`);
  if (token.endsWith('ies') && token.length > 4) set.add(`${token.slice(0, -3)}y`);
  if (token.endsWith('s') && token.length > 2 && !token.endsWith('ss') && !token.endsWith('us')) {
    set.add(token.slice(0, -1));
  }
  if (token.endsWith('es') && token.length > 3) set.add(token.slice(0, -2));
  return [...set];
}

/** Lowercased, stopword-stripped alpha tokens extracted from the keyword. */
export function buildKeywordTokens(keyword: string): string[] {
  const text = normalizeText(keyword);
  if (!text) return [];
  return [...new Set(text.split(/\s+/).filter((t) => {
    if (t.length < 3) return false;
    if (/^\d+$/.test(t)) return false;
    return !STOPWORDS.has(t);
  }))];
}

/**
 * True when the candidate text contains at least one meaningful token of the
 * search keyword (with plural/tense variants). A keyword with no meaningful
 * tokens never over-filters, and a candidate whose SERP title/snippet echoes
 * the keyword is by construction relevant to it.
 */
export function isRelevantToKeyword(keyword: string, text: string): boolean {
  const tokens = buildKeywordTokens(keyword);
  if (tokens.length === 0) return true;

  const searchable = normalizeText(text);
  if (!searchable) return false;

  return tokens.some((token) => {
    const pattern = new RegExp(
      `\\b(?:${stemVariants(token).map(escapeRegExp).join('|')})\\b`
    );
    return pattern.test(searchable);
  });
}

/**
 * Junk title heuristics: product/download/support/manual page patterns and
 * titles dominated by non-Latin scripts (mostly tech/marketing spam in the
 * SERP). `ignoreNonLatin` disables the script-ratio check — pass it when the
 * keyword itself has no alpha tokens (a non-Latin query), so we never drop
 * legitimately-local businesses.
 */
export function hasJunkTitle(name: string, ignoreNonLatin = false): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;

  if (JUNK_TITLE_PATTERNS.some((p) => p.test(trimmed))) return true;

  if (!ignoreNonLatin) {
    const chars = trimmed.replace(/\s+/g, '');
    if (chars.length > 3) {
      let latin = 0;
      for (const ch of chars) {
        if (/[A-Za-z0-9]/.test(ch)) latin++;
      }
      const ratio = (chars.length - latin) / chars.length;
      if (ratio > 0.55) return true;
    }
  }

  return false;
}

/** Global corporate/product/marketplace domains and docs/login page paths. */
export function hasJunkUrl(url: string): boolean {
  if (!url) return false;

  const cleaned = url.trim();
  if (!/^https?:\/\//i.test(cleaned)) return false;
  if (cleaned.length > 3000) return true;

  try {
    const u = new URL(cleaned);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();

    if (JUNK_URL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;

    const path = u.pathname.toLowerCase();
    if (/(?:^|\/)(?:downloads?|drivers?|manuals?|docs?|wiki)\//i.test(path)) return true;
    if (/(?:^|\/)(?:login|signin|sign-in|signup|sign-up|checkout|cart)\//i.test(path)) return true;

    const fileExt = u.pathname.split('/').pop() || '';
    if (/\.(?:pdf|zip|exe|msi|dmg|docx?|xlsx?|pptx?)$/i.test(fileExt)) return true;
  } catch {
    // Unparseable URL — not a junk signal by itself.
  }

  return false;
}

/**
 * Convenience for engine discovery: a candidate is droppable when its
 * title or URL trips the junk heuristics. `keywordTokensPresent` gates the
 * non-Latin title check (see hasJunkTitle).
 */
export function isJunkEngineResult(
  title: string,
  url: string,
  keywordTokensPresent: boolean
): boolean {
  return hasJunkTitle(title, !keywordTokensPresent) || hasJunkUrl(url);
}

/** Engine sources whose candidates must ALSO match the search keyword. */
export const RELEVANCE_GATED_SOURCES = new Set(['web_search', 'bing', 'bing_search']);