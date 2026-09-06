// Web/Bing search returns generic informational pages (Wikipedia-style
// "What is a dentist?", dictionary definitions, listicles, forum threads)
// mixed in with real business listings. The discovery pipeline treats each
// search result as a single candidate business, so this content — if not
// filtered — gets scraped and persisted as fake-looking "leads" that were
// never real businesses to begin with. This filter rejects the common
// patterns before they ever become a DiscoveryBusiness candidate.

const NON_BUSINESS_DOMAINS = [
  'wikipedia.org', 'wiktionary.org', 'britannica.com', 'dictionary.com',
  'merriam-webster.com', 'investopedia.com', 'quora.com', 'reddit.com',
  'youtube.com', 'medium.com', 'healthline.com', 'medicalnewstoday.com',
  'webmd.com', 'verywellhealth.com', 'mayoclinic.org', 'forbes.com',
  'businessinsider.com', 'wikihow.com', 'thefreedictionary.com',
  'vocabulary.com', 'etymonline.com', 'nih.gov', 'ncbi.nlm.nih.gov',
];

const NON_BUSINESS_TITLE_PATTERNS = [
  /^(what|why|how|when|who|which|where)\b/i,
  /\bdefinition\b/i,
  /\bmeaning\b/i,
  /\bwikipedia\b/i,
  /\bguide to\b/i,
  /^top\s*\d+/i,
  /^best\s*\d+/i,
  /^\d+\+?\s*best\b/i,
  /\bvs\.?\b/i,
];

const NON_BUSINESS_TITLE_EXTRA_ONLY = [
  // Hashtag spam / social-promo strings that leak into search results
  /^#/,                                     // starts with hashtag
  /\s#\w{2,}\s#\w{2,}/,                     // two+ hashtags in body
  // "Advertisement/click-to-call" style junk
  /\bVRT\b.*\bcall\b/i,
  /\b(?:click to call|tap to call|call now|free call)\b/i,
  // Generic result / spam words
  /\b(?:results?|listings?|price list|market report)\b/i,
  // Video/streaming junk masquerading as businesses
  /\b(?:bokep|xxx|porn|adult|sex)\b/i,
];

// Heuristic: a plausible business name should be mostly Latin letters
// (Google Maps/discovery sources are name-based). Titles dominated by
// non-Latin scripts (Arabic, Urdu-extension emoji, Cyrillic mixing) or by
// numbers + generic words are almost never clean listings.
const LATIN_LETTER_RE = /[A-Za-z]/;
const HAS_HASHTAG_RE = /#/;
const HAS_EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// Google Maps feed chrome/envelope labels that appear as cards but are NOT
// businesses. These leak in via the feed's per-card innerText and must never
// be treated as a business name.
const MAPS_CHROME_NAME_PATTERNS = [
  /^price\s*rating\s*hours\s*all\s*filters\b/i,
  /^rating\s*hours\s*all\s*filters\b/i,
  /^you'?ve reached the end of the list\.?$/i,
  /^get the most out of google maps\.?$/i,
  /^(show results|open now|open today|closed|temporarily closed|permanently closed)\.?$/i,
  /^(reviews?|photos|about|overview|directions|save|share|send to phone|nearby)$/i,
  /^(related searches|other places nearby)$/i,
  /^(postal code|categories?|hours?|prices?|website\.?|phone\.?)$/i,
  /^(all filters|recommended|top rated|most reviewed|highest rated)$/i,
  /^(saved|recents?|get app|send feedback)$/i,
];

export function isLikelyNonBusinessResult(title: string, url: string): boolean {
  const trimmedTitle = title.trim();
  if (NON_BUSINESS_TITLE_PATTERNS.some((p) => p.test(trimmedTitle))) return true;
  if (NON_BUSINESS_TITLE_EXTRA_ONLY.some((p) => p.test(trimmedTitle))) return true;

  // Emojis / hashtags in a title almost always mean social-promo or spam.
  if (HAS_EMOJI_RE.test(trimmedTitle) || HAS_HASHTAG_RE.test(trimmedTitle)) return true;

  // Reject titles with essentially no Latin letters (e.g. Arabic hashtag spam).
  if (trimmedTitle.length > 0 && !LATIN_LETTER_RE.test(trimmedTitle)) return true;

  // A bare category word with nothing else ("Dentist", "Dentistry") isn't a
  // business name — real listings are titled after the specific business.
  if (/^[a-z]+$/i.test(trimmedTitle) && trimmedTitle.split(' ').length === 1) return true;

  try {
    const domain = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    if (NON_BUSINESS_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  } catch {
    // No parseable URL — fall through, title check already ran.
  }

  return false;
}

// Full-business validation used by Google Maps results too — a valid business
// needs a real name and ideally a phone or a website. Stronger than the
// per-title filter above (which only checks the title/url quickly).
export function isLikelyGarbageBusiness(name: string, phone?: string | null, website?: string | null): boolean {
  const trimmedName = name.trim();
  if (!trimmedName) return true;
  if (MAPS_CHROME_NAME_PATTERNS.some((p) => p.test(trimmedName))) return true;
  if (isLikelyNonBusinessResult(trimmedName, website || '')) return true;
  // A "lead" with neither a phone nor a website has no usable contact
  // channel — drop it rather than persist a dead record unless it has an email.
  return false;
}

// Same idea as isLikelyGarbageBusiness but returns true for businesses that
// are fine (i.e. "is this business ill-formed / droppable?"). Used by the
// discovery pipeline to pre-filter candidates before enrichment.
//
// Note: this deliberately does NOT require a phone/website — those are often
// filled in later by enrichment/detail-click. It only drops clear garbage
// (hashtag spam, emoji junk, non-Latin strings, adult/non-business titles).
export function isIllFormedBusiness(name: string): boolean {
  if (MAPS_CHROME_NAME_PATTERNS.some((p) => p.test(name.trim()))) return true;
  return isLikelyNonBusinessResult(name, '');
}
