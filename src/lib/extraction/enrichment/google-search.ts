import { withPage } from '../browser';
import { isCredibleWebsiteMatch, distinctiveBusinessTokens } from '@/lib/utils';
import { countryNameToISO2 } from '@/lib/utils/countries';
import { validatePhone } from '@/lib/utils/phone';

interface SearchFallbackResult {
  phone?: string;
  email?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Placeholder / junk emails that regularly show up in scraped templates and
// Bing snippets but are NOT a real business contact address.
const PLACEHOLDER_EMAILS = new Set([
  'user@domain.com', 'user@example.com', 'your@email.com', 'youremail@domain.com',
  'your@domain.com', 'email@domain.com', 'name@domain.com', 'yourname@domain.com',
  'info@domain.com', 'contact@domain.com', 'test@test.com', 'test@gmail.com',
  'example@example.com', 'mail@example.com', 'support@example.com',
  'demo@example.com', 'webmaster@example.com', 'admin@example.com',
  'changeme@example.com', 'your@emailaddress.com', 'emailaddress@yourdomain.com',
  'your.email@domain.com', 'placeholder@example.com', 'sample@example.com',
  'someone@example.com', 'hello@example.com', 'namet@example.com',
]);

// Domains that are clearly non-business / template / framework noise.
const EXCLUDED_DOMAINS = [
  'example.com', 'example.co.uk', 'example.org', 'example.net', 'example.edu',
  'domain.com', 'yourdomain.com', 'yopmail.com', 'mailinator.com',
  'sentry.io', 'wixpress.com', 'schema.org', 'w3.org', 'googleapis.com',
  'gstatic.com', 'bing.com', 'microsoft.com', 'wix.com', 'wpengine.com',
  'cloudflare.com', 'jsdelivr.net', 'unpkg.com', 'fonts.googleapis.com',
  'gravatar.com', 'sentry.com', 'template.com', 'yourcompany.com',
];

// File-extension style strings that a naive email regex can match, e.g.
// "wp-content/themes/theme@11.css" or ".sitemap@xml". Not real mail.
const FILE_EXT_TLDS = [
  'css', 'js', 'json', 'xml', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
  'pdf', 'min.css', 'min.js', 'map', 'ico', 'txt', 'html', 'htm',
];

function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const domain = lower.split('@')[1] || '';
  if (PLACEHOLDER_EMAILS.has(lower)) return true;
  if (EXCLUDED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  const tld = domain.split('.').pop() || '';
  if (FILE_EXT_TLDS.includes(tld)) return true;
  if (!domain.includes('.')) return true;
  return false;
}

function cleanPhone(raw: string): string {
  return raw.trim().replace(/[^\d+()\s.-]/g, '');
}

function extractPhones(text: string): string[] {
  // A phone: optional +country, optional area code, then groups of digits.
  // Use a pattern that requires *word boundaries* around the number so a
  // 15-19 digit Facebook page ID ("profile.php?id=123456789012345") is NOT
  // sliced into a "phone" — the caller validates digit length and shape.
  const pattern = /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?:\s*(?:ext|x|#)[.\s]*\d{1,5})?/gi;
  const matches = text.match(pattern) || [];
  const phones = matches
    .map((m) => cleanPhone(m))
    .filter((m) => {
      const digits = m.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return false;
      // Must not be a bare number with no separators AND 12+ digits — that's
      // almost always an ID (e.g. 615724432203 came from a FB page id).
      const hasSeperator = /[()\s.-]/.test(m);
      if (!hasSeperator && digits.length >= 12) return false;
      // An international-format number starting with "+" must not have an
      // absurdly long local part (> 11 digits) — real phone numbers never
      // need that many; this catches data-entry or page-ID junk like
      // "+1 7740563 83985".
      if (m.trim().startsWith('+') && digits.length > 12) return false;
      // Five or more consecutive identical digits inside the number are
      // almost certainly a placeholder, not a real line.
      if (/(\d)\1{4}/.test(digits)) return false;
      // Skip IP-ish "1.2.3.4" style matches.
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}/.test(m)) return false;
      return true;
    });
  const unique = [...new Set(phones)];
  return unique.sort(
    (a, b) =>
      (b.startsWith('+') ? 1 : 0) - (a.startsWith('+') ? 1 : 0) ||
      b.replace(/[^\d]/g, '').length - a.replace(/[^\d]/g, '').length
  );
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(matches)].filter((e) => !isJunkEmail(e));
}

function extractSocialUrls(text: string): { instagram?: string; facebook?: string; linkedin?: string } {
  const out: { instagram?: string; facebook?: string; linkedin?: string } = {};
  const clean = (u: string) => u.replace(/[.,;:!?"')>]+$/, '');

  const ig = text.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]+\/?/i);
  if (ig) {
    const url = clean(ig[0].startsWith('http') ? ig[0] : `https://${ig[0]}`);
    if (!/(\/explore|\/accounts|\/p\/|\/reel\/|\/stories|\/directory|\/invites)/i.test(url)) {
      out.instagram = url;
    }
  }
  const fb = text.match(/(?:https?:\/\/)?(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+\/?/i);
  if (fb) {
    const url = clean(fb[0].startsWith('http') ? fb[0] : `https://${fb[0]}`);
    if (!/(\/sharer|\/login|\/logout|\/settings|\/friends|\/watch|\/messages|\/events|\/groups)/i.test(url)) {
      out.facebook = url;
    }
  }
  const li = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9_.-]+\/?/i);
  if (li) {
    out.linkedin = clean(li[0].startsWith('http') ? li[0] : `https://${li[0]}`);
  }
  return out;
}

// A social URL picked out of a shared search-results page mentions MANY
// companies in one view. Only accept it when its handle/path strongly overlaps
// the business we're actually enriching — otherwise it's a cross-company leak
// (e.g. a salt dealer ending up with facebook.com/oldworldsnow, or a Karachi
// "Regent Banquet" with instagram.com/hongkongregent — a foreign hotel brand
// that shares one generic word). Distinctive (category-stripped) tokens must
// match, and a single matched token is only OK when the slug IS basically that
// word — not when a foreign word sits alongside it (like "hongkong"+"regent").
export function socialMatchesBusiness(
  socialUrl: string | undefined,
  businessName: string,
  websiteDomain?: string
): boolean {
  if (!socialUrl) return false;
  let pathname: string;
  try {
    pathname = new URL(socialUrl).pathname;
  } catch {
    return false;
  }
  const slug = pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
  if (!slug) return false;
  if (/^profile\.php/i.test(slug) || /^id=\d+/.test(slug) || /^\d{6,}$/.test(slug)) return false;

  const tokens: string[] = distinctiveBusinessTokens(businessName);
  if (websiteDomain) {
    tokens.push(websiteDomain.replace(/^www\./, '').split('.')[0]);
  }
  const normalizedSlug = slug.replace(/[-_]/g, '');
  const matched = tokens.filter((t) => {
    const n = t.replace(/[-_]/g, '');
    if (!n) return false;
    return normalizedSlug.includes(n) || n.includes(normalizedSlug);
  });

  if (matched.length === 0) return false;
  if (matched.length >= 2) return true;

  // Single matched token: the slug must essentially BE that word (a trailing
  // pure-numeric suffix like -pk / -1 is fine). An extra foreign word in the
  // slug ("hongkong"+"regent") means it's a different company's page.
  const token = matched[0].replace(/[-_]/g, '');
  const rest = normalizedSlug.startsWith(token)
    ? normalizedSlug.slice(token.length).replace(/^[-_]+/, '')
    : normalizedSlug.endsWith(token)
      ? normalizedSlug.slice(0, normalizedSlug.length - token.length).replace(/[-_]+$/, '')
      : normalizedSlug.replace(token, '');
  if (rest.length === 0) return true;
  return /^[0-9]+$/.test(rest);
}

// A phone is acceptable for THIS business only when it passes the library
// check AND belongs to the business's country AND is not an implausibly long
// national run (libphonenumber marks 12-digit "+92 774 056 383 985" valid, but
// real PK numbers are <=11 national digits).
function qualifiesPhone(raw: string, countryCode?: string | null): boolean {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  const hasSeparator = /[()\s.-]/.test(trimmed);
  if (!hasSeparator && digits.length >= 12) return false;
  if (trimmed.startsWith('+') && digits.length > 12) return false;
  if (/(\d)\1{4}/.test(digits)) return false;
  try {
    const p = validatePhone(trimmed, countryCode || undefined);
    if (!p.valid) return false;
    if (p.countryCode && countryCode && p.countryCode !== countryCode) return false;
    if (((p.nationalNumber || '').length) > 11) return false;
    return true;
  } catch {
    return false;
  }
}

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

const SKIP_DOMAINS = [
  'google.', 'bing.com', 'duckduckgo.', 'yahoo.', 'wikipedia.', 'reddit.com',
  'quora.com', 'youtube.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'linkedin.com', 'yelp.com', 'tripadvisor.com', 'yellowpages.com', 'pinterest.com',
  'tiktok.com', 'microsoft.com', 'w3.org', 'gov.uk', '.gov', 'bing.net', 'msn.com',
  'webmd.com', 'healthline.com', 'nhs.uk', 'mayoclinic.org', 'medicinenet.com',
];

// Bing now wraps organic result links in a click-tracking redirect:
// https://www.bing.com/ck/a?...&u=a1<base64url-of-real-url>&ntb=1
// Without unwrapping this, every result's hostname is "bing.com" and
// isGoodWebsite() rejects 100% of them. Decode the real destination when
// present; otherwise return the href unchanged (never throws).
function unwrapBingRedirect(href: string): string {
  try {
    const u = new URL(href);
    if (!/(^|\.)bing\.com$/.test(u.hostname) || u.pathname !== '/ck/a') return href;
    const encoded = u.searchParams.get('u');
    if (!encoded) return href;
    const stripped = encoded.startsWith('a1') ? encoded.slice(2) : encoded;
    const padded = stripped + '='.repeat((4 - (stripped.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64url').toString('utf-8');
    return decoded.startsWith('http') ? decoded : href;
  } catch {
    return href;
  }
}

function isGoodWebsite(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (SKIP_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`) || host.startsWith(d))) return false;
    if (/^(login|sign|auth|share|search|checkout|cart|cdn|static|img|mail|owa|outlook)/.test(host.split('.')[0])) return false;
    return true;
  } catch {
    return false;
  }
}

function buildQuery(name: string, city: string, country: string, extra: string): string {
  const loc = [city, country].filter(Boolean).join(' ');
  const base = loc ? `"${name}" ${loc}` : `"${name}"`;
  return extra ? `${base} ${extra}` : base;
}

const BING_URL = 'https://www.bing.com/search';

/**
 * Fallback source for data that Google Maps didn't expose. Uses Bing
 * (functional headless) instead of Google (which captchas from this IP).
 *
 * Accuracy rules (the user explicitly wants leads marked "verified" to be
 * actually correct, not just plausible):
 *   1. Email and phone are ONLY ever taken from the business's OWN website
 *      (visited after discovery). A shared results-page mixes many companies,
 *      so emails/phones scraped from snippet text are the #1 source of
 *      wrong-but-verified data (e.g. info@claritysalt.com on publicsalt.com)
 *      and are NOT accepted here at all.
 *   2. Social links seen in snippets are accepted ONLY when their handle
 *      overlaps the business name or the found website domain.
 *   3. The business's own site's social links are always trusted.
 * No stealth/bot-bypass — ordinary headless browsing only.
 */
export async function searchGoogleForBusiness(
  businessName: string,
  city: string,
  country: string,
  missingFields: string[],
  shouldAbort?: () => Promise<boolean>
): Promise<SearchFallbackResult> {
  const result: SearchFallbackResult = {};
  let websiteDomain: string | undefined;

  const wantWebsite = missingFields.includes('website');
  const wantInstagram = missingFields.includes('instagram');
  const wantFacebook = missingFields.includes('facebook');
  const wantLinkedin = missingFields.includes('linkedin');

  // Probe website first (so a discovered domain can validate later socials),
  // then each social individually — ONLY for fields that are actually still
  // missing. Skipping unneeded probes is what keeps enrichment fast: hunting
  // a social handle the business never had wastes two more Bing round-trips.
  const probes: { query: string; field: 'website' | 'instagram' | 'facebook' | 'linkedin' }[] = [
    ...(wantWebsite ? [{ query: '', field: 'website' as const }] : []),
    ...(wantInstagram ? [{ query: 'instagram', field: 'instagram' as const }] : []),
    ...(wantFacebook ? [{ query: 'facebook', field: 'facebook' as const }] : []),
    ...(wantLinkedin ? [{ query: 'linkedin', field: 'linkedin' as const }] : []),
  ];

  await withPage(async (page) => {
    for (const { query, field } of probes) {
      if (shouldAbort && (await shouldAbort())) return;
      if (result[field]) continue;
      const q = buildQuery(businessName, city, country, query);

      try {
        await page.goto(`${BING_URL}?${new URLSearchParams({ q }).toString()}`, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForTimeout(900);

        if (field === 'website') {
          const rawLinks = (await page.evaluate(() => {
            return Array.from(document.querySelectorAll('li.b_algo h2 a[href^="http"]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter(Boolean);
          }).catch(() => [] as string[])) as string[];
          const links = rawLinks.map(unwrapBingRedirect);
          const candidates: string[] = [];
          const seenDomains = new Set<string>();
          for (const href of links) {
            if (!isGoodWebsite(href)) continue;
            const dom = domainOf(href);
            if (!dom || seenDomains.has(dom)) continue;
            seenDomains.add(dom);
            candidates.push(href);
            if (candidates.length >= 3) break;
          }
          if (candidates.length === 0) {
            const rawFallback = (await page.evaluate(() => {
              return Array.from(document.querySelectorAll('a[href^="http"]'))
                .map((a) => (a as HTMLAnchorElement).href);
            }).catch(() => [] as string[])) as string[];
            for (const href of rawFallback.map(unwrapBingRedirect)) {
              if (!isGoodWebsite(href) || /bing\.com|microsoft|msn/i.test(href)) continue;
              const dom = domainOf(href);
              if (!dom || seenDomains.has(dom)) continue;
              seenDomains.add(dom);
              candidates.push(href);
              if (candidates.length >= 3) break;
            }
          }

          const iso2 = countryNameToISO2(country) || undefined;
          const geo = { city, country, countryCode: iso2 };

          // Best-effort display website (enrichment only stores it when the
          // credibility check passes, so a lookalike domain never sticks).
          if (candidates.length > 0) {
            result.website = candidates[0];
            const dom = domainOf(candidates[0]);
            if (dom) websiteDomain = dom;
          }

          // Visit ONLY credible candidate sites — the business's OWN site is
          // the only trusted source for phone/email/socials. Stop as soon as a
          // phone that validates AND belongs to the business's country shows
          // up; otherwise keep trying the next credible candidate.
          for (const url of candidates) {
            if (shouldAbort && (await shouldAbort())) break;
            if (!isCredibleWebsiteMatch(url, businessName, geo)) continue;
            try {
              await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
              await page.waitForTimeout(1200);
              const siteText = (await page.evaluate(() => {
                return document.body ? (document.body as HTMLElement).innerText : '';
              }).catch(() => '')) as string;

              if (!result.email) {
                const siteEmails = extractEmails(siteText);
                if (siteEmails.length > 0) result.email = siteEmails[0];
              }
              if (!result.phone) {
                const sitePhones = extractPhones(siteText);
                const good = sitePhones.find((p) => qualifiesPhone(p, iso2));
                if (good) result.phone = good;
              }
              const urlDomain = domainOf(url) || undefined;
              const siteSocial = extractSocialUrls(siteText);
              if (siteSocial.instagram && socialMatchesBusiness(siteSocial.instagram, businessName, urlDomain)) result.instagram = siteSocial.instagram;
              if (siteSocial.facebook && socialMatchesBusiness(siteSocial.facebook, businessName, urlDomain)) result.facebook = siteSocial.facebook;
              if (siteSocial.linkedin && socialMatchesBusiness(siteSocial.linkedin, businessName, urlDomain)) result.linkedin = siteSocial.linkedin;
              if (result.phone) break;
            } catch {
              // website visit failed — keep what search discovered, try next
            }
            await sleep(350);
          }
        } else {
          const text = (await page.evaluate(() => {
            const main = document.querySelector('#b_content, main, body') as HTMLElement | null;
            return main ? main.innerText : '';
          }).catch(() => '')) as string;

          const social = extractSocialUrls(text);
          const candidates: [keyof typeof result, string | undefined][] = [
            ['instagram', social.instagram],
            ['facebook', social.facebook],
            ['linkedin', social.linkedin],
          ];
          for (const [key, url] of candidates) {
            if (result[key] || !url) continue;
            if (socialMatchesBusiness(url, businessName, websiteDomain)) {
              (result as Record<string, string | undefined>)[key] = url;
            }
          }
        }
      } catch {
        // A given query failing shouldn't kill the whole loop.
      }

      await sleep(350);
    }
  });

  await sleep(800);

  return result;
}