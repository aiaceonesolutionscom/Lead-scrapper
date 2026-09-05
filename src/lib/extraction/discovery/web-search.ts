import * as cheerio from 'cheerio';
import type { DiscoveryBusiness } from '@/types';
import { countryNameToISO2 } from '@/lib/utils/countries';
import { withPage } from '../browser';
import { isLikelyNonBusinessResult } from './filters';

const DUCKDUCKGO_URL = 'https://html.duckduckgo.com/html/';

function buildQuery(keyword: string, city: string, country: string, round: number): string {
  const loc = city ? `${city}, ${country}` : country;
  const variants = [
    `${keyword} in ${loc}`,
    `${keyword} near ${loc}`,
    `best ${keyword} in ${loc}`,
    `${keyword} ${loc} contact number`,
    `list of ${keyword} in ${loc}`,
    `top rated ${keyword} ${loc}`,
  ];
  return variants[round % variants.length];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractPhonesFromText(text: string): string[] {
  const phoneRegex = /(?:\+\d{1,4}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g;
  return (text.match(phoneRegex) || []).filter((p) => p.replace(/\D/g, '').length >= 7);
}

function extractEmailsFromText(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return (text.match(emailRegex) || []).filter((e) => {
    const domain = e.split('@')[1]?.toLowerCase() || '';
    return (
      !domain.includes('example.com') &&
      !domain.includes('sentry.io') &&
      !domain.includes('wixpress.com') &&
      !domain.endsWith('.png') &&
      !domain.endsWith('.jpg')
    );
  });
}

function parseResultsHtml(
  html: string,
  keyword: string,
  city: string,
  country: string,
  countryCode: string | undefined
): { businesses: DiscoveryBusiness[]; resultCount: number } {
  const $ = cheerio.load(html);
  const businesses: DiscoveryBusiness[] = [];
  const results = $('.result');

  results.each((_i, el) => {
    const resultEl = $(el);
    const title = resultEl.find('.result__title').text().trim();
    const snippet = resultEl.find('.result__snippet').text().trim();
    const href = resultEl.find('.result__url').text().trim() || resultEl.find('.result__a').attr('href') || '';

    let website = href;
    if (href.startsWith('http')) {
      try {
        website = new URL(href).hostname;
      } catch {
        website = href;
      }
    }

    const combinedText = `${title} ${snippet}`;
    const phones = extractPhonesFromText(combinedText);
    const emails = extractEmailsFromText(combinedText);

    if (!title) return;
    if (isLikelyNonBusinessResult(title, href)) return;

    let cleanedName = title
      .replace(/\s*[-–|].*$/, '')
      .replace(/\s*\(.*?\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedName.length > 80) cleanedName = cleanedName.substring(0, 80).trim();

    businesses.push({
      name: cleanedName,
      city,
      country,
      country_code: countryCode,
      website: website.startsWith('http') ? website : undefined,
      phone: phones[0] || undefined,
      email: emails[0] || undefined,
      source: 'web_search',
      source_url: href.startsWith('http') ? href : undefined,
      category: keyword,
    });
  });

  return { businesses, resultCount: results.length };
}

export async function discoverFromWebSearch(
  keyword: string,
  city: string,
  country: string,
  limit: number = 30,
  round: number = 0
): Promise<DiscoveryBusiness[]> {
  const businesses: DiscoveryBusiness[] = [];
  const query = buildQuery(keyword, city, country, round);
  const countryCode = countryNameToISO2(country) || undefined;
  // Scale pages with the requested limit instead of a flat 3-page cap, so
  // large lead-count requests aren't starved of raw candidates. Capped at 8
  // to stay polite to DuckDuckGo and bound worst-case run time.
  const pagesToSearch = Math.min(Math.ceil(limit / 10), 8);

  // A real headless browser (not a raw HTTP client) renders the page like an
  // actual visitor — harder for DuckDuckGo's basic bot heuristics to block,
  // and resilient to markup that only appears after JS executes.
  const result = await withPage(async (page) => {
    for (let pageNum = 0; pageNum < pagesToSearch; pageNum++) {
      try {
        const params = new URLSearchParams({
          q: query,
          s: String(pageNum * 30),
          dc: String(pageNum + 1),
        });

        await page.goto(`${DUCKDUCKGO_URL}?${params.toString()}`, { waitUntil: 'domcontentloaded' });

        const html = await page.content();
        const { businesses: pageBusinesses, resultCount } = parseResultsHtml(
          html, keyword, city, country, countryCode
        );
        businesses.push(...pageBusinesses);

        if (businesses.length >= limit) break;

        // A page with zero results usually means DuckDuckGo has exhausted
        // matches (or is throttling us) — no point burning further requests.
        if (resultCount === 0) break;

        if (pageNum < pagesToSearch - 1) {
          await sleep(2000);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown search error';
        console.error(`Web search failed (page ${pageNum}) for "${keyword}" in ${city}, ${country}:`, message);
        await sleep(2000);
      }
    }
    return businesses;
  });

  return (result || []).slice(0, limit);
}
