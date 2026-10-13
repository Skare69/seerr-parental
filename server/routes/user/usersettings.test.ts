import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getBlockedGenres } from '@server/lib/parentalRatings';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import gravatarUrl from 'gravatar-url';
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

async function setUserPermissions(email: string, permissions: number) {
  const repo = getRepository(User);
  const user = await repo.findOneOrFail({ where: { email } });
  user.permissions = permissions;
  await repo.save(user);
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
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

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
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
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
      .send({ maxParentalRating: 16, dateOfBirth: '2019-04-01' });

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
      where: { email: 'demo@seerr.dev' },
    });
    capped.maxParentalRating = 6;
    await repo.save(capped);

    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

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

  it('refuses a MANAGE_USERS non-admin lifting their own cap', async () => {
    const repo = getRepository(User);
    await setUserPermissions('demo@seerr.dev', Permission.MANAGE_USERS);
    const demo = await repo.findOneOrFail({
      where: { email: 'demo@seerr.dev' },
    });
    demo.maxParentalRating = 6;
    await repo.save(demo);

    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/parental`)
      .send({ maxParentalRating: null, dateOfBirth: null });

    assert.strictEqual(res.status, 403);
    const user = await repo.findOneOrFail({ where: { id: userId } });
    assert.strictEqual(user.maxParentalRating, 6);
    assert.strictEqual(user.dateOfBirth, null);
  });

  it('refuses a MANAGE_USERS non-admin editing the owner', async () => {
    const repo = getRepository(User);
    await setUserPermissions('demo@seerr.dev', Permission.MANAGE_USERS);
    const { agent } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post('/user/1/settings/parental')
      .send({ maxParentalRating: 0, dateOfBirth: null });

    assert.strictEqual(res.status, 403);
    const owner = await repo.findOneOrFail({ where: { id: 1 } });
    assert.strictEqual(owner.maxParentalRating, null);
  });

  it('refuses a MANAGE_USERS non-admin reading or editing another admin', async () => {
    const repo = getRepository(User);
    const secondAdmin = new User();
    secondAdmin.email = 'second-admin@seerr.dev';
    secondAdmin.username = 'secondadmin';
    secondAdmin.plexId = 1;
    secondAdmin.plexToken = '1234';
    secondAdmin.plexUsername = 'secondadmin';
    secondAdmin.userType = UserType.PLEX;
    secondAdmin.permissions = Permission.ADMIN;
    secondAdmin.avatar = gravatarUrl('second-admin@seerr.dev', {
      default: 'mm',
      size: 200,
    });
    await repo.save(secondAdmin);

    await setUserPermissions('demo@seerr.dev', Permission.MANAGE_USERS);
    const { agent } = await loginAs('demo@seerr.dev', 'test1234');

    const post = await agent
      .post(`/user/${secondAdmin.id}/settings/parental`)
      .send({ maxParentalRating: 0, dateOfBirth: null });
    const get = await agent.get(`/user/${secondAdmin.id}/settings/parental`);

    assert.strictEqual(post.status, 403);
    assert.strictEqual(get.status, 403);
    const stored = await repo.findOneOrFail({
      where: { id: secondAdmin.id },
    });
    assert.strictEqual(stored.maxParentalRating, null);
  });

  it('rejects an impossible, future, or pre-1900 date of birth', async () => {
    const repo = getRepository(User);
    const { agent, userId } = await loginAs('admin@seerr.dev', 'test1234');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(
      tomorrow.getMonth() + 1
    ).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    for (const dateOfBirth of ['2019-02-31', tomorrowStr, '1899-12-31']) {
      const res = await agent
        .post(`/user/${userId}/settings/parental`)
        .send({ maxParentalRating: null, dateOfBirth });

      assert.strictEqual(res.status, 400, `date ${dateOfBirth} was accepted`);
    }

    const user = await repo.findOneOrFail({ where: { id: userId } });
    assert.strictEqual(user.dateOfBirth, null);
    assert.strictEqual(user.maxParentalRating, null);
  });
});

describe('GET /user/:id/settings/parental', () => {
  it('refuses a user without the MANAGE_USERS permission', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent.get(`/user/${userId}/settings/parental`);

    assert.strictEqual(res.status, 403);
  });

  it('returns 404 for an unknown user', async () => {
    const { agent } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent.get('/user/99999/settings/parental');

    assert.strictEqual(res.status, 404);
  });

  it('lets the owner view their own limits', async () => {
    const { agent, userId } = await loginAs('admin@seerr.dev', 'test1234');

    const res = await agent.get(`/user/${userId}/settings/parental`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.effectiveMaxRating, null);
  });
});
