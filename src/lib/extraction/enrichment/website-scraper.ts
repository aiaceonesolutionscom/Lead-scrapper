import axios from 'axios';
import * as cheerio from 'cheerio';
import { withPage } from '../browser';

export interface ScrapedData {
  phone: string | null;
  email: string | null;
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
  website: string | null;
  contactPerson: string | null;
  sources: Record<string, { value: string | null; source: string; confidence: 'high' | 'medium' | 'low' }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanPhone(phone: string): string {
  return phone
    .replace(/[\s\-\(\)\.]+/g, ' ')
    .trim();
}

const PLACEHOLDER_EMAILS = new Set([
  'user@domain.com', 'user@example.com', 'your@email.com', 'youremail@domain.com',
  'your@domain.com', 'email@domain.com', 'name@domain.com', 'yourname@domain.com',
  'info@domain.com', 'contact@domain.com', 'test@test.com', 'test@gmail.com',
  'example@example.com', 'mail@example.com', 'support@example.com',
  'demo@example.com', 'webmaster@example.com', 'admin@example.com',
  'changeme@example.com', 'your@emailaddress.com', 'emailaddress@yourdomain.com',
  'placeholder@example.com', 'sample@example.com', 'someone@example.com',
  'hello@example.com', 'namet@example.com',
]);

const FILE_EXT_TLDS = [
  'css', 'js', 'json', 'xml', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp',
  'pdf', 'min.css', 'min.js', 'map', 'ico', 'txt', 'html', 'htm',
];

function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const domain = lower.split('@')[1] || '';
  if (PLACEHOLDER_EMAILS.has(lower)) return true;
  const tld = domain.split('.').pop() || '';
  if (FILE_EXT_TLDS.includes(tld)) return true;
  if (!domain.includes('.')) return true;
  return false;
}

function extractEmailsFromText(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const excludedDomains = [
    'example.com', 'sentry.io', 'wixpress.com', 'schema.org',
    'w3.org', 'googleapis.com', 'facebook.com', 'twitter.com',
    'instagram.com', 'linkedin.com', 'youtube.com', 'cloudflare.com',
    'jquery.com', 'wordpress.org', 'gravatar.com',
  ];
  return (text.match(emailRegex) || []).filter((email) => {
    if (isJunkEmail(email)) return false;
    const domain = email.split('@')[1]?.toLowerCase() || '';
    return !excludedDomains.some((d) => domain.endsWith(d)) && !domain.endsWith('.png') && !domain.endsWith('.jpg');
  });
}

function extractPhonesFromText(text: string): string[] {
  const patterns = [
    /(?:tel:|phone:|call:|mobile:|fax:)[\s]*([+\d\s\-\(\)\.]{7,20})/gi,
    /(?:\+\d{1,4}[\s.\-]?)?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}/g,
  ];
  const phones: string[] = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const cleaned = match.replace(/^(?:tel|phone|call|mobile|fax):\s*/i, '').trim();
      const digits = cleaned.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) {
        phones.push(cleaned);
      }
    }
  }
  return [...new Set(phones)];
}

function extractSocialLinks($: cheerio.CheerioAPI): { instagram: string | null; facebook: string | null; linkedin: string | null } {
  let instagram: string | null = null;
  let facebook: string | null = null;
  let linkedin: string | null = null;

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const lower = href.toLowerCase();

    if (!instagram && lower.includes('instagram.com/') && !lower.includes('instagram.com/accounts')) {
      instagram = href;
    }
    if (!facebook && lower.includes('facebook.com/') && !lower.includes('facebook.com/sharer')) {
      facebook = href;
    }
    if (!linkedin && lower.includes('linkedin.com/') && !lower.includes('linkedin.com/share')) {
      linkedin = href;
    }
  });

  return { instagram, facebook, linkedin };
}

function extractContactPerson($: cheerio.CheerioAPI): string | null {
  const selectors = [
    '[class*="team"] [class*="name"]',
    '[class*="about"] [class*="name"]',
    '[class*="founder"]',
    '[class*="director"]',
    '[class*="ceo"]',
    '.author-name',
    '.contact-name',
    'meta[name="author"]',
  ];

  for (const selector of selectors) {
    const el = $(selector).first();
    if (el.length) {
      const content = el.attr('content') || el.text().trim();
      if (content && content.length > 2 && content.length < 80) {
        return content;
      }
    }
  }

  return null;
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
      maxRedirects: 3,
    });
    return typeof response.data === 'string' ? response.data : null;
  } catch {
    return null;
  }
}

// Fallback for sites that render their contact info client-side (React/Vue/
// Next.js apps etc.) where a plain HTTP GET only sees an empty shell. Only
// used when the fast static pass finds nothing, since a real browser render
// is much slower than a raw request.
async function fetchRenderedPage(url: string): Promise<string | null> {
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    return page.content();
  });
}

export async function scrapeWebsite(url: string): Promise<ScrapedData> {
  const baseResult: ScrapedData = {
    phone: null,
    email: null,
    instagram: null,
    facebook: null,
    linkedin: null,
    website: url,
    contactPerson: null,
    sources: {},
  };

  let baseUrl: URL;
  try {
    baseUrl = new URL(url);
  } catch {
    return baseResult;
  }

  const pagesToCheck = [
    '',
    '/contact',
    '/contact-us',
    '/contact.html',
    '/about',
    '/about-us',
    '/about.html',
  ];

  const allPhones: string[] = [];
  const allEmails: string[] = [];
  let instagram: string | null = null;
  let facebook: string | null = null;
  let linkedin: string | null = null;
  let contactPerson: string | null = null;

  for (const pagePath of pagesToCheck) {
    const pageUrl = `${baseUrl.origin}${pagePath}`;
    const html = await fetchPage(pageUrl);

    if (!html) {
      await sleep(500);
      continue;
    }

    const $ = cheerio.load(html);

    // Extract phones from visible text and tel: links
    const bodyText = $('body').text();
    const telLinks = $('a[href^="tel:"]').map((_i, el) => $(el).attr('href')?.replace('tel:', '') || '').get();

    allPhones.push(...extractPhonesFromText(bodyText));
    allPhones.push(...telLinks.filter((t): t is string => !!t));

    // Extract emails
    allEmails.push(...extractEmailsFromText(html));
    $('a[href^="mailto:"]').each((_i, el) => {
      const email = $(el).attr('href')?.replace('mailto:', '').split('?')[0]?.trim();
      if (email) allEmails.push(email);
    });

    // Extract social links (check all pages)
    const social = extractSocialLinks($);
    if (!instagram && social.instagram) instagram = social.instagram;
    if (!facebook && social.facebook) facebook = social.facebook;
    if (!linkedin && social.linkedin) linkedin = social.linkedin;

    // Extract contact person (check about pages)
    if (!contactPerson && (pagePath.includes('about') || pagePath === '')) {
      contactPerson = extractContactPerson($);
    }

    await sleep(500);
  }

  // Static fetch found nothing at all — retry the homepage and contact page
  // with a real rendered browser in case contact info only appears after
  // client-side JS runs (common on modern React/Next.js business sites).
  if (allPhones.length === 0 && allEmails.length === 0) {
    for (const pagePath of ['', '/contact', '/contact-us']) {
      const pageUrl = `${baseUrl.origin}${pagePath}`;
      const html = await fetchRenderedPage(pageUrl);
      if (!html) continue;

      const $ = cheerio.load(html);
      const bodyText = $('body').text();
      const telLinks = $('a[href^="tel:"]').map((_i, el) => $(el).attr('href')?.replace('tel:', '') || '').get();

      allPhones.push(...extractPhonesFromText(bodyText));
      allPhones.push(...telLinks.filter((t): t is string => !!t));
      allEmails.push(...extractEmailsFromText(html));
      $('a[href^="mailto:"]').each((_i, el) => {
        const email = $(el).attr('href')?.replace('mailto:', '').split('?')[0]?.trim();
        if (email) allEmails.push(email);
      });

      const social = extractSocialLinks($);
      if (!instagram && social.instagram) instagram = social.instagram;
      if (!facebook && social.facebook) facebook = social.facebook;
      if (!linkedin && social.linkedin) linkedin = social.linkedin;
      if (!contactPerson) contactPerson = extractContactPerson($);

      if (allPhones.length > 0 || allEmails.length > 0) break;
    }
  }

  // Deduplicate and pick best results
  const uniquePhones = [...new Set(allPhones)];
  const uniqueEmails = [...new Set(allEmails)].filter((e) => {
    const domain = e.split('@')[1]?.toLowerCase() || '';
    return !domain.includes('sentry') && !domain.includes('wix');
  });

  const bestPhone = uniquePhones[0] || null;
  const bestEmail = uniqueEmails[0] || null;

  if (bestPhone) {
    baseResult.phone = cleanPhone(bestPhone);
    baseResult.sources.phone = {
      value: baseResult.phone,
      source: `website: ${url}`,
      confidence: 'high',
    };
  }

  if (bestEmail) {
    baseResult.email = bestEmail;
    baseResult.sources.email = {
      value: bestEmail,
      source: `website: ${url}`,
      confidence: 'high',
    };
  }

  if (instagram) {
    baseResult.instagram = instagram;
    baseResult.sources.instagram = {
      value: instagram,
      source: `website: ${url}`,
      confidence: 'high',
    };
  }

  if (facebook) {
    baseResult.facebook = facebook;
    baseResult.sources.facebook = {
      value: facebook,
      source: `website: ${url}`,
      confidence: 'high',
    };
  }

  if (linkedin) {
    baseResult.linkedin = linkedin;
    baseResult.sources.linkedin = {
      value: linkedin,
      source: `website: ${url}`,
      confidence: 'high',
    };
  }

  if (contactPerson) {
    baseResult.contactPerson = contactPerson;
    baseResult.sources.contact_person = {
      value: contactPerson,
      source: `website: ${url}`,
      confidence: 'medium',
    };
  }

  return baseResult;
}
