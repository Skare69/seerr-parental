import type TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieDetails,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import type { User } from '@server/entity/User';
import { fskFromDob } from '@server/lib/fskAge';
import logger from '@server/logger';

export const PARENTAL_COUNTRY = 'DE';

export class ParentalRestrictionError extends Error {}

export { fskFromAge } from '@server/lib/fskAge';

// ponytail: memo never evicted — fine for a family instance; clear() if user count grows
const dailyMemo = new Map<string, number | null>();

/**
 * Effective per-user maximum FSK rating. A stored date of birth is
 * authoritative — it derives the cap and ages up on its own — and the explicit
 * admin rating applies only when no date of birth is set (the two are mutually
 * exclusive on write). null = unrestricted.
 */
export function getEffectiveMaxRating(user?: User): number | null {
  if (!user) return null;

  // The key carries both inputs, so an admin's change takes effect on the next
  // request instead of after UTC midnight, while the date still bounds the
  // age derivation to one computation per day.
  const key = [
    user.id,
    new Date().toISOString().slice(0, 10),
    user.dateOfBirth ?? '',
    user.maxParentalRating ?? '',
  ].join(':');
  const memo = dailyMemo.get(key);
  if (memo !== undefined) return memo;

  const cap = user.dateOfBirth
    ? fskFromDob(user.dateOfBirth)
    : (user.maxParentalRating ?? null);

  dailyMemo.set(key, cap);
  return cap;
}

function certNumber(cert: string): number | null {
  const m = cert.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/** Numeric FSK rating of a title in PARENTAL_COUNTRY; null = unknown. */
export function extractCertNumber(
  mediaType: 'movie' | 'tv',
  details: TmdbMovieDetails | TmdbTvDetails
): number | null {
  if (mediaType === 'movie') {
    const de = (details as TmdbMovieDetails).release_dates?.results?.find(
      (r) => r.iso_3166_1 === PARENTAL_COUNTRY
    );
    if (!de) return null;
    const values = de.release_dates
      .map((rd) => certNumber(rd.certification))
      .filter((v): v is number => v !== null);
    return values.length ? Math.max(...values) : null;
  }

  const de = (details as TmdbTvDetails).content_ratings?.results?.find(
    (r) => r.iso_3166_1 === PARENTAL_COUNTRY
  );
  return de ? certNumber(de.rating) : null;
}

export function isOverCap(cert: number | null, cap: number): boolean {
  // Unknown certification is treated as adult (fail closed).
  return cert === null || cert > cap;
}

export async function titleCertNumber(
  tmdb: TheMovieDb,
  mediaType: 'movie' | 'tv',
  id: number
): Promise<number | null> {
  try {
    const details =
      mediaType === 'movie'
        ? await tmdb.getMovie({ movieId: id })
        : await tmdb.getTvShow({ tvId: id });
    return extractCertNumber(mediaType, details);
  } catch {
    return null; // fail closed on lookup errors
  }
}

/**
 * TMDB genre ids barred for this user; empty = nothing blocked. Guards the
 * `simple-array` round trip, which turns an empty list into `['']`.
 */
export function getBlockedGenres(user?: User): number[] {
  return (
    user?.blockedGenres
      ?.map(Number)
      .filter((id) => Number.isInteger(id) && id > 0) ?? []
  );
}

/**
 * Whether a title's genres bar it for this user. An untagged title is an
 * unknown one, and unknown fails closed — the same rule the age cap already
 * applies to a missing certification. Both only bite once the parent has
 * actually restricted something.
 */
export function genreBlocked(
  genreIds: number[] | undefined,
  blocked: number[]
): boolean {
  if (!blocked.length) return false;
  return !genreIds?.length || genreIds.some((id) => blocked.includes(id));
}

/**
 * Single gate for the detail and request boundaries: a title is barred when
 * it carries a blocked genre or sits above the user's age cap.
 */
export function isTitleBlocked(
  user: User | undefined,
  mediaType: 'movie' | 'tv',
  details: TmdbMovieDetails | TmdbTvDetails
): boolean {
  const blocked = getBlockedGenres(user);
  if (
    genreBlocked(
      details.genres?.map((genre) => genre.id),
      blocked
    )
  ) {
    return true;
  }

  const cap = getEffectiveMaxRating(user);
  return cap !== null && isOverCap(extractCertNumber(mediaType, details), cap);
}

/**
 * Post-fetch redaction for endpoints TMDB cannot filter server-side
 * (search, trending, recommendations, similar). Persons/collections pass
 * through — the content itself is gated by the detail/request checks.
 */
export async function filterRestrictedResults<
  T extends { id: number; mediaType: string; genreIds?: number[] },
>(user: User | undefined, tmdb: TheMovieDb, results: T[]): Promise<T[]> {
  const cap = getEffectiveMaxRating(user);
  const blocked = getBlockedGenres(user);
  if (cap === null && !blocked.length) return results;
  const kept = await Promise.all(
    results.map(async (result) => {
      if (result.mediaType !== 'movie' && result.mediaType !== 'tv') {
        return result;
      }
      // Genre ids ride along on every result, so this rejects for free —
      // and skips the certification lookup below.
      if (genreBlocked(result.genreIds, blocked)) return null;
      if (cap === null) return result;
      const cert = await titleCertNumber(tmdb, result.mediaType, result.id);
      return isOverCap(cert, cap) ? null : result;
    })
  );
  return kept.filter((r) => r !== null) as T[];
}

// ponytail: promise memo per (mediaType, cap) — one TMDB cert-list call per
// process per value; rejected promises are evicted so a later call can retry.
const capCertMemo = new Map<string, Promise<string>>();

/**
 * The exact PARENTAL_COUNTRY certification string TMDB's discover
 * `certification.lte` expects for the given numeric cap, resolved from the
 * (7-day cached) certification list so we never hardcode TMDB's labels.
 */
export function capToCertification(
  tmdb: TheMovieDb,
  mediaType: 'movie' | 'tv',
  cap: number
): Promise<string> {
  const key = `${mediaType}:${cap}`;
  let p = capCertMemo.get(key);
  if (!p) {
    p = (async () => {
      const list =
        mediaType === 'movie'
          ? await tmdb.getMovieCertifications()
          : await tmdb.getTvCertifications();
      const certs = (list.certifications[PARENTAL_COUNTRY] ?? [])
        .map((c) => ({
          cert: c.certification,
          n: certNumber(c.certification),
          order: c.order ?? 0,
        }))
        .filter(
          (c): c is { cert: string; n: number; order: number } => c.n !== null
        )
        .sort((a, b) => a.order - b.order);

      let best: string | null = null;
      for (const c of certs) {
        if (c.n <= cap) best = c.cert;
      }
      if (!best) {
        logger.warn(
          `No ${PARENTAL_COUNTRY} certification found for cap ${cap}; discover filtering unavailable`,
          { label: 'Parental Ratings' }
        );
        throw new Error('No matching certification for parental cap');
      }
      return best;
    })();
    p.catch(() => capCertMemo.delete(key));
    capCertMemo.set(key, p);
  }
  return p;
}
