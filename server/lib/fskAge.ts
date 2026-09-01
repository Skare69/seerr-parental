/**
 * Pure FSK/age helpers, kept dependency-free so the client bundle can import
 * them (parentalRatings.ts pulls in the logger and TMDB types, which must not
 * reach the browser).
 */

/** Highest FSK tier a person of this age may watch. */
export function fskFromAge(age: number): number {
  if (age >= 18) return 18;
  if (age >= 16) return 16;
  if (age >= 12) return 12;
  if (age >= 6) return 6;
  return 0;
}

/** Whole years since an ISO date (YYYY-MM-DD); 0 for unparseable input. */
export function ageFromDob(dob: string): number {
  const date = new Date(dob.slice(0, 10));
  if (Number.isNaN(date.getTime())) return 0;
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const monthDiff = now.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) {
    age--;
  }
  return Math.max(0, age);
}

/** FSK cap implied by a date of birth; null when no usable date is given. */
export function fskFromDob(dob?: string | null): number | null {
  return dob ? fskFromAge(ageFromDob(dob)) : null;
}
