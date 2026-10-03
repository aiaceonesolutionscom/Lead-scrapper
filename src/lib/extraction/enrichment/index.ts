import type { DiscoveryBusiness, EnrichedBusiness } from '@/types';
import { scrapeWebsite } from './website-scraper';
import { searchGoogleForBusiness, socialMatchesBusiness } from './google-search';
import { validatePhone } from '@/lib/utils/phone';
import { verifyEmailDomain } from '@/lib/utils/email-verify';
import { isCredibleWebsiteMatch, extractDomain, distinctiveBusinessTokens, isForeignCcTldMatch } from '@/lib/utils';
import { isRelevantToKeyword, RELEVANCE_GATED_SOURCES } from '../relevance';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Free/no-company email domains: addresses on these are never "another
// company's inbox" no matter what page they were scraped from.
const PERSONAL_MAILERS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'live.co.uk',
  'msn.com',
  'proton.me',
  'protonmail.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'mail.com',
  'zoho.com',
  'gmx.com',
]);

export async function enrichBusiness(business: DiscoveryBusiness, keyword?: string, shouldAbort?: () => Promise<boolean>): Promise<EnrichedBusiness> {
  const enriched: EnrichedBusiness = {
    ...business,
    sources: {},
    verified: false,
    confidence: 'low',
  };

  const aborted = async () => (shouldAbort ? await shouldAbort() : false);

  // Relevance gate (safety net): engine-sourced candidates whose final
  // data does not match the search keyword are marked non-relevant even
  // when a valid phone/email was scraped.  This catches any leftover junk
  // that slipped through the discovery-level relevance gate.
  const isEngineSource = RELEVANCE_GATED_SOURCES.has(business.source);
  const relevant = isEngineSource && keyword
    ? isRelevantToKeyword(keyword, [business.name, business.website || '', business.address || '', business.source_url || ''].join(' '))
    : true;
  enriched.relevant = relevant;
  if (!relevant) {
    console.log(`[Enrichment] ${business.name} — not relevant to "${keyword}" (engine-sourced), will not verify`);
  }

  console.log(`[Enrichment] ${business.name} — starting enrichment (phone: ${business.phone || 'none'}, website: ${business.website || 'none'}, email: ${business.email || 'none'})`);

  // Copy initial sources from discovery. The website is a credibility risk: a
  // Google Maps/OSM listing can point at a neighbouring/unrelated domain (the
  // CCG Crystals -> saltboxrecordsla.com case). Only treat it as a trustworthy
  // source when its domain plausibly matches the business name; otherwise drop
  // it now and let the web-search fallback rediscover the real site.
  const websiteCredible = isCredibleWebsiteMatch(business.website, business.name, {
    city: business.city,
    country: business.country,
    countryCode: business.country_code,
  });
  if (business.website && !websiteCredible) {
    console.log(`[Enrichment] ${business.name} — discarded non-matching website "${business.website}", will rediscover via search`);
    delete enriched.website;
  }

  // Discovery-sourced socials (Google Maps detail panel) can point at a foreign
  // brand that merely shares a word with this business (a Karachi "Regent
  // Banquet" listing exposing the Hong Kong Regent hotel's Instagram). Drop any
  // social whose handle does NOT strongly match THIS business's name, no matter
  // where it came from.
  const discoveryDomain = business.website ? extractDomain(business.website) || undefined : undefined;
  for (const field of ['instagram', 'facebook', 'linkedin'] as const) {
    const url = enriched[field];
    if (url && !socialMatchesBusiness(url, business.name, discoveryDomain)) {
      console.log(`[Enrichment] ${business.name} — dropped mismatched ${field} (${url})`);
      delete enriched[field];
    }
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
    if (await aborted()) return enriched;
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

  // Step 2: Validate phone number FIRST so the expensive web-search fallback
  // below can be skipped entirely once we already hold a trustworthy contact.
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
        const leadCountry = enriched.country_code;
        // A phone is usable only when it parses VALID, belongs to the business's
        // own country (a "+852"/"+1 800" number on a PK listing is another
        // company's line), and is not an implausibly long national run (the
        // library marks 12-digit "+92 774 056 383 985" valid although no PK
        // number is that long). Anything else is dropped so the fallback can
        // rediscover the real number instead of storing a wrong-but-"verified"
        // one.
        const phoneGood =
          phoneValidation.valid &&
          (!leadCountry || !phoneValidation.countryCode || phoneValidation.countryCode === leadCountry) &&
          ((phoneValidation.nationalNumber?.length ?? 0) <= 11) &&
          !/(\d)\1{4}/.test(phoneValidation.nationalNumber ?? '');
        if (!phoneGood) {
          const droppedPhone = enriched.phone;
          enriched.phone = undefined;
          enriched.phone_valid = false;
          enriched.phone_country = undefined;
          if (enriched.sources.phone) delete enriched.sources.phone;
          console.log(`[Enrichment] ${business.name} — dropped ${phoneValidation.valid ? 'out-of-country/oversized' : 'invalid'} phone "${droppedPhone}"`);
        } else {
          enriched.phone_valid = true;
          enriched.phone_country = phoneValidation.countryCode ?? undefined;
          enriched.phone = phoneValidation.formatted || enriched.phone;
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

  // Step 1b: Google Search fallback (source #2) — but ONLY when we still lack
  // ANY verified contact (a valid phone OR a mail-accepting email from a
  // trusted source). Once a business already has a trustworthy phone from
  // Google Maps / OSM / its own website it is ALREADY "verified": chasing the
  // remaining email + socials across 4-5 Bing page loads per business was the
  // #1 reason enrichment crawled. Email/socials for such businesses are still
  // attempted via their own website (step 1) — the fast, free path.
  const missingFields: string[] = [];
  if (!enriched.phone) missingFields.push('phone');
  if (!enriched.email) missingFields.push('email');
  if (!enriched.website) missingFields.push('website');
  if (!enriched.instagram) missingFields.push('instagram');
  if (!enriched.facebook) missingFields.push('facebook');
  if (!enriched.linkedin) missingFields.push('linkedin');

  const alreadyVerified =
    (enriched.phone_valid && isTrustedContactSource(enriched.sources.phone?.source)) ||
    (emailVerified && isTrustedContactSource(enriched.sources.email?.source));

  if (missingFields.length > 0 && !alreadyVerified && (missingFields.includes('phone') || missingFields.includes('email'))) {
    if (await aborted()) return enriched;
    try {
      // Only probe the fields that actually unlock "verified": phone, email,
      // and the website (whose visit is what yields phone/email). Social
      // handles come from the business's own site, never from extra Bing
      // probes on the shared results page (which leak cross-company links).
      const fallbackFields = ['phone', 'email', 'website'].filter((f) => missingFields.includes(f));
      console.log(`[Enrichment] ${business.name} — Google Search fallback (missing: ${fallbackFields.join(', ')})`);
      const searchResult = await searchGoogleForBusiness(
        business.name,
        business.city || '',
        business.country || '',
        fallbackFields,
        shouldAbort
      );

      if (searchResult.phone && !enriched.phone) {
        // Sanity-filter before assigning: a bare 12+ digit run with no real
        // separators is almost always a sliced Facebook/page ID, not a phone.
        const digitsOnly = searchResult.phone.replace(/\D/g, '');
        const hasSeperator = /[()\s.-]/.test(searchResult.phone);
        const withPlus = searchResult.phone.trim().startsWith('+');
        const localDigits = withPlus ? digitsOnly.slice(1) : digitsOnly;
        const saneLength =
          digitsOnly.length <= 15 &&
          (hasSeperator || digitsOnly.length < 12) &&
          localDigits.length <= 11 &&
          !/(\d)\1{4}/.test(digitsOnly);
        if (saneLength) {
          // Gate BEFORE storing: valid, in the business's country, sane length.
          // Otherwise skip it (never a wrong-but-"verified" number) so the real
          // one can still be found elsewhere.
          try {
            const pv = validatePhone(searchResult.phone, enriched.country_code || undefined);
            const leadCountry = enriched.country_code;
            const good =
              pv.valid &&
              (!leadCountry || !pv.countryCode || pv.countryCode === leadCountry) &&
              ((pv.nationalNumber?.length ?? 0) <= 11) &&
              !/(\d)\1{4}/.test(pv.nationalNumber ?? '');
            if (good) {
              enriched.phone = pv.formatted || searchResult.phone;
              enriched.phone_valid = true;
              enriched.phone_country = pv.countryCode ?? undefined;
              enriched.sources.phone = { value: enriched.phone, source: 'google_search', confidence: 'medium' };
              enriched.sources.phone_valid = { value: 'true', source: 'libphonenumber-js', confidence: 'high' };
            } else {
              console.log(`[Enrichment] ${business.name} — dropped ${pv.valid ? 'out-of-country/oversized' : 'invalid'} google-search phone "${searchResult.phone}"`);
            }
          } catch {
            // No phone accepted if it can't be validated cleanly.
          }
        }
      }
      if (searchResult.email && !enriched.email) {
        enriched.email = searchResult.email;
        enriched.sources.email = { value: searchResult.email, source: 'google_search', confidence: 'medium' };
        try {
          emailVerified = await verifyEmailDomain(searchResult.email);
        } catch {
          emailVerified = false;
        }
        enriched.sources.email_domain_verified = {
          value: String(emailVerified),
          source: 'dns-mx-lookup',
          confidence: 'medium',
        };
      }
      if (searchResult.website && !enriched.website && isCredibleWebsiteMatch(searchResult.website, business.name, {
        city: business.city,
        country: business.country,
        countryCode: business.country_code,
      })) {
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
  // already scrape one, run the full website scraper on it — it is now the
  // authoritative source for deeper email/socials (and the fast path that
  // unlocks verified, so it is always worth the one HTTP pass).
  if (enriched.website && !wasWebsiteScraped && isCredibleWebsiteMatch(enriched.website, business.name, {
    city: business.city,
    country: business.country,
    countryCode: business.country_code,
  })) {
    if (await aborted()) return enriched;
    try {
      const scraped = await scrapeWebsite(enriched.website);

      if (scraped.phone && !enriched.phone) {
        // Gate website-scraped phone the same way: valid + in-country + sane
        // length, or don't keep it (the business's site can still list an
        // out-of-country contact when it's a branch of a foreign brand).
        try {
          const pv = validatePhone(scraped.phone, enriched.country_code || undefined);
          const leadCountry = enriched.country_code;
          const good =
            pv.valid &&
            (!leadCountry || !pv.countryCode || pv.countryCode === leadCountry) &&
            ((pv.nationalNumber?.length ?? 0) <= 11) &&
            !/(\d)\1{4}/.test(pv.nationalNumber ?? '');
          if (good) {
            enriched.phone = pv.formatted || scraped.phone;
            enriched.phone_valid = true;
            enriched.phone_country = pv.countryCode ?? undefined;
            enriched.sources.phone = scraped.sources.phone || { value: enriched.phone, source: 'website', confidence: 'medium' };
            enriched.sources.phone_valid = { value: 'true', source: 'libphonenumber-js', confidence: 'high' };
          } else {
            console.log(`[Enrichment] ${business.name} — dropped ${pv.valid ? 'out-of-country/oversized' : 'invalid'} website phone "${scraped.phone}"`);
          }
        } catch {
          // Keep no phone if it can't be validated cleanly.
        }
      }
      if (scraped.email && !enriched.email) {
        enriched.email = scraped.email;
        enriched.sources.email = scraped.sources.email!;
        if (!enriched.sources.email_domain_verified) {
          try {
            emailVerified = await verifyEmailDomain(scraped.email);
          } catch {
            emailVerified = false;
          }
          enriched.sources.email_domain_verified = {
            value: String(emailVerified),
            source: 'dns-mx-lookup',
            confidence: 'medium',
          };
        }
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

  // ---- Final trust gate ------------------------------------------------
  // Sweep once more AFTER every source (discovery, scrape, search) added its
  // data. Misses here are exactly what polluted the "Shadi halls / Karachi"
  // batch: a non-matching website left in place, or socials/emails pulled from
  // a shared search page whose company only shares a word with this one.
  {
    const geo = { city: business.city, country: business.country, countryCode: business.country_code };

    // A field can be harvested from a site that was LATER rejected as
    // non-matching. "Radiance Banquet" (Karachi) ended up with website=NULL
    // because radiancecomputer.com was correctly discarded, yet that same
    // unrelated site's gmail address and socials were kept because they had
    // already been scraped. Re-check the ORIGIN of every contact field: if a
    // value came from `website: <url>` and <url> is not credible for this
    // business, the value is another company's contact and must go too.
    for (const field of ['email', 'instagram', 'facebook', 'linkedin', 'phone'] as const) {
      const src = enriched.sources[field]?.source;
      if (typeof src !== 'string' || !src.startsWith('website:')) continue;
      const originUrl = src.slice('website:'.length).trim().replace(/[),;]+$/, '');
      if (!originUrl || isCredibleWebsiteMatch(originUrl, business.name, geo)) continue;
      console.log(`[Enrichment] ${business.name} — dropped ${field} "${enriched[field]}" scraped from non-credible site ${originUrl}`);
      delete enriched[field];
      if (enriched.sources[field]) delete enriched.sources[field];
      if (field === 'email' && enriched.sources.email_domain_verified) {
        delete enriched.sources.email_domain_verified;
      }
    }

    if (enriched.website && !isCredibleWebsiteMatch(enriched.website, business.name, geo)) {
      console.log(`[Enrichment] ${business.name} — dropped mismatched website at final gate: ${enriched.website}`);
      delete enriched.website;
      if (enriched.sources.website) delete enriched.sources.website;
    }
    const credibleDomain = enriched.website ? extractDomain(enriched.website) || undefined : undefined;
    const nameTokens = distinctiveBusinessTokens(business.name);
    const domainLooksLikeName = (d: string) => nameTokens.some((t) => d.replace(/^www\./, '').toLowerCase().includes(t));

    // For a free mailer the domain carries no signal (everyone shares
    // gmail.com), so relevance has to come from the local part. Compare it
    // against the business's DISTINCTIVE tokens only — generic category words
    // like "restaurant" appear in far too many unrelated inboxes to count.
    const addressLooksLikeName = (email: string) => {
      const [local = '', domain = ''] = email.toLowerCase().split('@');
      if (domainLooksLikeName(domain)) return true;
      const normalizedLocal = local.replace(/[^a-z0-9]/g, '');
      return nameTokens.some((t) => normalizedLocal.includes(t));
    };

    for (const field of ['instagram', 'facebook', 'linkedin'] as const) {
      const url = enriched[field];
      if (url && !socialMatchesBusiness(url, business.name, credibleDomain)) {
        console.log(`[Enrichment] ${business.name} — dropped mismatched ${field} at final gate: ${url}`);
        delete enriched[field];
        if (enriched.sources[field]) delete enriched.sources[field];
      }
    }

    // An email is a danger when it was harvested from an EXTERNAL page rather
    // than from this business's own (credible) site. A google-search email is
    // kept only if the final credible website exists, or the ADDRESS echoes the
    // business's own name.
    //
    // Free mailers used to be waved through unconditionally, which is how
    // "Zouq-E-Saeed Restaurant" ended up with swatifabric2381@gmail.com — a
    // fabric dealer's inbox. On a shared SERP a gmail address is exactly as
    // likely to be someone else's as a corporate domain, so it gets the same
    // relevance test: the local part must contain a distinctive business token
    // (zouq / saeed), not merely any word from the name.
    if (enriched.email) {
      const [, domain = ''] = enriched.email.toLowerCase().split('@').map((s) => s.trim());
      const src = enriched.sources.email?.source;
      const fromExternalSearch = src === 'google_search' || src === 'bing_search';
      if (fromExternalSearch && domain && !credibleDomain && !addressLooksLikeName(enriched.email)) {
        console.log(`[Enrichment] ${business.name} — dropped ${src} email unrelated to this business "${enriched.email}"`);
        delete enriched.email;
        if (enriched.sources.email) delete enriched.sources.email;
        if (enriched.sources.email_domain_verified) delete enriched.sources.email_domain_verified;
      } else if (PERSONAL_MAILERS.has(domain) && fromExternalSearch && !addressLooksLikeName(enriched.email)) {
        console.log(`[Enrichment] ${business.name} — dropped free-mailer email not matching name "${enriched.email}"`);
        delete enriched.email;
        if (enriched.sources.email) delete enriched.sources.email;
        if (enriched.sources.email_domain_verified) delete enriched.sources.email_domain_verified;
      } else if (isForeignCcTldMatch(domain, business.country_code)) {
        console.log(`[Enrichment] ${business.name} — dropped email on foreign country-TLD "${enriched.email}"`);
        delete enriched.email;
        if (enriched.sources.email) delete enriched.sources.email;
        if (enriched.sources.email_domain_verified) delete enriched.sources.email_domain_verified;
      }
    }
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

  // Non-relevant leads always get low confidence regardless of how many
  // fields were scraped — they are junk that sneaked in via the SERP.
  if (!relevant) {
    enriched.confidence = 'low';
  }

  // A lead counts as "verified" (real, contactable) when it has a valid
  // phone number OR a mail-accepting email domain — this is the gate the
  // orchestrator uses to decide whether a business fills the user's
  // requested lead quota. BUT the data must have come from a trustworthy
  // source for THAT business: the Google Maps listing, its own website, or
  // OSM tags — never from the text of a shared search-results page (which
  // mixes many companies and is how wrong-but-verified data leaked in).
  // Non-relevant engine-sourced leads are NEVER verified even when the
  // phone/email technically validates (this is the safety-net gate).
  enriched.verified =
    relevant &&
    ((enriched.phone_valid && isTrustedContactSource(enriched.sources.phone?.source)) ||
    (emailVerified && isTrustedContactSource(enriched.sources.email?.source)));

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
