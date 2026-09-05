import {
  parsePhoneNumber,
  getCountryCallingCode,
  isPossiblePhoneNumber,
  type PhoneNumber,
  type CountryCode,
} from 'libphonenumber-js';

export interface PhoneValidationResult {
  valid: boolean;
  possible: boolean;
  formatted: string | null;
  e164: string | null;
  countryCode: string | null;
  country: string | null;
  type: string | null;
  carrier: string | null;
  areaCode: string | null;
  nationalNumber: string | null;
  error: string | null;
}

export function validatePhone(phone: string, defaultCountry?: string | null): PhoneValidationResult {
  const result: PhoneValidationResult = {
    valid: false,
    possible: false,
    formatted: null,
    e164: null,
    countryCode: null,
    country: null,
    type: null,
    carrier: null,
    areaCode: null,
    nationalNumber: null,
    error: null,
  };

  if (!phone || !phone.trim()) {
    result.error = 'Empty phone number';
    return result;
  }

  const cleaned = phone.trim();
  const country = defaultCountry as CountryCode | undefined;

  try {
    const parsed: PhoneNumber | undefined = parsePhoneNumber(cleaned, country);

    if (!parsed) {
      result.error = 'Could not parse phone number';
      result.possible = isPossiblePhoneNumber(cleaned, country);
      return result;
    }

    result.valid = parsed.isValid();
    result.possible = parsed.isPossible();
    // Always include the country code (e.g. "+44 20 7946 0958") rather than
    // national format (e.g. "020 7946 0958") — leads are meant to be dialed
    // from anywhere, and a bare national number is ambiguous once exported.
    result.formatted = parsed.formatInternational() || null;
    result.e164 = parsed.formatInternational() || null;
    result.countryCode = parsed.country || null;
    result.country = parsed.country || null;
    result.type = parsed.getType() || null;
    result.nationalNumber = parsed.nationalNumber || null;

    if (parsed.country) {
      try {
        const callingCode = getCountryCallingCode(parsed.country);
        result.areaCode = `+${callingCode}`;
      } catch {
        // Calling code not available
      }
    }

    if (!result.valid && result.possible) {
      result.formatted = parsed.formatInternational() || cleaned;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown validation error';
    result.error = message;

    // Try basic possibility check
    try {
      result.possible = isPossiblePhoneNumber(cleaned, country);
    } catch {
      // Ignore
    }
  }

  return result;
}

export function formatToE164(phone: string, defaultCountry?: string): string | null {
  const country = defaultCountry as CountryCode | undefined;
  try {
    const parsed = parsePhoneNumber(phone, country);
    if (parsed && parsed.isValid()) {
      return parsed.formatInternational();
    }
    if (parsed && parsed.isPossible()) {
      return parsed.formatInternational();
    }
  } catch {
    // Fall through
  }
  return null;
}

export function detectCountry(phone: string): string | null {
  try {
    const parsed = parsePhoneNumber(phone);
    return parsed?.country || null;
  } catch {
    return null;
  }
}

export function detectPhoneType(phone: string, defaultCountry?: string): string | null {
  const country = defaultCountry as CountryCode | undefined;
  try {
    const parsed = parsePhoneNumber(phone, country);
    return parsed?.getType() || null;
  } catch {
    return null;
  }
}

export function getCountryFromCode(countryCode: string): string | null {
  try {
    const callingCode = getCountryCallingCode(countryCode as CountryCode);
    return `+${callingCode}`;
  } catch {
    return null;
  }
}

export function isMobileNumber(phone: string, defaultCountry?: string): boolean {
  const country = defaultCountry as CountryCode | undefined;
  try {
    const parsed = parsePhoneNumber(phone, country);
    return parsed?.getType() === 'MOBILE' || parsed?.getType() === 'FIXED_LINE_OR_MOBILE';
  } catch {
    return false;
  }
}

export function isLandlineNumber(phone: string, defaultCountry?: string): boolean {
  const country = defaultCountry as CountryCode | undefined;
  try {
    const parsed = parsePhoneNumber(phone, country);
    return parsed?.getType() === 'FIXED_LINE';
  } catch {
    return false;
  }
}
