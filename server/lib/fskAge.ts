/**
 * Pure FSK/age helpers, kept dependency-free so the client bundle can import
 * them (parentalRatings.ts pulls in the logger and TMDB types, which must not
 * reach the browser).
 */

/**
 * Highest FSK tier a person of this age may watch. There is no FSK 18 tier:
 * from 18 on a person is unrestricted (null).
 */
export function fskFromAge(age: number): number | null {
  if (age >= 18) return null;
  if (age >= 16) return 16;
  if (age >= 12) return 12;
  if (age >= 6) return 6;
  return 0;
}

function parseIsoDate(dob: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900) return null;
  // Reject impossible calendar dates (e.g. 2019-02-31, 2019-02-29) instead of
  // letting Date silently roll them over.
  const date = new Date(y, mo - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return [y, mo, d];
}

/**
 * True only for a real YYYY-MM-DD calendar date, year >= 1900, that is not
 * after today's LOCAL calendar date.
 */
export function isValidDob(dob: string, today: Date = new Date()): boolean {
  const parts = parseIsoDate(dob);
  if (!parts) return false;
  const [y, mo, d] = parts;
  if (y > today.getFullYear()) return false;
  if (y === today.getFullYear() && mo > today.getMonth() + 1) return false;
  if (
    y === today.getFullYear() &&
    mo === today.getMonth() + 1 &&
    d > today.getDate()
  ) {
    return false;
  }
  return true;
}

/** Whole years since an ISO date (YYYY-MM-DD); 0 for unparseable input. */
export function ageFromDob(dob: string): number {
  const parts = parseIsoDate(dob);
  if (!parts) return 0;
  const [y, mo, d] = parts;
  // Compare against the LOCAL calendar date components, never the string
  // parsed as UTC midnight.
  const now = new Date();
  let age = now.getFullYear() - y;
  // A Feb-29 birthday ages up on Mar 1 in non-leap years: the month/day
  // comparison below never matches on Feb 28 of those years.
  if (
    mo > now.getMonth() + 1 ||
    (mo === now.getMonth() + 1 && d > now.getDate())
  ) {
    age--;
  }
  return Math.max(0, age);
}

/**
 * FSK cap implied by a date of birth; null without a dob, 0 for an invalid
 * one (fail closed).
 */
export function fskFromDob(dob?: string | null): number | null {
  if (!dob) return null;
  if (!isValidDob(dob)) return 0;
  return fskFromAge(ageFromDob(dob));
}
