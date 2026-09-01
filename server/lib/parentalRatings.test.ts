import type TheMovieDb from '@server/api/themoviedb';
import type { TmdbCertificationResponse } from '@server/api/themoviedb';
import type {
  TmdbMovieDetails,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import type { User } from '@server/entity/User';
import {
  capToCertification,
  extractCertNumber,
  filterRestrictedResults,
  fskFromAge,
  getBlockedGenres,
  getEffectiveMaxRating,
  isOverCap,
  isTitleBlocked,
} from '@server/lib/parentalRatings';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const dobForAge = (age: number): string => {
  const now = new Date();
  return new Date(now.getFullYear() - age, now.getMonth(), now.getDate())
    .toISOString()
    .slice(0, 10);
};

const fakeUser = (fields: Partial<User>): User => fields as User;

describe('fskFromAge', () => {
  it('maps age to FSK tiers', () => {
    assert.equal(fskFromAge(4), 0);
    assert.equal(fskFromAge(6), 6);
    assert.equal(fskFromAge(13), 12);
    assert.equal(fskFromAge(17), 16);
    assert.equal(fskFromAge(18), 18);
    assert.equal(fskFromAge(40), 18);
  });
});

describe('getEffectiveMaxRating', () => {
  it('derives the cap from date of birth', () => {
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 901, dateOfBirth: dobForAge(13) })),
      12
    );
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 902, dateOfBirth: dobForAge(4) })),
      0
    );
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 903, dateOfBirth: dobForAge(19) })),
      18
    );
  });

  it('uses the explicit rating when no date of birth is set', () => {
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 904, maxParentalRating: 12 })),
      12
    );
  });

  it('lets the date of birth win over a stale explicit rating', () => {
    // The two are mutually exclusive on write; if a legacy row carries both,
    // the date of birth is authoritative because it ages up on its own.
    assert.equal(
      getEffectiveMaxRating(
        fakeUser({
          id: 905,
          dateOfBirth: dobForAge(30),
          maxParentalRating: 12,
        })
      ),
      18
    );
    assert.equal(
      getEffectiveMaxRating(
        fakeUser({ id: 906, dateOfBirth: dobForAge(7), maxParentalRating: 18 })
      ),
      6
    );
  });

  it('reflects a changed cap immediately, not after UTC midnight', () => {
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 908, maxParentalRating: 12 })),
      12
    );
    // Same user, admin raises the cap: the daily memo must not mask it.
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 908, maxParentalRating: 18 })),
      18
    );
    // ...and switching that user to a date of birth takes effect at once.
    assert.equal(
      getEffectiveMaxRating(fakeUser({ id: 908, dateOfBirth: dobForAge(7) })),
      6
    );
  });

  it('returns null (unrestricted) when nothing is set', () => {
    assert.equal(getEffectiveMaxRating(fakeUser({ id: 907 })), null);
    assert.equal(getEffectiveMaxRating(undefined), null);
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
  it('drops blocked genres without asking TMDB for details', async () => {
    let calls = 0;
    const tmdb = {
      getMovie: async () => {
        calls++;
        return {} as TmdbMovieDetails;
      },
      getTvShow: async () => {
        calls++;
        return {} as TmdbTvDetails;
      },
    } as unknown as TheMovieDb;

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
    // No age cap set, so nothing should have triggered a certification lookup.
    assert.equal(calls, 0);
  });

  it('drops untagged results, leaving persons and collections alone', async () => {
    const tmdb = {} as unknown as TheMovieDb;
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
});
