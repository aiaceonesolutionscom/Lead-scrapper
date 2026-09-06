import type { Page } from 'playwright';
import { withPage } from '../browser';
import type { DiscoveryBusiness } from '@/types';
import { normalizeString } from '@/lib/utils';

export interface GoogleMapsOptions {
  headless?: boolean;
  fetchDetails?: boolean;
  maxScrolls?: number;
}

const GMAPS_URL = 'https://www.google.com/maps/search';

function buildQuery(keyword: string, city: string, country: string): string {
  const loc = city ? `${city}, ${country}` : country;
  return `${keyword} in ${loc}`;
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(min + Math.random() * (max - min));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRating(line: string): { rating?: number; reviews?: number } {
  const ratingMatch = line.match(/^(\d(?:\.\d)?)/);
  if (!ratingMatch) return {};
  const rating = parseFloat(ratingMatch[1]);
  const reviewMatch = line.match(/\((\d[\d,]*)\)/);
  return {
    rating,
    reviews: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ''), 10) : undefined,
  };
}

// Google Maps feed chrome that is NOT a business card — skip these.
const FEED_CHROME: RegExp[] = [
  /^(hours|all filters|results|saved|recents|get app|share)\b/i,
  /^price\s+rating\s+hours\s+all\s+filters/i,
  /^some of these/i,
  /^prices come from/i,
  /^all vacation rental/i,
  /^to see review/i,
];

const CARD_TRAILER = /^(directions|save|share|website|call|get directions|\d+ photos?|see more)/i;

type CardDetails = {
  name: string;
  rating?: number;
  reviews?: number;
  category?: string;
  address?: string;
  hours?: string;
  phone?: string;
  website?: string;
  email?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  latitude?: number;
  longitude?: number;
};

/**
 * Discover real business listings from Google Maps via a normal headless
 * browser. Reads only the publicly-visible listing data (name, phone,
 * address, website, email, social links) that any visitor can see — no
 * automation-flag spoofing or stealth tricks. Google Maps is the primary
 * source: it has real, exact business listings for any keyword/location,
 * which makes it strictly better than indirect web-search results.
 */
export async function discoverFromGoogleMaps(
  keyword: string,
  city: string,
  country: string,
  limit: number,
  options: GoogleMapsOptions = {}
): Promise<DiscoveryBusiness[]> {
  const fetchDetails = options.fetchDetails ?? true;
  const maxScrolls = options.maxScrolls ?? 30;

  const cards = new Map<string, CardDetails>();

  const result = await withPage(async (page) => {
    const query = buildQuery(keyword, city, country);

    await page.goto(`${GMAPS_URL}/${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Consent/cookie dialogs can cover the page and starve the feed. Click
    // "Accept all" / "Reject all" style buttons when one is present.
    {
      const consentButton = page
        .locator('button:has-text("Accept all"), button:has-text("Reject all"), button:has-text("Agree"), button[aria-label*="Accept"]')
        .first();
      if ((await consentButton.count().catch(() => 0)) > 0) {
        try {
          await consentButton.click({ timeout: 2000 }).catch(() => {});
          await page.waitForTimeout(800);
        } catch {
          // Non-fatal
        }
      }
    }

    // Wait for the results feed to appear (Google Maps lazy-renders it).
    // Country-wide queries render slower than metros; be patient.
    let feedReady = false;
    for (let w = 0; w < 45 && !feedReady; w++) {
      await page.waitForTimeout(700);
      feedReady = (await page.locator('[role="feed"] > div').count().catch(() => 0)) > 0;
    }
    if (!feedReady) {
      throw new Error('Google Maps results feed did not load');
    }

    // Scroll the results feed to force lazy-loading of more cards. Country
    // feeds need more scrolls to reach their full card count (50-100+).
    for (let s = 0; s < maxScrolls; s++) {
      const feed = page.locator('[role="feed"]').first();
      if (await feed.count().catch(() => 0)) {
        await feed.evaluate((el) => {
          (el as HTMLElement).scrollBy(0, 2200);
        }).catch(() => {});
      } else {
        await page.mouse.wheel(0, 1200).catch(() => {});
      }
      await randomDelay(500, 900);
      await collectCards(page, cards);
      if (cards.size >= limit * 2) break;
    }

    // If we ran out of scrolls and still haven't collected the full quota,
    // jump to the end of the virtualized feed once — Google Maps renders the
    // remaining cards when you seek far ahead, then we scroll back through.
    if (cards.size < limit) {
      try {
        const feed = page.locator('[role="feed"]').first();
        if (await feed.count().catch(() => 0)) {
          await feed.evaluate((el) => {
            (el as HTMLElement).scrollBy(0, 100000);
          }).catch(() => {});
          await randomDelay(1200, 1800);
          for (let s2 = 0; s2 < maxScrolls / 2 && cards.size < limit; s2++) {
            await feed.evaluate((el) => {
              (el as HTMLElement).scrollBy(0, -1800);
            }).catch(() => {});
            await randomDelay(500, 800);
            await collectCards(page, cards);
          }
        }
      } catch {
        // Best-effort second scroll pass.
      }
    }

    await collectCards(page, cards);

    // Detail-click pass: fill phone/website/email/social/address from the
    // right-hand detail panel for cards that are missing key fields.
    if (fetchDetails) {
      for (const [name, card] of cards) {
        if (card.phone && card.website && card.address) continue;
        try {
          await clickCardAndExtract(page, name, card);
        } catch {
          // tolerate per-card failures
        }
        if (cards.size >= limit) break;
      }
    }

    return Array.from(cards.values());
  });

  if (!result) return [];

  return result
    .slice(0, limit)
    .map((c) => ({
      name: c.name,
      address: c.address,
      city: city || undefined,
      country: country || undefined,
      website: c.website,
      phone: c.phone,
      email: c.email,
      instagram: c.instagram,
      facebook: c.facebook,
      linkedin: c.linkedin,
      latitude: c.latitude,
      longitude: c.longitude,
      source: 'google_maps',
      category: c.category || keyword,
    }))
    .filter((b) => !!b.name && normalizeString(b.name).length > 1);
}

/**
 * Read every card in the feed and record its structured fields. Runs one
 * in-page evaluate that returns each card's innerText PLUS its own anchors —
 * scoped per card so website/social links never leak from a neighbouring
 * business (the earlier bug: reading `[role="main"]` grabbed every card).
 */
async function collectCards(page: Page, cards: Map<string, CardDetails>) {
  const rawCards = await page.evaluate(() => {
    const feed = document.querySelector('[role="feed"]');
    if (!feed) return [] as { text: string; anchors: { href: string; text: string }[] }[];
    const children = feed.children;
    const out: { text: string; anchors: { href: string; text: string }[] }[] = [];
    for (let i = 0; i < children.length; i++) {
      const el = children[i] as HTMLElement;
      const anchors: { href: string; text: string }[] = [];
      for (const a of Array.from(el.querySelectorAll('a[href]'))) {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('http')) {
          anchors.push({ href, text: ((a as HTMLElement).innerText || '').trim() });
        }
      }
      out.push({ text: el.innerText || '', anchors });
    }
    return out;
  }).catch(() => []);

  for (const { text, anchors } of rawCards) {
    const card = parseCardText(text);
    if (!card || !card.name) continue;

    // Website is the anchor that reads "Website" (not a maps/place link).
    for (const a of anchors) {
      const t = a.text.toLowerCase();
      const href = a.href;
      if (href.includes('google.com/maps/place')) continue;
      if (/^website/i.test(a.text.trim().replace(/[^\x00-\x7f]/g, ''))) {
        if (!card.website) card.website = href;
        continue;
      }
      if (/instagram\.com/i.test(href) && !card.instagram) card.instagram = href;
      if (/facebook\.com/i.test(href) && !card.facebook) card.facebook = href;
      if (/linkedin\.com/i.test(href) && !card.linkedin) card.linkedin = href;
      // Fallback: a non-maps http link inside the card is usually the site.
      if (!card.website && !href.includes('google.com') && !/bing|facebook|instagram|linkedin/i.test(href)) {
        card.website = href;
      }
    }

    const key = card.name;
    const existing = cards.get(key);
    if (existing) {
      // Merge any newly-available fields into the existing card.
      if (!existing.phone && card.phone) existing.phone = card.phone;
      if (!existing.website && card.website) existing.website = card.website;
      if (!existing.email && card.email) existing.email = card.email;
      if (!existing.address && card.address) existing.address = card.address;
      if (!existing.category && card.category) existing.category = card.category;
      if (!existing.instagram && card.instagram) existing.instagram = card.instagram;
      if (!existing.facebook && card.facebook) existing.facebook = card.facebook;
      if (!existing.linkedin && card.linkedin) existing.linkedin = card.linkedin;
      if (existing.latitude === undefined && card.latitude !== undefined) existing.latitude = card.latitude;
      if (existing.longitude === undefined && card.longitude !== undefined) existing.longitude = card.longitude;
    } else {
      cards.set(key, card);
    }
  }
}

function cleanAddress(raw: string): string {
  // Strip invisible/icon glyphs (private-use area, emoji-ish), arrows, and
  // leading separators/commas (" , 2354 N Lindbergh Blvd" -> "2354 N...")
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\uE000-\uF8FF\uFE00-\uFE0F\u2190-\u21FF\u2300-\u23FF]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,·•|:;]+/, '')
    .replace(/[\s,·•|:;]+$/, '')
    .trim();
}

/**
 * Parse a single card's innerText into structured fields.
 * Card innerText lines look like:
 *   Name (repeated)
 *   Rating line ("4.6(15)" or "No reviews")
 *   Category · PlusCode/FortCode   ("Pharmacy · V373+3M5")
 *   Hours line                     ("Open 24 hours · +92 317 7774647")
 *   Directions
 */
function parseCardText(text: string): CardDetails | null {
  const lines = text
    .split('\n')
    .map((l: string) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  // Determine name: skip chrome lines.
  let name = '';
  let idx = 0;
  for (; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line) continue;
    if (CHROME(line)) continue;
    name = line;
    break;
  }
  if (!name || normalizeString(name).length <= 1) return null;
  // Sanity: a business name is not a phone/address/category alone.
  if (/^\+?[\d\s().-]{7,}$/.test(name)) return null;

  const card: CardDetails = { name };
  idx += 1;

  // The card name often repeats on the second line; skip it.
  if (idx < lines.length && lines[idx] === name) idx += 1;

  for (let j = idx; j < lines.length; j++) {
    const line = lines[j];
    if (!line) continue;
    if (CARD_TRAILER.test(line)) continue;

    // Rating / review count ("4.6", "4.6(15)", "No reviews")
    const rating = parseRating(line);
    if (rating.rating !== undefined) {
      card.rating = rating.rating;
      card.reviews = rating.reviews;
      continue;
    }
    if (/^no reviews$/i.test(line)) continue;

    // "Open ... · phone" or "Closes ... · phone" — hours + phone on one line
    if (/^(open|closes?|hours)/i.test(line) && line.includes('·')) {
      const parts = line.split('·').map((p: string) => p.trim());
      card.hours = parts[0];
      for (let k = 1; k < parts.length; k++) {
        if (/(\+\d{1,4}[\d\s().-]{5,}|\d[\d\s().-]{6,}\d)/.test(parts[k]) && !card.phone) {
          card.phone = parts[k];
        }
      }
      continue;
    }
    if (/^(open|closes?|hours)/i.test(line)) {
      card.hours = line;
      continue;
    }

    // Category · Address (plus code / locality). e.g. "Pharmacy · V355+M6M"
    if (line.includes('·')) {
      const parts = line.split('·').map((p: string) => p.trim());
      if (!card.category && parts[0]) card.category = parts[0];
      const rest = cleanAddress(parts.slice(1).join(', '));
      if (rest && !card.address) card.address = rest;
      continue;
    }

    // Phone (with or without +)
    if (/^\+?[\d\s().-]{7,}$/.test(line) && /\d{3}/.test(line) && !/^\d+(\.\d+)?$/.test(line)) {
      if (!card.phone) card.phone = line;
      continue;
    }

    // Website URL
    if (/^https?:\/\//.test(line) && !card.website) {
      card.website = line;
      continue;
    }

    // Email
    if (/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(line) && !card.email) {
      card.email = line;
      continue;
    }

    // Address-ish line (has comma, moderate length)
    if (!card.address && /,/.test(line) && line.length < 80) {
      card.address = cleanAddress(line);
    }
  }

  return card;
}

function CHROME(line: string): boolean {
  return FEED_CHROME.some((r) => r.test(line));
}

async function clickCardAndExtract(page: Page, name: string, card: CardDetails): Promise<void> {
  // Find and click the feed card whose name matches.
  const feed = page.locator('[role="feed"] > div');
  const count = await feed.count().catch(() => 0);
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const el = feed.nth(i);
    const txt = ((await el.innerText().catch(() => '')) || '').trim();
    const firstLine = txt.split('\n').find((l: string) => l.trim() && !CHROME(l.trim()));
    if (firstLine?.trim() === name) {
      try {
        await el.click();
        clicked = true;
      } catch {
        // fall through
      }
      break;
    }
  }
  if (!clicked) return;

  await randomDelay(900, 1500);

  // Extract the detail panel content in ONE evaluate — fast and simple.
  const detail = await page.evaluate(() => {
    const out: {
      phone?: string; website?: string; email?: string;
      instagram?: string; facebook?: string; linkedin?: string;
      address?: string; lat?: number; lng?: number;
    } = {};

    const phoneEl = document.querySelector('a[href^="tel:"], button[data-item-id*="phone"], a[data-item-id*="phone"]');
    if (phoneEl) {
      const href = phoneEl.getAttribute('href') || '';
      if (href.startsWith('tel:')) out.phone = href.replace('tel:', '').trim();
      else {
        const aria = phoneEl.getAttribute('aria-label') || '';
        const txt = phoneEl.textContent || '';
        if (/\d/.test(aria)) out.phone = aria.replace(/^[^0-9+]*/, '').trim();
        else if (/\d/.test(txt)) out.phone = txt.trim();
      }
    }

    const webEl = document.querySelector('a[data-item-id="authority"], a[aria-label*="Website"], a[aria-label*="website"]');
    if (webEl) {
      const href = webEl.getAttribute('href') || '';
      if (href && !href.includes('google.com')) out.website = href;
    }

    const links = document.querySelectorAll('a[href]');
    for (const a of Array.from(links)) {
      const href = (a as HTMLAnchorElement).href || '';
      if (/instagram\.com/i.test(href) && !out.instagram) out.instagram = href;
      if (/facebook\.com/i.test(href) && !out.facebook) out.facebook = href;
      if (/linkedin\.com/i.test(href) && !out.linkedin) out.linkedin = href;
      if (href.startsWith('mailto:') && !out.email) out.email = href.replace('mailto:', '').trim();
    }

    const panel = document.querySelector('[role="main"]');
    if (panel) {
      const text = (panel as HTMLElement).innerText || '';
      if (!out.email) {
        const em = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,})/);
        if (em) out.email = em[1];
      }
      if (!out.instagram) {
        const ig = text.match(/(https?:\/\/(?:www\.)?instagram\.com\/[^\s"']+)/i);
        if (ig) out.instagram = ig[1];
      }
      if (!out.facebook) {
        const fb = text.match(/(https?:\/\/(?:www\.)?facebook\.com\/[^\s"']+)/i);
        if (fb) out.facebook = fb[1];
      }
      if (!out.linkedin) {
        const li = text.match(/(https?:\/\/(?:www\.)?linkedin\.com\/[^\s"']+)/i);
        if (li) out.linkedin = li[1];
      }
      const coord = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (coord) {
        out.lat = parseFloat(coord[1]);
        out.lng = parseFloat(coord[2]);
      }
    }

    return out;
  }).catch(() => {
    return { phone: undefined, website: undefined, email: undefined, instagram: undefined, facebook: undefined, linkedin: undefined, address: undefined, lat: undefined, lng: undefined };
  });

  if (detail.phone && !card.phone) card.phone = detail.phone;
  if (detail.website && !card.website) card.website = detail.website;
  if (detail.email && !card.email) card.email = detail.email;
  if (detail.instagram) card.instagram = detail.instagram;
  if (detail.facebook) card.facebook = detail.facebook;
  if (detail.linkedin) card.linkedin = detail.linkedin;
  if (detail.address && !card.address) card.address = detail.address;
  if (detail.lat !== undefined && detail.lng !== undefined) {
    card.latitude = detail.lat;
    card.longitude = detail.lng;
  }

  // Close the detail panel.
  await page.keyboard.press('Escape').catch(() => {});
  await randomDelay(350, 700);
}