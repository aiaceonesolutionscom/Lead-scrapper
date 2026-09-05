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

// A website is "credible" for a business when its domain clearly overlaps the
// business name (e.g. rocksaltusa.com ~ "Rock Salt USA", bulksalt.com ~
// "Bulk Salt"). Google Maps/OSM sometimes list a neighbouring/record-store
// domain on the wrong listing (e.g. saltboxrecordsla.com on a wholesale
// crystals company); trusting that domain to source email/phone/socials is
// exactly how wrong-but-"verified" data leaks in. Uses >=4-char name tokens
// so short brands still match, while wholly-unrelated domains fail.
export function isCredibleWebsiteMatch(
  website: string | undefined | null,
  businessName: string | null | undefined
): boolean {
  if (!website || !businessName) return false;
  let domainPhrase: string;
  try {
    const host = new URL(website).hostname.replace(/^www\./, '').toLowerCase();
    const labels = host.split('.');
    domainPhrase = labels.slice(0, labels.length - 1).join('');
  } catch {
    return false;
  }
  if (!domainPhrase) return false;

  const tokens = businessName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4);

  return tokens.some((token) => domainPhrase.includes(token) || token.includes(domainPhrase));
}
