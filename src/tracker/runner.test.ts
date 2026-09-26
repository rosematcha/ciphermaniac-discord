import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LiveIndex, LiveRound } from '../live/types.ts';
import { Directory } from '../players/directory.ts';
import { Store } from '../store/store.ts';
import { follow, index, match, round, seat } from './fixtures.test-helpers.ts';
import type { MessagePayload } from './render.ts';
import { Runner, type Sender, type Source } from './runner.ts';

const NOW = new Date('2026-09-26T12:00:00Z');
const WEEKEND = { firstDay: '2026-09-26', lastDay: '2026-09-27' };

interface World {
  indexes: Map<string, LiveIndex>;
  rounds: Map<string, LiveRound>;
  decks: Record<string, string>;
  fetches: string[];
}

function source(world: World): Source {
  return {
    fetchSchedule: () =>
      Promise.resolve({
        events: [
          { slug: 'frankfurt-2027', name: 'Frankfurt', ...WEEKEND },
          { slug: 'brisbane-2027', name: 'Brisbane', ...WEEKEND },
          { slug: 'recife-2027', name: 'Recife', firstDay: '2026-10-03', lastDay: '2026-10-04' }
        ]
      }),
    fetchIndex: slug => Promise.resolve(world.indexes.get(slug) ?? null),
    fetchRound: (slug, n) => {
      world.fetches.push(`${slug}:${n}`);
      return Promise.resolve(world.rounds.get(`${slug}:${n}`) ?? null);
    },
    fetchDecks: () => Promise.resolve(world.decks)
  };
}

interface Posted {
  channelId: string;
  id: string;
  title: string;
  description: string;
}

function recorder(): Sender & { posts: Posted[]; edits: string[]; gone: Set<string> } {
  const posts: Posted[] = [];
  const edits: string[] = [];
  const gone = new Set<string>();
  // The header without its markdown or link, and a line per player embed.
  const summary = (payload: MessagePayload) => ({
    title: payload.content.replace(/\*\*/g, '').replace(/ · \[live\].*$/, ''),
    description: payload.embeds.map(e => `${e.title} | ${e.description}`).join('\n')
  });
  return {
    posts,
    edits,
    gone,
    post: (channelId, payload) => {
      const id = `m${posts.length + 1}`;
      posts.push({ channelId, id, ...summary(payload) });
      return Promise.resolve(id);
    },
    edit: (_channelId, messageId) => {
      if (gone.has(messageId)) {
        return Promise.resolve(false);
      }
      edits.push(messageId);
      return Promise.resolve(true);
    }
  };
}

function setup() {
  const world: World = { indexes: new Map(), rounds: new Map(), decks: {}, fetches: [] };
  const store = new Store(':memory:');
  store.setChannel('guild', 'updates');
  for (const name of ['Tord Reklev', 'Jasmine Dickinson', 'Natalie Millar', 'Emma Hagen', 'Reese Lundquist']) {
    store.follow('guild', follow(name));
  }
  const sender = recorder();
  const runner = new Runner({ source: source(world), sender, store, directory: new Directory(), log: () => undefined });
  const publish = (slug: string, r: LiveRound, hash = `${r.round}`) => {
    world.rounds.set(`${slug}:${r.round}`, r);
    world.indexes.set(slug, { ...index(r.round, { hash, slug }), name: slug.startsWith('f') ? 'Frankfurt' : 'Brisbane' });
  };
  return { world, store, sender, runner, publish };
}

const frankfurt = (settled: boolean) =>
  round(3, [
    match(4, seat('Tord Reklev', 'NO', 2), seat('A', 'DE', 2), settled ? 'a' : undefined),
    match(9, seat('Jasmine Dickinson', 'UK', 2), seat('B', 'DE', 2), settled ? 'b' : undefined),
    match(20, seat('Natalie Millar', 'AU', 1, 1), seat('C', 'DE', 1, 1), settled ? 'b' : undefined),
    match(21, seat('Emma Hagen', 'NO', 1, 1), seat('D', 'DE', 1, 1), settled ? 'a' : undefined)
  ]);
const brisbane = (settled: boolean) =>
  round(5, [match(2, seat('Reese Lundquist', 'US', 4), seat('E', 'AU', 4), settled ? 'a' : undefined)]);

describe('Runner', () => {
  it('reports two events in one weekend side by side, each at its own pace', async () => {
    const { sender, runner, publish } = setup();
    publish('frankfurt-2027', frankfurt(false));
    publish('brisbane-2027', brisbane(false));
    await runner.tick(NOW);
    assert.deepEqual(sender.posts.map(p => p.title), ['Frankfurt · Round 3', 'Brisbane · Round 5']);
    assert.equal(sender.posts[0]?.description.split('\n').length, 4);

    publish('brisbane-2027', brisbane(true), 'done');
    await runner.tick(NOW);
    assert.deepEqual(sender.posts.map(p => p.title).slice(2), ['Brisbane · Round 5 results']);

    publish('frankfurt-2027', frankfurt(true), 'done');
    await runner.tick(NOW);
    assert.equal(sender.posts[3]?.title, 'Frankfurt · Round 3 results');
    assert.equal(sender.posts.length, 4);
    assert.ok(sender.posts.every(p => p.channelId === 'updates'));
  });

  it('sends nothing twice across ticks, and edits pairings when a deck comes in', async () => {
    const { world, sender, runner, publish } = setup();
    publish('frankfurt-2027', frankfurt(false));
    await runner.tick(NOW);
    await runner.tick(NOW);
    assert.equal(sender.posts.length, 1);
    assert.deepEqual(sender.edits, []);

    world.decks = { 'a|DE': 'Gardevoir' };
    await runner.tick(NOW);
    assert.deepEqual(sender.edits, ['m1']);
    assert.equal(sender.posts.length, 1);
  });

  it('reposts pairings whose message was deleted', async () => {
    const { world, sender, runner, publish } = setup();
    publish('frankfurt-2027', frankfurt(false));
    await runner.tick(NOW);
    sender.gone.add('m1');
    world.decks = { 'a|DE': 'Gardevoir' };
    await runner.tick(NOW);
    assert.equal(sender.posts.length, 2);
    await runner.tick(NOW);
    assert.equal(sender.posts.length, 2);
  });

  it('refetches the current round only when the index hash moves', async () => {
    const { world, runner, publish } = setup();
    publish('frankfurt-2027', frankfurt(false));
    await runner.tick(NOW);
    await runner.tick(NOW);
    assert.equal(world.fetches.filter(f => f === 'frankfurt-2027:3').length, 1);
    publish('frankfurt-2027', frankfurt(true), 'changed');
    await runner.tick(NOW);
    assert.equal(world.fetches.filter(f => f === 'frankfurt-2027:3').length, 2);
  });

  it('retries a failed send on the next tick without skipping ahead', async () => {
    const { store, sender, runner, publish } = setup();
    publish('frankfurt-2027', frankfurt(true));
    const post = sender.post;
    sender.post = () => Promise.reject(new Error('Missing Access'));
    await runner.tick(NOW);
    assert.equal(store.progress('guild', 'frankfurt-2027')?.resultsDone, 2);
    sender.post = post;
    await runner.tick(NOW);
    assert.deepEqual(sender.posts.map(p => p.title), ['Frankfurt · Round 3 results']);
    assert.equal(store.progress('guild', 'frankfurt-2027')?.resultsDone, 3);
  });

  it("uses a round's final results even when they landed between polls", async () => {
    const { world, sender, runner, publish } = setup();
    publish('frankfurt-2027', frankfurt(false));
    await runner.tick(NOW);
    // Round 3 finishes and round 4 is paired before the next poll.
    world.rounds.set('frankfurt-2027:3', frankfurt(true));
    publish('frankfurt-2027', round(4, [match(1, seat('Tord Reklev', 'NO', 3), seat('F', 'DE', 3))]));
    await runner.tick(NOW);
    const results = sender.posts.find(p => p.title.endsWith('Round 3 results'));
    assert.match(results?.description ?? '', /^Tord Reklev · 3-0-0 \| Won vs A$/m);
    assert.doesNotMatch(results?.description ?? '', /no result posted/);
  });

  it('keeps its progress through a missing or failing schedule', async () => {
    const { world, store, sender, runner, publish } = setup();
    publish('frankfurt-2027', frankfurt(false));
    await runner.tick(NOW);
    const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
    const real = runner;
    let fetches = 0;
    const flaky = new Runner({
      source: {
        ...source(world),
        fetchSchedule: () => (++fetches === 1 ? source(world).fetchSchedule() : fetches === 2 ? Promise.resolve(null) : Promise.reject(new Error('503')))
      },
      sender,
      store,
      directory: new Directory(),
      log: () => undefined
    });
    await flaky.tick(NOW);
    await flaky.tick(later(11));
    await flaky.tick(later(22));
    assert.ok(store.progress('guild', 'frankfurt-2027'));
    assert.equal(sender.posts.length, 1);
    await real.tick(later(33));
    assert.equal(sender.posts.length, 1);
  });

  it('still posts when the deck reports cannot be read', async () => {
    const { world, store, sender } = setup();
    world.rounds.set('frankfurt-2027:3', frankfurt(false));
    world.indexes.set('frankfurt-2027', { ...index(3, { slug: 'frankfurt-2027' }), name: 'Frankfurt' });
    const runner = new Runner({
      source: { ...source(world), fetchDecks: () => Promise.reject(new Error('502')) },
      sender,
      store,
      directory: new Directory(),
      log: () => undefined
    });
    await runner.tick(NOW);
    assert.deepEqual(sender.posts.map(p => p.title), ['Frankfurt · Round 3']);
  });

  it('leaves events off this weekend alone', async () => {
    const { world, runner, publish } = setup();
    publish('recife-2027', round(1, [match(1, seat('Tord Reklev', 'NO'), seat('X', 'BR'))]));
    await runner.tick(NOW);
    assert.deepEqual(world.fetches, []);
  });
});
