import type { EnrichedBusiness } from '@/types';
import { normalizeString, extractDomain } from '@/lib/utils';

interface DeduplicationKey {
  normalizedName: string;
  domain: string;
  phone: string;
  addressCity: string;
}

function getDeduplicationKeys(business: EnrichedBusiness): DeduplicationKey {
  const normalizedName = normalizeString(business.name || '');
  const domain = extractDomain(business.website || '')?.toLowerCase() || '';
  const phoneDigits = (business.phone || '').replace(/\D/g, '');
  const phone = phoneDigits.length >= 7 ? phoneDigits : '';
  const addressCity = business.address && business.city
    ? `${normalizeString(business.address)}:${normalizeString(business.city)}`
    : '';

  return { normalizedName, domain, phone, addressCity };
}

function isDuplicate(a: DeduplicationKey, b: DeduplicationKey): boolean {
  // Same phone number: definitive duplicate (a business has one phone)
  if (a.phone && b.phone && a.phone === b.phone) {
    return true;
  }

  // Same domain: same business/website
  if (a.domain && b.domain && a.domain === b.domain) {
    return true;
  }

  // Same address + city: same physical business location
  if (a.addressCity && b.addressCity && a.addressCity === b.addressCity) {
    return true;
  }

  // Same name AND same address+city: same business (don't merge franchises at
  // different locations that happen to share a name).
  if (a.normalizedName && b.normalizedName && a.normalizedName === b.normalizedName) {
    if (a.addressCity && b.addressCity && a.addressCity === b.addressCity) {
      return true;
    }
    // If neither has an address we can compare, be conservative and don't merge.
  }

  // Same name, one has no address at all: the richer one is the real business
  // and the bare one is a partial/duplicate listing (e.g. "Midwest Salt" vs
  // "Midwest salt" from different sources). Merge unless both carry distinct
  // addresses (real branch offices).
  if (a.normalizedName && b.normalizedName && a.normalizedName === b.normalizedName) {
    if (!a.addressCity || !b.addressCity) {
      return true;
    }
  }

  return false;
}

function mergeDuplicateBusinesses(primary: EnrichedBusiness, secondary: EnrichedBusiness): EnrichedBusiness {
  const merged: EnrichedBusiness = {
    ...primary,
    phone: primary.phone || secondary.phone,
    phone_valid: primary.phone_valid ?? secondary.phone_valid,
    phone_country: primary.phone_country || secondary.phone_country,
    email: primary.email || secondary.email,
    website: primary.website || secondary.website,
    instagram: primary.instagram || secondary.instagram,
    facebook: primary.facebook || secondary.facebook,
    linkedin: primary.linkedin || secondary.linkedin,
    address: primary.address || secondary.address,
    city: primary.city || secondary.city,
    country: primary.country || secondary.country,
    country_code: primary.country_code || secondary.country_code,
    latitude: primary.latitude ?? secondary.latitude,
    longitude: primary.longitude ?? secondary.longitude,
    category: primary.category || secondary.category,
    contact_person: primary.contact_person || secondary.contact_person,
    sources: { ...secondary.sources, ...primary.sources },
  };

  // Boost confidence if multiple sources confirm the same field
  if (primary.phone && secondary.phone && primary.phone === secondary.phone) {
    merged.sources.phone = {
      value: primary.phone,
      source: 'multiple_sources',
      confidence: 'high',
    };
  }
  if (primary.email && secondary.email && primary.email === secondary.email) {
    merged.sources.email = {
      value: primary.email,
      source: 'multiple_sources',
      confidence: 'high',
    };
  }

  // Update overall confidence
  const fieldsFound = [
    merged.phone,
    merged.email,
    merged.website,
    merged.instagram,
    merged.facebook,
    merged.linkedin,
    merged.address,
  ].filter(Boolean).length;

  if (fieldsFound >= 5) {
    merged.confidence = 'high';
  } else if (fieldsFound >= 3) {
    merged.confidence = 'medium';
  } else {
    merged.confidence = 'low';
  }

  // Consistent with enrichment's verified formula (valid phone OR verified
  // email); since emailVerified itself isn't carried on the object, OR-ing
  // the two inputs' already-computed `verified` flags preserves it correctly.
  merged.verified = !!merged.phone_valid || !!primary.verified || !!secondary.verified;

  return merged;
}

export function deduplicateBusinesses(businesses: EnrichedBusiness[]): EnrichedBusiness[] {
  const results: EnrichedBusiness[] = [];
  const keysList: DeduplicationKey[] = [];

  for (const business of businesses) {
    const keys = getDeduplicationKeys(business);
    let duplicateIndex = -1;

    for (let i = 0; i < keysList.length; i++) {
      if (isDuplicate(keys, keysList[i])) {
        duplicateIndex = i;
        break;
      }
    }

    if (duplicateIndex >= 0) {
      results[duplicateIndex] = mergeDuplicateBusinesses(results[duplicateIndex], business);
    } else {
      results.push(business);
      keysList.push(keys);
    }
  }

  return results;
}
