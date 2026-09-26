import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { follow } from '../tracker/fixtures.test-helpers.ts';
import { Store } from './store.ts';

describe('Store', () => {
  it('keeps follows per server, independent of events', () => {
    const store = new Store(':memory:');
    store.setChannel('g1', 'c1');
    store.setChannel('g2', 'c2');
    assert.equal(store.follow('g1', follow('Tord Reklev', 'NO')), true);
    assert.equal(store.follow('g1', follow('Tord Reklev', 'NO')), false);
    assert.equal(store.follow('g1', follow('Emma Hagen', 'NO')), true);
    store.follow('g2', follow('Reese Lundquist', 'US'));

    assert.deepEqual(store.follows('g1').map(f => f.name), ['Emma Hagen', 'Tord Reklev']);
    assert.deepEqual(store.subscribers().map(s => [s.guildId, s.channelId, s.follows.length]), [
      ['g1', 'c1', 2],
      ['g2', 'c2', 1]
    ]);
    assert.equal(store.unfollow('g1', 'tord reklev'), true);
    assert.equal(store.unfollow('g1', 'tord reklev'), false);
  });

  it('leaves out servers with no channel or no follows', () => {
    const store = new Store(':memory:');
    store.follow('g1', follow('Tord Reklev'));
    store.setChannel('g2', 'c2');
    assert.deepEqual(store.subscribers(), []);
  });

  it('updates the channel in place', () => {
    const store = new Store(':memory:');
    store.setChannel('g1', 'c1');
    store.setChannel('g1', 'c9');
    assert.equal(store.channelFor('g1'), 'c9');
    assert.equal(store.channelFor('nope'), null);
  });

  it('stores progress per server and event, and prunes finished events', () => {
    const store = new Store(':memory:');
    const progress = { resultsDone: 4, messages: { 'r4:results': { channelId: 'c', messageId: 'm', body: '{}' } } };
    store.saveProgress('g1', 'frankfurt-2027', progress);
    store.saveProgress('g1', 'baltimore-2027', { resultsDone: 17, messages: {} });
    assert.deepEqual(store.progress('g1', 'frankfurt-2027'), progress);
    store.pruneProgress(['frankfurt-2027']);
    assert.equal(store.progress('g1', 'baltimore-2027'), null);
    assert.ok(store.progress('g1', 'frankfurt-2027'));
    store.pruneProgress([]);
    assert.equal(store.progress('g1', 'frankfurt-2027'), null);
  });

  it('forgets a removed server', () => {
    const store = new Store(':memory:');
    store.setChannel('g1', 'c1');
    store.follow('g1', follow('Tord Reklev'));
    store.saveProgress('g1', 'x', { resultsDone: 1, messages: {} });
    store.removeGuild('g1');
    assert.equal(store.channelFor('g1'), null);
    assert.deepEqual(store.follows('g1'), []);
    assert.equal(store.progress('g1', 'x'), null);
  });
});
