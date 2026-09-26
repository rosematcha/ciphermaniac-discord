import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { follow, match, round, seat } from './fixtures.test-helpers.ts';
import { findFollowed } from './follows.ts';

describe('findFollowed', () => {
  it('matches names regardless of case and diacritics', () => {
    const r = round(1, [match(1, seat('NATALIE Millar', 'AU'), seat('Jan Nováček', 'CZ'))]);
    const found = findFollowed(r, [follow('Natalie Millar', 'AU'), follow('Jan Novacek')]);
    assert.deepEqual(found.map(entry => entry.seat.name), ['NATALIE Millar', 'Jan Nováček']);
    assert.equal(found[0]?.opponent?.name, 'Jan Nováček');
  });

  it('takes a lone name match even when the country hint disagrees', () => {
    const r = round(1, [match(1, seat('Jasmine Dickinson', 'GB'), seat('X', 'DE'))]);
    assert.equal(findFollowed(r, [follow('Jasmine Dickinson', 'UK')]).length, 1);
  });

  it('tells two players with one name apart by country, and skips them if it cannot', () => {
    const r = round(1, [match(1, seat('Alex Smith', 'US'), seat('Alex Smith', 'CA'))]);
    assert.equal(findFollowed(r, [follow('Alex Smith', 'CA')])[0]?.seat.country, 'CA');
    assert.deepEqual(findFollowed(r, [follow('Alex Smith', 'UK')]), []);
    assert.deepEqual(findFollowed(r, [follow('Alex Smith')]), []);
  });

  it('gives a bye no opponent', () => {
    const r = round(1, [{ table: 0, seats: [seat('Tord Reklev', 'NO', 1, 0, { result: 'win' })], complete: true }]);
    const [entry] = findFollowed(r, [follow('Tord Reklev', 'NO')]);
    assert.ok(entry);
    assert.equal('opponent' in entry, false);
  });
});

describe('findFollowed with seat aliases', () => {
  it('finds a player under the name they register with', () => {
    const r = round(1, [match(4, seat('Cali White', 'CA', 3), seat('X', 'US', 3))]);
    const [entry] = findFollowed(r, [follow('Caitlin White', 'CA')]);
    assert.equal(entry?.seat.name, 'Cali White');
  });

  it('still finds them if they register under the name they go by', () => {
    const r = round(1, [match(4, seat('Caitlin White', 'CA', 3), seat('X', 'US', 3))]);
    assert.equal(findFollowed(r, [follow('Caitlin White', 'CA')]).length, 1);
  });
});
