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

## Revision 2026-10-13 (code review against upstream)

- Upstream PR [#2415](https://github.com/seerr-team/seerr/pull/2415) builds the
  same feature with US ratings. The maintainers asked its author to split it
  into six PRs, and they closed #3163 as a duplicate of it. This fork opens no
  competing PR. The parts that #2415 does not have (the date-of-birth cap and
  DE/FSK) go upstream as follow-up PRs on top of #2415.
- Adults are unrestricted. `fskFromAge` returns `null` from age 18. The fixed
  tier 18 is removed, and a stored 18 counts as unrestricted: a cap of 18 only
  hid unrated titles.
- The age uses the local calendar date: the date of birth is read as Y-M-D
  numbers, not as UTC midnight. The daily memo is removed. It grew without
  bound and kept a stale cap until UTC midnight. The server now derives the
  cap on each request that needs it. One derivation takes about 0.8 µs, and
  the user row is already loaded for each request. A daily or login-time value
  needs stored state, and a session lasts 30 days, so we do not cache it.
- A date of birth must be a real calendar date, from 1900, and not in the
  future. The API returns 400 for other values.
- `dateOfBirth`, `maxParentalRating` and `blockedGenres` are in
  `User.filteredFields` and `User.serializationExcludedFields`. Before, any
  signed-in user could read every date of birth through `GET /user` and
  nested `requestedBy` objects.
- `/settings/parental` protects the owner and admins from other non-owner
  users (the rule of the `/password` routes). A user without ADMIN cannot
  change their own limits.
- A user with MANAGE_REQUESTS can request an over-cap title for another user,
  but a capped user cannot request it for themselves.
- The limits also apply to the studio, network, keyword and genre-slider
  lists, collection parts, person credits, and the ratings routes. All
  detail, ratings and request checks use one gate, `isTitleBlocked`, for the
  age cap and the blocked genres.
- A short filtered page no longer stops infinite scroll while TMDB has more
  pages. Three empty pages in a row end the list. A direct link to an over-cap
  title opens the not-found page instead of a 500 page.
- The list filters fetch only the rating data (`/movie/{id}/release_dates`,
  `/tv/{id}/content_ratings`), not the full details. They keep only the DE
  entry, in a separate cache tier "The Movie Database API (Age Ratings)" (7
  days, 5000 keys). The median full detail is 128 KB of JSON for a movie and
  280 KB for a TV show. The rating data is 6.6 KB and 0.4 KB. Before, one
  person page put 259 full details into the shared TMDB tier (1000 keys) and
  pushed out other entries. To show a title that got its rating late, flush
  the tier in Settings, Jobs & Cache.
- Each title still needs one TMDB request when it is not in the cache. A cold
  person page with 258 titles takes about 5 s, because the client sends at
  most 50 requests per second.
