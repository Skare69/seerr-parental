import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { AxiosInstance } from 'axios';

import RadarrAPI from '@server/api/servarr/radarr';
import WhisparrAPI, { createMovieClient } from '@server/api/servarr/whisparr';
import type { RadarrSettings } from '@server/lib/settings';

function buildWhisparr(): WhisparrAPI {
  return new WhisparrAPI({
    url: 'http://localhost:6969/api/v3',
    apiKey: 'test',
  });
}

function getAxios(api: RadarrAPI): AxiosInstance {
  // Same protected-member reach as radarr.test.ts: no runtime shape to validate.
  const internals = api as unknown as { axios: AxiosInstance };

  return internals.axios;
}

function buildServer(overrides: Partial<RadarrSettings> = {}): RadarrSettings {
  return {
    id: 0,
    name: 'Whisparr',
    hostname: 'localhost',
    port: 6969,
    apiKey: 'test',
    useSsl: false,
    activeProfileId: 1,
    activeProfileName: 'HD',
    activeDirectory: '/movies',
    tags: [],
    is4k: false,
    isDefault: true,
    syncEnabled: false,
    preventSearch: false,
    tagRequests: false,
    overrideRule: [],
    minimumAvailability: 'released',
    ...overrides,
  };
}

describe('WhisparrAPI getMovieByTmdbId', () => {
  afterEach(() => mock.restoreAll());

  it('looks up the movie on the dedicated TMDB route', async () => {
    const whisparr = buildWhisparr();
    const get = mock.method(getAxios(whisparr), 'get', async () => ({
      data: { id: 7, title: 'Test Movie' },
    }));

    const movie = await whisparr.getMovieByTmdbId(550);

    assert.strictEqual(movie.id, 7);
    assert.strictEqual(get.mock.calls[0].arguments[0], '/movie/lookup/tmdb');
    assert.deepStrictEqual(get.mock.calls[0].arguments[1], {
      params: { tmdbId: 550 },
    });
  });

  it('throws when Whisparr does not know the TMDB id', async () => {
    const whisparr = buildWhisparr();
    mock.method(getAxios(whisparr), 'get', async () => ({ data: null }));

    await assert.rejects(
      () => whisparr.getMovieByTmdbId(550),
      /Movie not found/
    );
  });

  it('is used by the inherited Radarr code paths', async () => {
    const whisparr = buildWhisparr();
    const get = mock.method(getAxios(whisparr), 'get', async () => ({
      data: { id: 9, title: 'Test Movie' },
    }));
    const del = mock.method(getAxios(whisparr), 'delete', async () => ({}));

    await whisparr.removeMovie(550);

    assert.strictEqual(get.mock.calls[0].arguments[0], '/movie/lookup/tmdb');
    assert.strictEqual(del.mock.calls[0].arguments[0], '/movie/9');
  });
});

describe('createMovieClient', () => {
  it('returns a Whisparr client only for Whisparr servers', () => {
    assert.ok(
      createMovieClient(buildServer({ isWhisparr: true })) instanceof
        WhisparrAPI
    );

    const radarr = createMovieClient(buildServer());
    assert.ok(radarr instanceof RadarrAPI);
    assert.ok(!(radarr instanceof WhisparrAPI));
  });
});
