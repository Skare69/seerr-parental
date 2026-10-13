import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import type {
  TmdbMovieDetails,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import collectionRoutes from '@server/routes/collection';
import discoverRoutes from '@server/routes/discover';
import movieRoutes from '@server/routes/movie';
import personRoutes from '@server/routes/person';
import tvRoutes from '@server/routes/tv';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';

// DE certification per fake title; undefined = unrated (fails closed).
const deMovieCert: Record<number, string | undefined> = {
  101: '16',
  102: '12',
  103: '6',
};
const deTvCert: Record<number, string | undefined> = {
  201: '16',
  202: '12',
  203: undefined,
};

function fakeMovie(id: number): TmdbMovieDetails {
  const deCert = deMovieCert[id];
  return {
    id,
    title: `Movie ${id}`,
    original_title: `Movie ${id}`,
    overview: `Overview ${id}`,
    release_date: '2020-01-01',
    release_dates: {
      results: deCert
        ? [
            {
              iso_3166_1: 'DE',
              release_dates: [{ certification: deCert }],
            },
          ]
        : [],
    },
    genres: [],
    adult: false,
    video: false,
    budget: 0,
    revenue: 0,
    runtime: 90,
    status: 'Released',
    tagline: '',
    homepage: '',
    imdb_id: null,
    original_language: 'en',
    popularity: 1,
    vote_average: 6,
    vote_count: 100,
    production_companies: [],
    production_countries: [],
    spoken_languages: [],
    credits: { cast: [], crew: [] },
    external_ids: {},
    keywords: { keywords: [] },
    videos: { results: [] },
  } as unknown as TmdbMovieDetails;
}

function fakeShow(id: number): TmdbTvDetails {
  const rating = deTvCert[id];
  return {
    id,
    name: `Show ${id}`,
    original_name: `Show ${id}`,
    overview: `Overview ${id}`,
    first_air_date: '2020-01-01',
    genres: [],
    adult: false,
    original_language: 'en',
    popularity: 1,
    vote_average: 6,
    vote_count: 100,
    keywords: { results: [] },
    content_ratings: {
      results: rating ? [{ iso_3166_1: 'DE', rating }] : [],
    },
    external_ids: {},
  } as unknown as TmdbTvDetails;
}

// TMDB genre ids per fake title; 10752 = War (movies), 10768 = War & Politics.
const fakeGenres: Record<number, number[]> = {
  101: [28],
  102: [10752],
  103: [16],
  201: [10768],
  202: [16],
  203: [28],
};

function fakeMovieResult(id: number) {
  return {
    id,
    media_type: 'movie',
    title: `Movie ${id}`,
    original_title: `Movie ${id}`,
    overview: `Overview ${id}`,
    release_date: '2020-01-01',
    genre_ids: fakeGenres[id] ?? [],
    adult: false,
    video: false,
    original_language: 'en',
    popularity: 1,
    vote_average: 6,
    vote_count: 100,
    poster_path: `/poster${id}.jpg`,
    backdrop_path: `/backdrop${id}.jpg`,
  };
}

function fakeTvResult(id: number) {
  return {
    id,
    media_type: 'tv',
    name: `Show ${id}`,
    original_name: `Show ${id}`,
    overview: `Overview ${id}`,
    first_air_date: '2020-01-01',
    origin_country: [],
    genre_ids: fakeGenres[id] ?? [],
    original_language: 'en',
    popularity: 1,
    vote_average: 6,
    vote_count: 100,
    poster_path: `/poster${id}.jpg`,
    backdrop_path: `/tvbackdrop${id}.jpg`,
  };
}

function fakeCredit(id: number, mediaType: 'movie' | 'tv') {
  return {
    id,
    media_type: mediaType,
    character: 'Someone',
    department: 'Writing',
    job: 'Screenplay',
    credit_id: `${id}-credit`,
    original_language: 'en',
    episode_count: 1,
    overview: `Overview ${id}`,
    origin_country: [],
    name: mediaType === 'tv' ? `Show ${id}` : undefined,
    title: mediaType === 'movie' ? `Movie ${id}` : undefined,
    original_name: mediaType === 'tv' ? `Show ${id}` : undefined,
    original_title: mediaType === 'movie' ? `Movie ${id}` : undefined,
    first_air_date: mediaType === 'tv' ? '2020-01-01' : undefined,
    release_date: mediaType === 'movie' ? '2020-01-01' : undefined,
    vote_average: 6,
    vote_count: 100,
    popularity: 1,
    adult: false,
    video: false,
    genre_ids: fakeGenres[id] ?? [],
  };
}

// Mirrors TMDB: /discover/movie honors certification.lte, /discover/tv
// ignores its certification params (Seerr post-filters instead).
const tmdbGetMock = mock.method(
  ExternalAPI.prototype as unknown as {
    get: (
      endpoint: string,
      config?: { params?: Record<string, unknown> }
    ) => Promise<unknown>;
  },
  'get',
  async (endpoint: string, config?: { params?: Record<string, unknown> }) => {
    const params = config?.params ?? {};

    if (
      endpoint === '/certification/movie/list' ||
      endpoint === '/certification/tv/list'
    ) {
      return {
        certifications: {
          DE: ['0', '6', '12', '16', '18'].map((certification, order) => ({
            certification,
            order,
          })),
        },
      };
    }
    if (endpoint === '/genre/movie/list' || endpoint === '/genre/tv/list') {
      return { genres: [{ id: 28, name: 'Action' }] };
    }

    const movieDetail = endpoint.match(/^\/movie\/(\d+)$/);
    if (movieDetail) {
      return fakeMovie(Number(movieDetail[1]));
    }
    const tvDetail = endpoint.match(/^\/tv\/(\d+)$/);
    if (tvDetail) {
      return fakeShow(Number(tvDetail[1]));
    }
    // The list filters' rating-only lookups, shaped like TMDB's responses.
    const releaseDates = endpoint.match(/^\/movie\/(\d+)\/release_dates$/);
    if (releaseDates) {
      const id = Number(releaseDates[1]);
      return { id, ...fakeMovie(id).release_dates };
    }
    const contentRatings = endpoint.match(/^\/tv\/(\d+)\/content_ratings$/);
    if (contentRatings) {
      const id = Number(contentRatings[1]);
      return { id, ...fakeShow(id).content_ratings };
    }
    const studio = endpoint.match(/^\/company\/(\d+)$/);
    if (studio) {
      return {
        id: Number(studio[1]),
        name: 'Studio',
        logo_path: null,
        origin_country: [],
      };
    }
    const network = endpoint.match(/^\/network\/(\d+)$/);
    if (network) {
      return {
        id: Number(network[1]),
        name: 'Network',
        logo_path: null,
        origin_country: [],
      };
    }
    if (endpoint.match(/^\/keyword\/\d+\/movies$/)) {
      return {
        page: 1,
        total_pages: 1,
        total_results: 3,
        results: [101, 102, 103].map(fakeMovieResult),
      };
    }
    if (endpoint === '/discover/movie') {
      let results = [101, 102, 103].map(fakeMovieResult);
      const lte = params['certification.lte'];
      if (typeof lte === 'string') {
        const limit = Number(lte);
        results = results.filter((result) => {
          const cert = deMovieCert[result.id];
          return cert !== undefined && Number(cert) <= limit;
        });
      }
      return {
        page: 1,
        total_pages: 1,
        total_results: results.length,
        results,
      };
    }
    if (endpoint === '/discover/tv') {
      return {
        page: 1,
        total_pages: 1,
        total_results: 3,
        results: [201, 202, 203].map(fakeTvResult),
      };
    }
    if (endpoint.match(/^\/collection\/\d+$/)) {
      return {
        id: 10,
        name: 'Collection',
        overview: 'Collection overview',
        poster_path: null,
        backdrop_path: null,
        parts: [101, 102, 103].map(fakeMovieResult),
      };
    }
    if (endpoint.match(/^\/person\/\d+\/combined_credits$/)) {
      return {
        id: 5,
        cast: [fakeCredit(101, 'movie'), fakeCredit(102, 'movie')],
        crew: [fakeCredit(201, 'tv'), fakeCredit(202, 'tv')],
      };
    }

    throw new Error(`Unstubbed external endpoint: ${endpoint}`);
  }
).mock;

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/movie', isAuthenticated(), movieRoutes);
  app.use('/tv', isAuthenticated(), tvRoutes);
  app.use('/discover', isAuthenticated(), discoverRoutes);
  app.use('/collection', isAuthenticated(), collectionRoutes);
  app.use('/person', isAuthenticated(), personRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

beforeEach(() => {
  tmdbGetMock.resetCalls();
});

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent.post('/auth/local').send({ email, password });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

async function setDemoCap(maxParentalRating: number | null) {
  const userRepository = getRepository(User);
  const demo = await userRepository.findOneOrFail({
    where: { email: 'demo@seerr.dev' },
  });
  demo.maxParentalRating = maxParentalRating;
  await userRepository.save(demo);
}

async function blockDemoGenres(genreIds: number[]) {
  const userRepository = getRepository(User);
  const demo = await userRepository.findOneOrFail({
    where: { email: 'demo@seerr.dev' },
  });
  demo.blockedGenres = genreIds.map(String);
  await userRepository.save(demo);
}

function callsTo(endpoint: string) {
  return tmdbGetMock.calls.filter((call) => call.arguments[0] === endpoint);
}

describe('movie detail parental cap', () => {
  it('returns 403 for a movie over the cap', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/movie/101');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      res.body.message,
      'This title is not available for this user.'
    );
  });

  it('returns 200 for a movie at the cap', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/movie/102');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.title, 'Movie 102');
  });

  it('returns 200 for an over-cap movie to an uncapped user', async () => {
    await setDemoCap(null);
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent.get('/movie/101');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.title, 'Movie 101');
  });
});

describe('tv detail and season parental cap', () => {
  it('returns 403 for a show over the cap', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/tv/201');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      res.body.message,
      'This title is not available for this user.'
    );
  });

  it('returns 403 for the season of a show over the cap', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/tv/201/season/1');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      res.body.message,
      'This title is not available for this user.'
    );
    assert.strictEqual(callsTo('/tv/201/season/1').length, 0);
  });
});

describe('discover movie certification params', () => {
  it('sends the DE cap and drops caller certification params', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .get('/discover/movies')
      .query({ certification: 'R', certificationCountry: 'US' });

    assert.strictEqual(res.status, 200);
    const discover = callsTo('/discover/movie');
    assert.strictEqual(discover.length, 1);
    const sent: Record<string, unknown> =
      discover[0].arguments[1]?.params ?? {};
    assert.strictEqual(sent.certification_country, 'DE');
    assert.strictEqual(sent['certification.lte'], '12');
    assert.ok(!('certification' in sent));
    // The stub honors certification.lte: 101 (16) is hidden, 102/103 stay.
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [102, 103]
    );
  });

  it('keeps a stricter DE certification filter from the caller', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .get('/discover/movies')
      .query({ certificationLte: '6', certificationCountry: 'DE' });

    assert.strictEqual(res.status, 200);
    const discover = callsTo('/discover/movie');
    assert.strictEqual(discover.length, 1);
    const sent: Record<string, unknown> =
      discover[0].arguments[1]?.params ?? {};
    assert.strictEqual(sent.certification_country, 'DE');
    assert.strictEqual(sent['certification.lte'], '6');
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [103]
    );
  });

  it('leaves an uncapped user certification params untouched', async () => {
    await setDemoCap(null);
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .get('/discover/movies')
      .query({ certification: 'R', certificationCountry: 'US' });

    assert.strictEqual(res.status, 200);
    const discover = callsTo('/discover/movie');
    assert.strictEqual(discover.length, 1);
    const sent: Record<string, unknown> =
      discover[0].arguments[1]?.params ?? {};
    assert.strictEqual(sent.certification, 'R');
    assert.strictEqual(sent.certification_country, 'US');
    // undefined params are dropped before the request leaves the client.
    assert.strictEqual(sent['certification.lte'], undefined);
    assert.strictEqual(callsTo('/certification/movie/list').length, 0);
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [101, 102, 103]
    );
  });
});

describe('discover tv parental cap', () => {
  it('drops over-cap and unrated shows', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/discover/tv');

    assert.strictEqual(res.status, 200);
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [202]
    );
  });
});

describe('studio, network and keyword lists', () => {
  it('hides over-cap movies from the studio list', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/discover/movies/studio/420');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.studio.id, 420);
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [102, 103]
    );
    const discover = callsTo('/discover/movie');
    assert.strictEqual(discover.length, 1);
    const sent: Record<string, unknown> =
      discover[0].arguments[1]?.params ?? {};
    assert.strictEqual(sent.certification_country, 'DE');
    assert.strictEqual(sent['certification.lte'], '12');
  });

  it('sends the studio discover params a plain client sends when uncapped', async () => {
    await setDemoCap(null);
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    await agent.get('/discover/movies/studio/420');

    const discover = callsTo('/discover/movie');
    assert.strictEqual(discover.length, 1);
    const sent: Record<string, unknown> =
      discover[0].arguments[1]?.params ?? {};
    assert.strictEqual(sent.region, '');
    assert.strictEqual(sent.with_original_language, undefined);
  });

  it('excludes blocked genres from the studio list', async () => {
    await blockDemoGenres([10752]);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/discover/movies/studio/420');

    assert.strictEqual(res.status, 200);
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [101, 103]
    );
    const sent: Record<string, unknown> =
      callsTo('/discover/movie')[0].arguments[1]?.params ?? {};
    assert.strictEqual(sent.without_genres, '10752');
  });

  it('hides over-cap shows from the network list', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/discover/tv/network/332');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.network.id, 332);
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [202]
    );
  });

  it('hides over-cap movies from the keyword list', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/discover/keyword/77/movies');

    assert.strictEqual(res.status, 200);
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [102, 103]
    );
  });

  it('leaves the keyword list untouched for an uncapped user', async () => {
    await setDemoCap(null);
    const agent = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent.get('/discover/keyword/77/movies');

    assert.strictEqual(res.status, 200);
    assert.deepEqual(
      res.body.results.map((r: { id: number }) => r.id),
      [101, 102, 103]
    );
  });
});

describe('genre slider backdrops', () => {
  it('takes movie backdrops from cap-respecting titles', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/discover/genreslider/movie');

    assert.strictEqual(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.deepEqual(res.body[0].backdrops, [
      '/backdrop102.jpg',
      '/backdrop103.jpg',
    ]);
  });

  it('takes tv backdrops from cap-respecting titles', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/discover/genreslider/tv');

    assert.strictEqual(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.deepEqual(res.body[0].backdrops, ['/tvbackdrop202.jpg']);
  });
});

describe('collection parts parental cap', () => {
  it('hides over-cap collection parts', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/collection/10');

    assert.strictEqual(res.status, 200);
    assert.deepEqual(
      res.body.parts.map((r: { id: number }) => r.id),
      [102, 103]
    );
  });
});

describe('person combined credits parental cap', () => {
  it('hides over-cap cast and crew credits', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/person/5/combined_credits');

    assert.strictEqual(res.status, 200);
    assert.deepEqual(
      res.body.cast.map((c: { id: number }) => c.id),
      [102]
    );
    assert.deepEqual(
      res.body.crew.map((c: { id: number }) => c.id),
      [202]
    );
    // List filtering fetches only rating data, never full title details.
    assert.deepEqual(
      tmdbGetMock.calls
        .map((call) => call.arguments[0])
        .filter((endpoint) => /^\/(movie|tv)\/\d+$/.test(endpoint)),
      []
    );
  });

  it('hides credits in a blocked genre without a rating lookup', async () => {
    await blockDemoGenres([10752]);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/person/5/combined_credits');

    assert.strictEqual(res.status, 200);
    assert.deepEqual(
      res.body.cast.map((c: { id: number }) => c.id),
      [101]
    );
    // 10768 (War & Politics) is a different genre from 10752 (War).
    assert.deepEqual(
      res.body.crew.map((c: { id: number }) => c.id),
      [201, 202]
    );
    assert.deepEqual(
      tmdbGetMock.calls
        .map((call) => call.arguments[0])
        .filter((endpoint) => /release_dates|content_ratings/.test(endpoint)),
      []
    );
  });
});

describe('ratings routes parental cap', () => {
  it('returns 403 for movie ratings over the cap', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/movie/101/ratings');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      res.body.message,
      'This title is not available for this user.'
    );
  });

  it('returns 403 for combined movie ratings over the cap', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/movie/101/ratingscombined');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      res.body.message,
      'This title is not available for this user.'
    );
  });

  it('returns 403 for tv ratings over the cap', async () => {
    await setDemoCap(12);
    const agent = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get('/tv/201/ratings');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(
      res.body.message,
      'This title is not available for this user.'
    );
  });
});
