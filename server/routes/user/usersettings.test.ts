import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getBlockedGenres } from '@server/lib/parentalRatings';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import userRoutes from '.';

const defaultAuthenticateResponse = {
  User: {
    Id: 'jf-link-user-001',
    Name: 'linkeduser',
    ServerId: 'server-1',
    Policy: { IsAdministrator: false },
  },
  AccessToken: 'fake-qc-access-token',
};

const authenticateQCMock = mock.method(
  JellyfinAPI.prototype,
  'authenticateQuickConnect',
  async () => ({ ...defaultAuthenticateResponse })
);

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
  app.use('/user', isAuthenticated(), userRoutes);
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

function configureJellyfin() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.JELLYFIN;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.port = 8096;
  settings.jellyfin.useSsl = false;
  settings.jellyfin.urlBase = '';
}

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  settings.main.localLogin = true;

  const agent = request.agent(app);
  const res = await agent.post('/auth/local').send({ email, password });

  assert.strictEqual(res.status, 200);
  return { agent, userId: res.body.id as number };
}

describe('POST /user/:id/settings/linked-accounts/jellyfin/quickconnect', () => {
  beforeEach(() => {
    authenticateQCMock.mock.resetCalls();
    authenticateQCMock.mock.mockImplementation(async () => ({
      ...defaultAuthenticateResponse,
    }));
    configureJellyfin();
  });

  it('links the account when the media server is Jellyfin', async () => {
    const { agent, userId } = await loginAs('friend@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 204);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 1);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, 'jf-link-user-001');
    assert.strictEqual(user.userType, UserType.JELLYFIN);
  });

  it('returns 403 when the media server is Emby', async () => {
    const { agent, userId } = await loginAs('friend@seerr.dev', 'test1234');
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, null);
  });
});

describe('POST /user/:id/settings/parental', () => {
  it('lets an admin set a fixed rating on their own account', async () => {
    const { agent, userId } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ maxParentalRating: 12, dateOfBirth: null });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.maxParentalRating, 12);
    assert.strictEqual(res.body.effectiveMaxRating, 12);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.maxParentalRating, 12);
    assert.strictEqual(user.dateOfBirth, null);
  });

  it('lets a date of birth replace a fixed rating', async () => {
    const { agent, userId } = await loginAs('admin@seerr.dev', 'test1234');
    const repo = getRepository(User);

    await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ maxParentalRating: 18, dateOfBirth: null });

    // Both fields arriving together: the date wins and clears the fixed
    // value, so a user is never governed by two competing limits.
    const res = await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ maxParentalRating: 18, dateOfBirth: '2019-04-01' });

    assert.strictEqual(res.status, 200);
    const user = await repo.findOneOrFail({ where: { id: userId } });
    assert.strictEqual(user.dateOfBirth, '2019-04-01');
    assert.strictEqual(user.maxParentalRating, null);
  });

  it('clears both limits when neither is supplied', async () => {
    const { agent, userId } = await loginAs('admin@seerr.dev', 'test1234');
    const repo = getRepository(User);

    await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ dateOfBirth: '2019-04-01' });

    const res = await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ maxParentalRating: null, dateOfBirth: null });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.effectiveMaxRating, null);
    const user = await repo.findOneOrFail({ where: { id: userId } });
    assert.strictEqual(user.maxParentalRating, null);
    assert.strictEqual(user.dateOfBirth, null);
  });

  it('round-trips blocked genres and clears them with an empty list', async () => {
    const { agent, userId } = await loginAs('admin@seerr.dev', 'test1234');
    const repo = getRepository(User);

    const res = await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ blockedGenres: [10752, 99] });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.blockedGenres, [10752, 99]);

    const saved = await repo.findOneOrFail({ where: { id: userId } });
    assert.deepStrictEqual(getBlockedGenres(saved), [10752, 99]);

    // An empty list must read back as "nothing blocked", not as [''].
    const cleared = await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ blockedGenres: [] });

    assert.deepStrictEqual(cleared.body.blockedGenres, []);
    const after = await repo.findOneOrFail({ where: { id: userId } });
    assert.deepStrictEqual(getBlockedGenres(after), []);
  });

  it('refuses parental changes from a non-admin, including on themselves', async () => {
    const repo = getRepository(User);
    const capped = await repo.findOneOrFail({
      where: { email: 'friend@seerr.dev' },
    });
    capped.maxParentalRating = 6;
    await repo.save(capped);

    const { agent, userId } = await loginAs('friend@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ maxParentalRating: null, dateOfBirth: null });

    assert.strictEqual(res.status, 403);
    const user = await repo.findOneOrFail({ where: { id: userId } });
    assert.strictEqual(user.maxParentalRating, 6);
  });

  it('reports the cap derived from a date of birth', async () => {
    const { agent, userId } = await loginAs('admin@seerr.dev', 'test1234');
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 7);

    const res = await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ dateOfBirth: dob.toISOString().slice(0, 10) });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.effectiveMaxRating, 6);
  });
});
