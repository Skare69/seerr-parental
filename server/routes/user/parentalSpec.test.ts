import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import request from 'supertest';

/**
 * The user-settings route tests mount the router without the OpenAPI
 * validator, so a body can be accepted there and still be rejected in
 * production. That gap shipped a bug once: `maxParentalRating` was declared
 * `nullable: true` with `enum: [0, 6, 12, 16, 18]`, and because `nullable`
 * widens the type without exempting the value from `enum`, submitting
 * "Unrestricted" (null) failed validation and the form refused to save.
 *
 * These tests run the real spec against a stub handler.
 */
const API_SPEC_PATH = path.join(process.cwd(), 'seerr-api.yml');
const ENDPOINT = '/api/v1/user/4/settings/parental';

function specApp() {
  const app = express();
  app.use(express.json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec: API_SPEC_PATH,
      validateRequests: true,
      validateResponses: false,
      // The spec declares global auth; this app only exercises schemas.
      validateSecurity: false,
    })
  );
  app.post('/api/v1/user/:userId/settings/parental', (req, res) => {
    res.status(200).json(req.body);
  });
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res.status(err.status ?? 500).json({ message: err.message });
    }
  );
  return app;
}

describe('parental limits spec', () => {
  const app = specApp();

  it('accepts null as "unrestricted"', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send({ maxParentalRating: null, dateOfBirth: null });

    assert.strictEqual(res.status, 200);
  });

  it('accepts every offered FSK tier', async () => {
    for (const rating of [0, 6, 12, 16, 18]) {
      const res = await request(app)
        .post(ENDPOINT)
        .send({ maxParentalRating: rating, dateOfBirth: null });

      assert.strictEqual(res.status, 200, `FSK ${rating} was rejected`);
    }
  });

  it('rejects a rating outside the offered tiers', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send({ maxParentalRating: 13, dateOfBirth: null });

    assert.strictEqual(res.status, 400);
  });

  it('accepts an ISO date of birth and rejects a malformed one', async () => {
    const ok = await request(app)
      .post(ENDPOINT)
      .send({ maxParentalRating: null, dateOfBirth: '2019-10-01' });
    assert.strictEqual(ok.status, 200);

    const bad = await request(app)
      .post(ENDPOINT)
      .send({ maxParentalRating: null, dateOfBirth: '01.10.2019' });
    assert.strictEqual(bad.status, 400);
  });
});
