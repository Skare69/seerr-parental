import { User } from '@server/entity/User';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const userWithParentalFields = (): User =>
  new User({
    id: 42,
    email: 'kid@seerr.dev',
    dateOfBirth: '2014-10-13',
    maxParentalRating: 12,
    blockedGenres: ['10752'],
  });

const parentalFields = ['dateOfBirth', 'maxParentalRating', 'blockedGenres'];

describe('User serialization of parental fields', () => {
  it('filter() omits the parental fields', () => {
    const filtered = userWithParentalFields().filter();
    for (const field of parentalFields) {
      assert.strictEqual(field in filtered, false, field);
    }
  });

  it('filter(true) keeps the parental fields', () => {
    const filtered = userWithParentalFields().filter(true);
    assert.strictEqual(filtered.dateOfBirth, '2014-10-13');
    assert.strictEqual(filtered.maxParentalRating, 12);
    assert.deepStrictEqual(filtered.blockedGenres, ['10752']);
  });

  it('toJSON() omits the parental fields', () => {
    const json = userWithParentalFields().toJSON();
    for (const field of parentalFields) {
      assert.strictEqual(field in json, false, field);
    }
  });
});
