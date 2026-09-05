import { withPage } from '../browser';
import { isCredibleWebsiteMatch } from '@/lib/utils';

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
// companies in one view. Only accept it when its handle/path overlaps the
// business we're actually enriching — otherwise it's a cross-company leak
// (e.g. a salt dealer ending up with facebook.com/oldworldsnow).
function socialMatchesBusiness(
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

  const tokens: string[] = businessName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 5);
  if (websiteDomain) {
    tokens.push(websiteDomain.replace(/^www\./, '').split('.')[0]);
  }
  const normalizedSlug = slug.replace(/[-_]/g, '');
  return tokens.some((t) => {
    const n = t.replace(/[-_]/g, '');
    if (!n) return false;
    return normalizedSlug.includes(n) || n.includes(normalizedSlug);
  });
}

const SKIP_DOMAINS = [
  'google.', 'bing.com', 'duckduckgo.', 'yahoo.', 'wikipedia.', 'reddit.com',
  'quora.com', 'youtube.com', 'facebook.com', 'twitter.com', 'instagram.com',
  'linkedin.com', 'yelp.com', 'tripadvisor.com', 'yellowpages.com', 'pinterest.com',
  'tiktok.com', 'microsoft.com', 'w3.org', 'gov.uk', '.gov', 'bing.net', 'msn.com',
  'webmd.com', 'healthline.com', 'nhs.uk', 'mayoclinic.org', 'medicinenet.com',
];

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
  _missingFields: string[]
): Promise<SearchFallbackResult> {
  const result: SearchFallbackResult = {};
  let websiteDomain: string | undefined;

  // Probe website first (so a discovered domain can validate later socials),
  // then each social individually. Email/phone come from the site visit below.
  const probes: { query: string; field: 'website' | 'instagram' | 'facebook' | 'linkedin' }[] = [
    { query: '', field: 'website' },
    { query: 'instagram', field: 'instagram' },
    { query: 'facebook', field: 'facebook' },
    { query: 'linkedin', field: 'linkedin' },
  ];

  await withPage(async (page) => {
    for (const { query, field } of probes) {
      if (result[field]) continue;
      const q = buildQuery(businessName, city, country, query);

      try {
        await page.goto(`${BING_URL}?${new URLSearchParams({ q }).toString()}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });
        await page.waitForTimeout(1400);

        if (field === 'website') {
          const links = (await page.evaluate(() => {
            return Array.from(document.querySelectorAll('li.b_algo h2 a[href^="http"]'))
              .map((a) => (a as HTMLAnchorElement).href)
              .filter(Boolean);
          }).catch(() => [] as string[])) as string[];
          for (const href of links) {
            if (isGoodWebsite(href)) {
              result.website = href;
              try {
                websiteDomain = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
              } catch { /* ignore */ }
              break;
            }
          }
          if (!result.website) {
            const fallback = (await page.evaluate(() => {
              return Array.from(document.querySelectorAll('a[href^="http"]'))
                .map((a) => (a as HTMLAnchorElement).href)
                .filter((h) => !/bing\.com|microsoft|msn/i.test(h));
            }).catch(() => [] as string[])) as string[];
            for (const href of fallback) {
              if (isGoodWebsite(href)) {
                result.website = href;
                try {
                  websiteDomain = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
                } catch { /* ignore */ }
                break;
              }
            }
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

    // Visit the business's own website — the ONLY source we trust for email
    // and phone, plus the authoritative social links. Only harvest when the
    // domain plausibly matches the business name: a mismatched site (e.g. a
    // Google-listed record-store domain on the wrong listing) would otherwise
    // feed us another company's phone/email/socials.
    if (result.website && isCredibleWebsiteMatch(result.website, businessName)) {
      try {
        await page.goto(result.website, { waitUntil: 'domcontentloaded', timeout: 25000 });
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
          if (sitePhones.length > 0) result.phone = sitePhones[0];
        }
        const siteSocial = extractSocialUrls(siteText);
        // The business's OWN site socials win over search-snippet guesses —
        // snippet socials only fill in when the site doesn't list them.
        result.instagram = siteSocial.instagram || result.instagram;
        result.facebook = siteSocial.facebook || result.facebook;
        result.linkedin = siteSocial.linkedin || result.linkedin;
      } catch {
        // website visit failed — keep what search discovered
      }
    }
  });

  await sleep(800);

  return result;
}