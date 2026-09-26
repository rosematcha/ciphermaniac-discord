import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { match, round, seat } from '../tracker/fixtures.test-helpers.ts';
import { Directory } from './directory.ts';

function directory(): Directory {
  const d = new Directory();
  d.loadIndex({
    names: ['Tord Reklev', 'Emma Hagen', 'Emma Hagen', 'Tomas Emmerich', 'Reese Lundquist'],
    countries: ['NO', 'NO', 'SE', 'DE', 'US'],
    eventCounts: [24, 22, 1, 5, 4]
  });
  return d;
}

describe('Directory', () => {
  it('finds players by the start of any word in their name, regulars first', () => {
    const d = directory();
    assert.deepEqual(d.search('emm').map(f => `${f.name} ${f.country}`), ['Emma Hagen NO', 'Tomas Emmerich DE', 'Emma Hagen SE']);
    assert.deepEqual(d.search('REKL').map(f => f.name), ['Tord Reklev']);
    assert.deepEqual(d.search('  '), []);
  });

  it('adds players seen in live pairings', () => {
    const d = directory();
    d.addRound(round(1, [match(1, seat('Nova Newcomer', 'BR'), seat('Tord Reklev', 'NO'))]));
    assert.deepEqual(d.search('nova').map(f => f.country), ['BR']);
    assert.equal(d.search('tord').length, 1);
  });

  it('resolves a typed name to the most regular player with it, or to the name alone', () => {
    const d = directory();
    assert.equal(d.resolve('emma hagen').country, 'NO');
    assert.deepEqual(d.resolve('  Brand   New '), { nameKey: 'brand new', name: 'Brand New', country: '' });
  });
});
