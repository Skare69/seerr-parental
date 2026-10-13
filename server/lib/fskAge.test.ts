import {
  ageFromDob,
  fskFromAge,
  fskFromDob,
  isValidDob,
} from '@server/lib/fskAge';
import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

// Fix both the zone and the clock before any Date call. Restored per test.
process.env.TZ = 'America/Los_Angeles';

// LA local time <-> UTC is -7h on these dates (PDT).
const LA = (y: number, mo: number, d: number, h: number, min: number): Date =>
  new Date(Date.UTC(y, mo - 1, d, h + 7, min));

afterEach(() => {
  mock.timers.reset();
});

describe('fskFromAge', () => {
  it('maps ages to the 0/6/12/16 tiers and null at 18', () => {
    assert.equal(fskFromAge(0), 0);
    assert.equal(fskFromAge(5), 0);
    assert.equal(fskFromAge(6), 6);
    assert.equal(fskFromAge(11), 6);
    assert.equal(fskFromAge(12), 12);
    assert.equal(fskFromAge(15), 12);
    assert.equal(fskFromAge(16), 16);
    assert.equal(fskFromAge(17), 16);
    assert.equal(fskFromAge(18), null);
    assert.equal(fskFromAge(40), null);
  });
});

describe('fskFromDob birthday boundaries (LA local 2026-10-13 00:30)', () => {
  it('ages up on the birthday, not the day before', () => {
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 10, 13, 0, 30) });

    assert.equal(fskFromDob('2020-10-13'), 6); // turns 6 today
    assert.equal(fskFromDob('2020-10-14'), 0); // turns 6 tomorrow
    assert.equal(fskFromDob('2014-10-13'), 12);
    assert.equal(fskFromDob('2014-10-14'), 6);
    assert.equal(fskFromDob('2010-10-13'), 16);
    assert.equal(fskFromDob('2010-10-14'), 12);
    assert.equal(fskFromDob('2008-10-13'), null); // 18 today: unrestricted
    assert.equal(fskFromDob('2008-10-14'), 16);
  });

  it('keeps 2014-10-13 at tier 6 the evening before the 12th birthday', () => {
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 10, 12, 20, 0) });
    assert.equal(fskFromDob('2014-10-13'), 6);
  });

  it('ages a Feb-29 birthday up on Mar 1 in a non-leap year', () => {
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 2, 27, 12, 0) });
    assert.equal(fskFromDob('2008-02-29'), 16); // still 17

    mock.timers.reset();
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 3, 1, 12, 0) });
    assert.equal(fskFromDob('2008-02-29'), null); // 18 since Mar 1
  });

  it('returns 0 for an invalid date of birth and null without one', () => {
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 10, 13, 0, 30) });

    assert.equal(fskFromDob(null), null);
    assert.equal(fskFromDob(undefined), null);
    assert.equal(fskFromDob('2019-02-29'), 0);
    assert.equal(fskFromDob('2019-02-31'), 0);
    assert.equal(fskFromDob('garbage'), 0);
    assert.equal(fskFromDob('2030-01-01'), 0); // future date
  });
});

describe('ageFromDob', () => {
  it('returns whole years against the local calendar date', () => {
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 10, 13, 0, 30) });

    assert.equal(ageFromDob('2014-10-13'), 12);
    assert.equal(ageFromDob('2014-10-14'), 11);
  });

  it('returns 0 for unparseable input', () => {
    assert.equal(ageFromDob('not-a-date'), 0);
  });
});

describe('isValidDob (LA local 2026-10-13)', () => {
  it('accepts only real, past-or-today YYYY-MM-DD dates', () => {
    mock.timers.enable({ apis: ['Date'], now: LA(2026, 10, 13, 12, 0) });

    assert.equal(isValidDob('2019-02-28'), true);
    assert.equal(isValidDob('2020-02-29'), true); // real leap day
    assert.equal(isValidDob('2019-02-29'), false);
    assert.equal(isValidDob('2019-02-31'), false);
    assert.equal(isValidDob('1899-12-31'), false); // year < 1900
    assert.equal(isValidDob('2026-10-14'), false); // tomorrow
    assert.equal(isValidDob('2026-10-13'), true); // today
    assert.equal(isValidDob('garbage'), false);
    assert.equal(isValidDob('2026-10-13T00:00:00Z'), false); // not plain YYYY-MM-DD
  });
});
