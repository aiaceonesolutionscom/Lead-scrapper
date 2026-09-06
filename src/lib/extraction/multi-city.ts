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
// Only a country-wide search may sweep multiple cities (they are part of the
// country).

export const US_CITIES: string[] = [
  'Los Angeles',
  'San Diego',
  'Phoenix',
  'Houston',
  'Dallas',
  'San Antonio',
  'Chicago',
  'New York',
  'Miami',
  'Tampa',
  'Orlando',
  'Atlanta',
  'Charlotte',
  'Raleigh',
  'Nashville',
  'Denver',
  'Salt Lake City',
  'Seattle',
  'Portland',
  'San Francisco',
  'Sacramento',
  'Las Vegas',
  'Minneapolis',
  'Detroit',
  'Cleveland',
  'Cincinnati',
  'Indianapolis',
  'Kansas City',
  'St. Louis',
  'Oklahoma City',
  'New Orleans',
  'Memphis',
  'Boston',
  'Philadelphia',
  'Baltimore',
  'Richmond',
  'Virginia Beach',
  'Pittsburgh',
  'Milwaukee',
  'Columbus',
];

export interface Schedule {
  locations: string[];
}

/**
 * Build the ordered list of locations a search will sweep through.
 * - country-wide searches: start with the whole country (''), then its major
 *   metros — all still inside the country.
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
    return { locations: ['', ...US_CITIES] };
  }

  return { locations: [primary] };
}