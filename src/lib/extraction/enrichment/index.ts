import type { DiscoveryBusiness, EnrichedBusiness } from '@/types';
import { scrapeWebsite } from './website-scraper';
import { searchGoogleForBusiness } from './google-search';
import { validatePhone } from '@/lib/utils/phone';
import { verifyEmailDomain } from '@/lib/utils/email-verify';
import { isCredibleWebsiteMatch } from '@/lib/utils';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function enrichBusiness(business: DiscoveryBusiness): Promise<EnrichedBusiness> {
  const enriched: EnrichedBusiness = {
    ...business,
    sources: {},
    verified: false,
    confidence: 'low',
  };

  console.log(`[Enrichment] ${business.name} — starting enrichment (phone: ${business.phone || 'none'}, website: ${business.website || 'none'}, email: ${business.email || 'none'})`);

  // Copy initial sources from discovery. The website is a credibility risk: a
  // Google Maps/OSM listing can point at a neighbouring/unrelated domain (the
  // CCG Crystals -> saltboxrecordsla.com case). Only treat it as a trustworthy
  // source when its domain plausibly matches the business name; otherwise drop
  // it now and let the web-search fallback rediscover the real site.
  const websiteCredible = isCredibleWebsiteMatch(business.website, business.name);
  if (business.website && !websiteCredible) {
    console.log(`[Enrichment] ${business.name} — discarded non-matching website "${business.website}", will rediscover via search`);
  }

  if (business.phone) {
    enriched.sources.phone = {
      value: business.phone,
      source: business.source,
      confidence: 'medium',
    };
  }
  if (business.email) {
    enriched.sources.email = {
      value: business.email,
      source: business.source,
      confidence: 'medium',
    };
  }
  if (business.website && websiteCredible) {
    enriched.sources.website = {
      value: business.website,
      source: business.source,
      confidence: 'high',
    };
  }

  // Step 1: Scrape website if available AND the domain matches the business.
  // Contacts from an unrelated site would pollute the lead with another
  // company's phone/email (and mark it "verified" on wrong data).
  let wasWebsiteScraped = false;
  if (business.website && websiteCredible) {
    wasWebsiteScraped = true;
    try {
      const scraped = await scrapeWebsite(business.website);

      if (scraped.phone && !enriched.phone) {
        enriched.phone = scraped.phone;
        enriched.sources.phone = scraped.sources.phone!;
      } else if (scraped.phone && enriched.phone && scraped.phone !== enriched.phone) {
        // Keep original but note secondary phone
        enriched.sources.phone_secondary = scraped.sources.phone!;
      }

      if (scraped.email && !enriched.email) {
        enriched.email = scraped.email;
        enriched.sources.email = scraped.sources.email!;
      }

      if (scraped.instagram && !enriched.instagram) {
        enriched.instagram = scraped.instagram;
        enriched.sources.instagram = scraped.sources.instagram!;
      }

      if (scraped.facebook && !enriched.facebook) {
        enriched.facebook = scraped.facebook;
        enriched.sources.facebook = scraped.sources.facebook!;
      }

      if (scraped.linkedin && !enriched.linkedin) {
        enriched.linkedin = scraped.linkedin;
        enriched.sources.linkedin = scraped.sources.linkedin!;
      }

      if (scraped.contactPerson && !enriched.contact_person) {
        enriched.contact_person = scraped.contactPerson;
        enriched.sources.contact_person = scraped.sources.contact_person!;
      }
    } catch (error) {
      console.error(`Failed to scrape website ${business.website}:`, error);
    }

    await sleep(1000);
  }

  console.log(`[Enrichment] ${business.name} — after website scrape: phone=${enriched.phone || 'none'}, email=${enriched.email || 'none'}, website=${enriched.website || 'none'}`);

  // Step 1b: Google Search fallback (source #2) — only for fields still
  // missing after Google Maps showed its listing data. Skip entirely when
  // the business already has a phone; that's the main contact channel and
  // the costliest to search for.
  const missingFields: string[] = [];
  if (!enriched.phone) missingFields.push('phone');
  if (!enriched.email) missingFields.push('email');
  if (!enriched.website) missingFields.push('website');
  if (!enriched.instagram) missingFields.push('instagram');
  if (!enriched.facebook) missingFields.push('facebook');
  if (!enriched.linkedin) missingFields.push('linkedin');

  if (missingFields.length > 0) {
    try {
      console.log(`[Enrichment] ${business.name} — Google Search fallback (missing: ${missingFields.join(', ')})`);
      const searchResult = await searchGoogleForBusiness(
        business.name,
        business.city || '',
        business.country || '',
        missingFields
      );

      if (searchResult.phone && !enriched.phone) {
        // Sanity-filter before assigning: a bare 12+ digit run with no real
        // separators is almost always a sliced Facebook/page ID, not a phone.
        const digitsOnly = searchResult.phone.replace(/\D/g, '');
        const hasSeperator = /[()\s.-]/.test(searchResult.phone);
        if (digitsOnly.length <= 15 && (hasSeperator || digitsOnly.length < 12)) {
          enriched.phone = searchResult.phone;
          enriched.sources.phone = { value: searchResult.phone, source: 'google_search', confidence: 'medium' };
        }
      }
      if (searchResult.email && !enriched.email) {
        enriched.email = searchResult.email;
        enriched.sources.email = { value: searchResult.email, source: 'google_search', confidence: 'medium' };
      }
      if (searchResult.website && !enriched.website && isCredibleWebsiteMatch(searchResult.website, business.name)) {
        enriched.website = searchResult.website;
        enriched.sources.website = { value: searchResult.website, source: 'google_search', confidence: 'medium' };
      }
      if (searchResult.instagram && !enriched.instagram) {
        enriched.instagram = searchResult.instagram;
        enriched.sources.instagram = { value: searchResult.instagram, source: 'google_search', confidence: 'medium' };
      }
      if (searchResult.facebook && !enriched.facebook) {
        enriched.facebook = searchResult.facebook;
        enriched.sources.facebook = { value: searchResult.facebook, source: 'google_search', confidence: 'medium' };
      }
      if (searchResult.linkedin && !enriched.linkedin) {
        enriched.linkedin = searchResult.linkedin;
        enriched.sources.linkedin = { value: searchResult.linkedin, source: 'google_search', confidence: 'medium' };
      }
      console.log(`[Enrichment] ${business.name} — Google Search filled: phone=${enriched.phone || 'none'}, email=${enriched.email || 'none'}, website=${enriched.website || 'none'}, ig=${enriched.instagram || 'none'}, fb=${enriched.facebook || 'none'}, li=${enriched.linkedin || 'none'}`);
    } catch (error) {
      console.log(`[Enrichment] ${business.name} — Google Search failed (non-fatal)`);
      console.error(error);
    }
  }

  // Step 1c: if the search fallback found a (credible) website and we didn't
  // already scrape one, run the full website scraper on it for deeper
  // email/socials.
  if (enriched.website && !wasWebsiteScraped && isCredibleWebsiteMatch(enriched.website, business.name)) {
    try {
      const scraped = await scrapeWebsite(enriched.website);

      if (scraped.phone && !enriched.phone) {
        enriched.phone = scraped.phone;
        enriched.sources.phone = scraped.sources.phone!;
      }
      if (scraped.email && !enriched.email) {
        enriched.email = scraped.email;
        enriched.sources.email = scraped.sources.email!;
      }
      if (scraped.instagram && !enriched.instagram) {
        enriched.instagram = scraped.instagram;
        enriched.sources.instagram = scraped.sources.instagram!;
      }
      if (scraped.facebook && !enriched.facebook) {
        enriched.facebook = scraped.facebook;
        enriched.sources.facebook = scraped.sources.facebook!;
      }
      if (scraped.linkedin && !enriched.linkedin) {
        enriched.linkedin = scraped.linkedin;
        enriched.sources.linkedin = scraped.sources.linkedin!;
      }
      if (scraped.contactPerson && !enriched.contact_person) {
        enriched.contact_person = scraped.contactPerson;
        enriched.sources.contact_person = scraped.sources.contact_person!;
      }
      console.log(`[Enrichment] ${business.name} — website scrape (found via search): email=${enriched.email || 'none'}, ig=${enriched.instagram || 'none'}, fb=${enriched.facebook || 'none'}, li=${enriched.linkedin || 'none'}`);
    } catch (error) {
      console.log(`[Enrichment] ${business.name} — website re-scrape failed (non-fatal)`);
    }
  }

  // Step 2: Validate phone number
  if (enriched.phone) {
    // Sliced-ID guard (any source, discovery included): a bare 12+ digit run
    // with no separators and no "+" country prefix is almost always an ID
    // (e.g. a Facebook page id like 178826546600), not a dialable number.
    const rawDigitCount = enriched.phone.replace(/\D/g, '').length;
    const rawBareRun = !/[()\s.-]/.test(enriched.phone);
    if (rawBareRun && rawDigitCount >= 12) {
      const rawPhone = enriched.phone;
      enriched.phone = undefined;
      if (enriched.sources.phone) delete enriched.sources.phone;
      console.log(`[Enrichment] ${business.name} — dropped sliced-ID phone "${rawPhone}"`);
    } else {
      try {
        // Only pass a real ISO2 country code (e.g. "PK"), never a full country
        // name like "Pakistan" — libphonenumber-js requires alpha-2 codes and
        // silently mis-parses/rejects otherwise-valid local-format numbers when
        // given anything else. If country_code is missing, parsing still works
        // unaided for E.164 (+-prefixed) numbers.
        const phoneValidation = validatePhone(enriched.phone, enriched.country_code || undefined);
        enriched.phone_valid = phoneValidation.valid;
        enriched.phone_country = phoneValidation.countryCode || undefined;
        enriched.phone = phoneValidation.formatted || enriched.phone;

        if (phoneValidation.valid) {
          enriched.sources.phone_valid = {
            value: 'true',
            source: 'libphonenumber-js',
            confidence: 'high',
          };
        }
      } catch {
        enriched.phone_valid = false;
        enriched.sources.phone_valid = {
          value: 'false',
          source: 'libphonenumber-js',
          confidence: 'high',
        };
      }
    }
  }

  // Step 2b: Verify the email domain actually accepts mail (free DNS MX
  // lookup, no external API/key) — a real, if partial, "verified" signal
  // distinct from paid mailbox-verification services.
  let emailVerified = false;
  if (enriched.email) {
    try {
      emailVerified = await verifyEmailDomain(enriched.email);
    } catch {
      emailVerified = false;
    }
    enriched.sources.email_domain_verified = {
      value: String(emailVerified),
      source: 'dns-mx-lookup',
      confidence: 'medium',
    };
  }

  // Step 3: Calculate confidence score
  const fieldsFound = [
    enriched.phone,
    enriched.email,
    enriched.website,
    enriched.instagram,
    enriched.facebook,
    enriched.linkedin,
    enriched.address,
  ].filter(Boolean).length;

  if (fieldsFound >= 5) {
    enriched.confidence = 'high';
  } else if (fieldsFound >= 3) {
    enriched.confidence = 'medium';
  } else {
    enriched.confidence = 'low';
  }

  // A lead counts as "verified" (real, contactable) when it has a valid
  // phone number OR a mail-accepting email domain — this is the gate the
  // orchestrator uses to decide whether a business fills the user's
  // requested lead quota. BUT the data must have come from a trustworthy
  // source for THAT business: the Google Maps listing, its own website, or
  // OSM tags — never from the text of a shared search-results page (which
  // mixes many companies and is how wrong-but-verified data leaked in).
  enriched.verified =
    (enriched.phone_valid && isTrustedContactSource(enriched.sources.phone?.source)) ||
    (emailVerified && isTrustedContactSource(enriched.sources.email?.source));

  return enriched;
}

function isTrustedContactSource(source: string | undefined): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  if (s.includes('google_maps')) return true;
  if (s.includes('osm')) return true;
  if (s.startsWith('website:')) return true;
  // google_search is trusted only because searchGoogleForBusiness now pulls
  // email/phone exclusively from the business's own website.
  if (s === 'google_search') return true;
  return false;
}
