// Fallback location schedule: when a whole-COUNTRY search runs out of
// discoverable businesses before reaching the requested lead count, the
// extractor rotates through the country's major cities. Each round draws from
// one location in this schedule, so a big country-wide search can reach e.g.
// 100 verified leads by aggregating many metros (discovery per city plateaus
// around 25-35 unique businesses via free sources: Google Maps + OSM + web
// search).
//
// IMPORTANT scope rule (user requirement): a CITY search stays strictly
// inside that one city — it never falls back to other cities. If the city
// cannot produce the requested count, the search stops with what it found.
// A country-wide search may sweep multiple cities, but ONLY cities inside
// that same country — never US cities for a Pakistan/Dubai search.
import { citiesForCountry } from '@/lib/utils/cities';

export interface Schedule {
  locations: string[];
}

/**
 * Build the ordered list of locations a search will sweep through.
 * - country-wide searches: start with the whole country (''), then that
 *   country's own major metros — nothing outside the country.
 * - city searches: the one chosen city ONLY. Never other cities.
 */
export function buildCitySchedule(params: {
  city: string | null;
  country: string;
  searchMode: 'city' | 'country';
  requestedCount: number;
}): Schedule {
  const primary = params.city?.trim() || '';

  if (params.searchMode === 'country' && params.requestedCount >= 10) {
    // The country's own metros (e.g. Karachi, Lahore, ... for Pakistan).
    // If the map has no entry for the typed country, treat the whole text as
    // a single place so we never sweep unrelated (US) cities.
    const inner = citiesForCountry(params.country);
    return inner.length > 0 ? { locations: ['', ...inner] } : { locations: [primary || params.country] };
  }

  return { locations: [primary] };
}