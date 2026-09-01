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

## Revision 2026-09-01 (later the same day)

- The explicit cap and the DOB-derived cap no longer combine via `min`. They
  are **mutually exclusive**: a stored date of birth is authoritative and
  clears any fixed rating on write, because two competing limits on one
  account cannot be reasoned about in the UI ("which one is in force?").
  Enforced in `POST /user/{id}/settings/parental`, mirrored in the form.
- The parental fields moved off `/settings/main` onto their own
  `/settings/parental` endpoint plus a **Parental Controls** tab, matching the
  per-tab endpoint convention already used by permissions and notifications.
  A partial POST to `/settings/main` would otherwise blank unrelated settings.
- Bug found by the first deployment: `maxParentalRating` was declared
  `nullable: true` with `enum: [0, 6, 12, 16, 18]`. In OAS 3.0/ajv semantics
  `nullable` widens the type but does **not** exempt the value from `enum`, so
  submitting "Unrestricted" (null) failed spec validation and the whole user
  settings form refused to save — with a misleading "profile picture gone"
  symptom, since nothing on the form persisted. `null` is now in the enum, and
  `server/routes/user/parentalSpec.test.ts` mounts the real validator against a
  stub handler so this class of bug cannot recur silently (the existing route
  tests do not mount the validator, which is exactly why it shipped).
- `getEffectiveMaxRating`'s daily memo key now includes both inputs. It
  previously keyed on user id + date only, so an admin's change to a cap was
  ignored until UTC midnight.
