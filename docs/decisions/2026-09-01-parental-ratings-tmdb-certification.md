# Decision: TMDB discover certification filtering for parental limits

Date: 2026-09-01 (feature: per-user parental rating limits, branch `feat/parental-ratings`)

## What was measured (live TMDB API, bundled dev key)

Movie discover (`/discover/movie`) **honors** DE certification filters:

| `certification.lte` (DE) | total_results |
|---|---|
| 18 | 39 432 |
| 6 | 11 187 |
| 0 | 5 872 |

TV discover (`/discover/tv`) **ignores them completely**:

| `certification.lte` (DE) | total_results |
|---|---|
| FSK 18 | 10 429 |
| FSK 6 | 10 429 |
| FSK 0 | 10 429 |

## Decision

- Movies: server-side injection of `certification_country=DE&certification.lte=<n>`
  (TMDB also excludes titles without a DE certification there, which matches
  the "unknown = adult" fallback rule).
- TV: post-fetch filter using `content_ratings` from cached detail lookups,
  fail-closed on missing/unknown certification. Implemented inside
  `TheMovieDb.getDiscoverTv` so every TV discover route gets it.
- The rejected alternative by name: relying on TMDB's TV certification
  parameters (as the discover.ts `QueryFilterOptions` schema suggests is
  possible). Measured above: does not work for DE (or at all), 2026-09-01.

## Related conventions kept

- Cert-string resolution never hardcodes TMDB labels: the exact
  `certification.lte` string is resolved from the cached
  `/certification/{movie,tv}/list` payload (DE strings are plain `"0".."18"`,
  order-sorted), so a future label change cannot silently break filtering.
- Explicit per-user cap and DOB-derived cap combine via `min` (stricter wins).
