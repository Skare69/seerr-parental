import type { TmdbCertificationResponse } from '@server/api/themoviedb';
import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieDetails,
  TmdbMovieReleaseResult,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import type { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import {
  capToCertification,
  extractCertNumber,
  filterRestrictedResults,
  getBlockedGenres,
  getEffectiveMaxRating,
  isOverCap,
  isTitleBlocked,
  titleCertNumber,
} from '@server/lib/parentalRatings';
import type { AxiosInstance } from 'axios';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

// Fix both the zone and the clock before any Date call. Restored per test.
process.env.TZ = 'America/Los_Angeles';

// LA local time <-> UTC is -7h on these dates (PDT).
const LA = (y: number, mo: number, d: number, h: number, min: number): Date =>
  new Date(Date.UTC(y, mo - 1, d, h + 7, min));

const fakeUser = (fields: Partial<User>): User => fields as User;

afterEach(() => {
  mock.timers.reset();
});

describe('getEffectiveMaxRating', () => {
  it('derives the cap from date of birth against the local date', () => {
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 10, 13, 0, 30) });

    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 1, dateOfBirth: '2014-10-13' })),
      12
    );
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 1, dateOfBirth: '2014-10-14' })),
      6
    );
  });

  it('uses the explicit rating when no date of birth is set', () => {
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 2, maxParentalRating: 12 })),
      12
    );
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 2, maxParentalRating: 0 })),
      0
    );
  });

  it('lets the date of birth win over a stale explicit rating', () => {
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 10, 13, 0, 30) });

    assert.equal(
      getEffectiveMaxRating(
        fakeUser({ id: 3, dateOfBirth: '2020-10-13', maxParentalRating: 16 })
      ),
      6
    );
  });

  it('treats a stored fixed cap of 18 or more as unrestricted', () => {
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 4, maxParentalRating: 18 })),
      null
    );
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 4, maxParentalRating: 99 })),
      null
    );
  });

  it('reflects a changed cap immediately (no memo)', () => {
    const user = fakeUser({ id: 5, dateOfBirth: '2020-10-13' });
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 10, 13, 0, 30) });
    assert.equal(getEffectiveMaxRating(user), 6);

    user.dateOfBirth = '2010-10-13';
    assert.equal(getEffectiveMaxRating(user), 16);
  });

  it('returns null (unrestricted) when nothing is set', () => {
    assert.equal(getEffectiveMaxRating(fakeUser({ id: 6 })), null);
    assert.equal(getEffectiveMaxRating(undefined), null);
  });
});

describe('isTitleBlocked age cap', () => {
  it('blocks over-cap and unrated titles, not at-cap ones', () => {
    const movie12 = {
      release_dates: {
        results: [
          {
            iso_3166_1: 'DE',
            release_dates: [{ certification: '12' }],
          },
        ],
      },
    } as unknown as TmdbMovieDetails;
    const capped = fakeUser({ id: 7, maxParentalRating: 12 });
    assert.equal(isTitleBlocked(capped, 'movie', movie12), false);

    const unrated = {
      release_dates: { results: [] },
    } as unknown as TmdbMovieDetails;
    assert.equal(isTitleBlocked(capped, 'movie', unrated), true);
  });
});

describe('extractCertNumber', () => {
  it('takes the max DE certification from movie release_dates', () => {
    const details = {
      release_dates: {
        results: [
          { iso_3166_1: 'US', release_dates: [{ certification: 'R' }] },
          {
            iso_3166_1: 'DE',
            release_dates: [
              { certification: '12' },
              { certification: '6' },
              { certification: '' },
            ],
          },
        ],
      },
    } as unknown as TmdbMovieDetails;
    assert.equal(extractCertNumber('movie', details), 12);
  });

  it('parses TV content_ratings', () => {
    const details = {
      content_ratings: {
        results: [
          { iso_3166_1: 'US', rating: 'TV-MA' },
          { iso_3166_1: 'DE', rating: 'FSK 16' },
        ],
      },
    } as unknown as TmdbTvDetails;
    assert.equal(extractCertNumber('tv', details), 16);
  });

  it('returns null when the country or rating is unknown', () => {
    const tv = {
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    } as unknown as TmdbTvDetails;
    assert.equal(extractCertNumber('tv', tv), null);
  });
});

describe('isOverCap', () => {
  it('fails closed on unknown and allows the boundary', () => {
    assert.equal(isOverCap(null, 12), true);
    assert.equal(isOverCap(16, 12), true);
    assert.equal(isOverCap(12, 12), false);
    assert.equal(isOverCap(0, 6), false);
  });
});

describe('getBlockedGenres', () => {
  it('parses stored ids and survives the empty simple-array round trip', () => {
    assert.deepEqual(
      getBlockedGenres(fakeUser({ blockedGenres: ['10752', '99'] })),
      [10752, 99]
    );
    // TypeORM hands back [''] for a column that was saved empty.
    assert.deepEqual(getBlockedGenres(fakeUser({ blockedGenres: [''] })), []);
    assert.deepEqual(getBlockedGenres(fakeUser({})), []);
    assert.deepEqual(getBlockedGenres(undefined), []);
  });
});

describe('isTitleBlocked', () => {
  // FSK 0 war documentary: allowed by every age cap, blocked by genre.
  const warDoc = {
    genres: [
      { id: 99, name: 'Documentary' },
      { id: 10752, name: 'War' },
    ],
    release_dates: {
      results: [{ iso_3166_1: 'DE', release_dates: [{ certification: '0' }] }],
    },
  } as unknown as TmdbMovieDetails;

  it('blocks a blocked genre regardless of the age rating', () => {
    const user = fakeUser({ blockedGenres: ['10752'], dateOfBirth: null });
    assert.equal(getEffectiveMaxRating(user), null);
    assert.equal(isTitleBlocked(user, 'movie', warDoc), true);
  });

  it('lets the same title through for a user without that genre blocked', () => {
    const user = fakeUser({ blockedGenres: ['878'], maxParentalRating: 6 });
    assert.equal(isTitleBlocked(user, 'movie', warDoc), false);
  });

  it('still enforces the age cap when no genre matches', () => {
    const adult = {
      genres: [{ id: 27, name: 'Horror' }],
      release_dates: {
        results: [
          { iso_3166_1: 'DE', release_dates: [{ certification: '18' }] },
        ],
      },
    } as unknown as TmdbMovieDetails;
    const user = fakeUser({ blockedGenres: ['10752'], maxParentalRating: 12 });
    assert.equal(isTitleBlocked(user, 'movie', adult), true);
  });

  it('allows everything for an unrestricted user', () => {
    assert.equal(isTitleBlocked(fakeUser({}), 'movie', warDoc), false);
    assert.equal(isTitleBlocked(undefined, 'movie', warDoc), false);
  });

  it('hides an untagged title, but only while a genre is blocked', () => {
    const untagged = {
      genres: [],
      release_dates: {
        results: [
          { iso_3166_1: 'DE', release_dates: [{ certification: '0' }] },
        ],
      },
    } as unknown as TmdbMovieDetails;

    // FSK 0 and no genre match, so only the untagged rule can bar it.
    assert.equal(
      isTitleBlocked(fakeUser({ blockedGenres: ['10752'] }), 'movie', untagged),
      true
    );
    // A missing genres key is the same unknown as an empty one.
    assert.equal(
      isTitleBlocked(
        fakeUser({ blockedGenres: ['10752'] }),
        'movie',
        {} as TmdbMovieDetails
      ),
      true
    );
    // This parent blocked no genre, so nothing is left unchecked.
    assert.equal(
      isTitleBlocked(fakeUser({ maxParentalRating: 6 }), 'movie', untagged),
      false
    );
  });
});

describe('filterRestrictedResults', () => {
  // What the rating lookups return: only the PARENTAL_COUNTRY entry.
  const ratedAt12 = {
    results: [{ iso_3166_1: 'DE', release_dates: [{ certification: '12' }] }],
  } as unknown as TmdbMovieReleaseResult;

  // Every stub throws on endpoints the code must not call, so a missing stub
  // can never look like a correct fail-closed result. The full details
  // lookups throw too: list filtering must fetch only the rating data.
  const stubTmdb = (impl: Partial<TheMovieDb>): TheMovieDb => {
    const thrower = () => {
      throw new Error('unexpected TMDB endpoint call');
    };
    return Object.assign(
      {
        getMovie: thrower,
        getTvShow: thrower,
        getParentalReleaseDates: thrower,
        getParentalContentRatings: thrower,
      },
      impl
    ) as unknown as TheMovieDb;
  };

  it('drops blocked genres without a rating lookup', async () => {
    let calls = 0;
    const countedLookup = async () => {
      calls++;
      return { results: [] };
    };
    const tmdb = stubTmdb({
      getParentalReleaseDates: countedLookup,
      getParentalContentRatings: countedLookup,
    });

    const results = [
      { id: 1, mediaType: 'movie', genreIds: [99, 10752] },
      { id: 2, mediaType: 'tv', genreIds: [10768] },
      { id: 3, mediaType: 'movie', genreIds: [16] },
      { id: 4, mediaType: 'person' },
    ];

    const kept = await filterRestrictedResults(
      fakeUser({ blockedGenres: ['10752', '10768'] }),
      tmdb,
      results
    );

    assert.deepEqual(
      kept.map((r) => r.id),
      [3, 4]
    );
    // No age cap set, so nothing should have triggered a rating lookup.
    assert.equal(calls, 0);
  });

  it('drops untagged results, leaving persons and collections alone', async () => {
    const tmdb = stubTmdb({});
    const results = [
      { id: 1, mediaType: 'movie', genreIds: [] },
      { id: 2, mediaType: 'tv' },
      { id: 3, mediaType: 'movie', genreIds: [16] },
      { id: 4, mediaType: 'person' },
      { id: 5, mediaType: 'collection' },
    ];

    const restricted = await filterRestrictedResults(
      fakeUser({ blockedGenres: ['10752'] }),
      tmdb,
      results
    );
    assert.deepEqual(
      restricted.map((r) => r.id),
      [3, 4, 5]
    );

    const unrestricted = await filterRestrictedResults(
      fakeUser({}),
      tmdb,
      results
    );
    assert.deepEqual(
      unrestricted.map((r) => r.id),
      [1, 2, 3, 4, 5]
    );
  });

  it('drops over-cap titles, unrated titles and failed lookups', async () => {
    const capped = fakeUser({ id: 8, maxParentalRating: 12 });
    const tmdb = stubTmdb({
      getParentalReleaseDates: async (movieId: number) =>
        // id 2: no DE rating (null cert) -> dropped by fail-closed
        movieId === 1 ? ratedAt12 : { results: [] },
      getParentalContentRatings: async () => {
        throw new Error('lookup failed');
      },
    });

    const results = [
      { id: 1, mediaType: 'movie' },
      { id: 2, mediaType: 'movie' },
      { id: 3, mediaType: 'tv' },
      { id: 4, mediaType: 'person' },
    ];
    const kept = await filterRestrictedResults(capped, tmdb, results);
    assert.deepEqual(kept, [
      { id: 1, mediaType: 'movie' },
      { id: 4, mediaType: 'person' },
    ]);
  });

  it('returns the input unchanged for an unrestricted user without lookups', async () => {
    const tmdb = stubTmdb({});
    const results = [
      { id: 1, mediaType: 'movie' },
      { id: 2, mediaType: 'tv' },
    ];
    const kept = await filterRestrictedResults(undefined, tmdb, results);
    assert.equal(kept, results);
  });
});

describe('titleCertNumber', () => {
  // Exposes the protected HTTP client, so tests stub it without a cast.
  class TestTheMovieDb extends TheMovieDb {
    public get http(): AxiosInstance {
      return this.axios;
    }
  }

  afterEach(() => {
    cacheManager.getCache('tmdbratings').flush();
  });

  it('fetches only the rating data and caches just the DE entry', async () => {
    const movieDe = {
      iso_3166_1: 'DE',
      release_dates: [{ certification: '12' }],
    };
    const tvDe = { iso_3166_1: 'DE', rating: '16' };
    const responses: Record<string, unknown> = {
      '/movie/7/release_dates': {
        id: 7,
        results: [
          { iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] },
          movieDe,
        ],
      },
      '/tv/9/content_ratings': {
        id: 9,
        results: [{ iso_3166_1: 'US', rating: 'TV-MA' }, tvDe],
      },
    };
    const tmdb = new TestTheMovieDb();
    const get = mock.method(tmdb.http, 'get', async (url: string) => ({
      data: responses[url],
    }));

    assert.equal(await titleCertNumber(tmdb, 'movie', 7), 12);
    assert.equal(await titleCertNumber(tmdb, 'tv', 9), 16);
    assert.deepEqual(
      get.mock.calls.map((call) => call.arguments[0]),
      ['/movie/7/release_dates', '/tv/9/content_ratings']
    );
    // Its own tier, so rating lookups never evict the shared TMDB entries.
    assert.equal(cacheManager.getCache('tmdbratings').getStats().keys, 2);

    // Every request builds its own client. A fresh one reads the shared cache
    // (the test setup refuses real network calls), which holds only DE.
    const fresh = new TheMovieDb();
    assert.deepEqual(await fresh.getParentalReleaseDates(7), {
      id: 7,
      results: [movieDe],
    });
    assert.deepEqual(await fresh.getParentalContentRatings(9), {
      id: 9,
      results: [tvDe],
    });
  });
});

describe('capToCertification', () => {
  const liveShapedList = {
    certifications: {
      DE: [
        { certification: '12', order: 3 },
        { certification: '18', order: 5 },
        { certification: '0', order: 1 },
        { certification: '6', order: 2 },
        { certification: '16', order: 4 },
      ],
    },
  } as unknown as TmdbCertificationResponse;

  const fakeTmdb = (list: TmdbCertificationResponse) =>
    ({
      getMovieCertifications: async () => list,
      getTvCertifications: async () => list,
    }) as unknown as TheMovieDb;

  it('resolves the exact TMDB cert string for the cap', async () => {
    const tmdb = fakeTmdb(liveShapedList);
    assert.equal(await capToCertification(tmdb, 'movie', 12), '12');
    assert.equal(await capToCertification(tmdb, 'movie', 0), '0');
  });

  it('rejects when no certification covers the cap', async () => {
    const empty = {
      certifications: { DE: [] },
    } as unknown as TmdbCertificationResponse;
    await assert.rejects(capToCertification(fakeTmdb(empty), 'tv', 12));
  });

  it('retries after a rejected lookup instead of caching the failure', async () => {
    const failing = {
      getMovieCertifications: async () => {
        throw new Error('TMDB down');
      },
      getTvCertifications: async () => {
        throw new Error('TMDB down');
      },
    } as unknown as TheMovieDb;
    await assert.rejects(capToCertification(failing, 'tv', 16));

    assert.equal(
      await capToCertification(fakeTmdb(liveShapedList), 'tv', 16),
      '16'
    );
  });
});
