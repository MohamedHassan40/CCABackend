import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

function isoCountryHint(raw?: string | null): CountryCode | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const c = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c)) return c as CountryCode;
  return undefined;
}

/** Normalize stored/input phone to E.164; empty input returns null without error. */
export function normalizeMemberPhone(
  input: string | null | undefined,
  countryIso?: string | null,
): { e164: string | null; error?: string } {
  if (input == null || String(input).trim() === '') return { e164: null };
  const raw = String(input).trim();
  const hint = isoCountryHint(countryIso);
  let parsed = parsePhoneNumberFromString(raw, hint);
  if (!parsed?.isValid()) {
    parsed = parsePhoneNumberFromString(raw);
  }
  if (!parsed?.isValid()) {
    return { e164: null, error: 'Invalid phone number for selected country' };
  }
  return { e164: parsed.number };
}
