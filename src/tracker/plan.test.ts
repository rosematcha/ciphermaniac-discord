import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LiveRound } from '../live/types.ts';
import { filler, follow, index, match, round, seat } from './fixtures.test-helpers.ts';
import { type EventView, initialProgress, isFinished, plan, type Progress, type Step } from './plan.ts';

const squad = [
  follow('Tord Reklev', 'NO'),
  follow('Jasmine Dickinson', 'UK'),
  follow('Natalie Millar', 'AU'),
  follow('Emma Hagen', 'NO'),
  follow('Reese Lundquist', 'US')
];

function view(current: number, rounds: LiveRound[], extra: Partial<EventView> = {}): EventView {
  return {
    slug: 'frankfurt-2027',
    index: index(current),
    rounds: new Map(rounds.map(r => [r.round, r])),
    decks: {},
    ...extra
  };
}

function progress(resultsDone: number, keys: string[] = []): Progress {
  const messages = Object.fromEntries(keys.map(key => [key, { channelId: 'c', messageId: key, body: '' }]));
  return { resultsDone, messages };
}

function sent(steps: Step[]): string[] {
  return steps.map(step => (step.kind === 'send' ? step.key : `advance ${step.round}`));
}

const BARS: Record<number, string> = { 0xeeaa11: 'playing', 0x23a55a: 'win', 0xf23f43: 'loss', 0x80848e: 'grey' };

/** A sent message as lines: its header, then `[bar] title | description` for each embed. */
function text(steps: Step[], key: string): string {
  const step = steps.find(s => s.kind === 'send' && s.key === key);
  assert.ok(step?.kind === 'send', `no ${key}`);
  const { content, embeds } = step.payload;
  return [content, ...embeds.map(e => `[${BARS[e.color] ?? e.color}] ${e.title} | ${e.description}`)].join('\n');
}

/** Round 4 at Frankfurt: the four squad members there, Reese is at Brisbane. */
function frankfurtRound4(settled: boolean): LiveRound {
  return round(4, [
    match(12, seat('Tord Reklev', 'NO', 3), seat('Ahmed Nasser', 'DE', 3), settled ? 'a' : undefined),
    match(40, seat('Jasmine Dickinson', 'UK', 2, 1), seat('Luca Rossi', 'IT', 2, 1), settled ? 'b' : undefined),
    match(311, seat('Natalie Millar', 'AU', 0, 3), seat('Jan Novak', 'CZ', 0, 3), settled ? 'b' : undefined),
    match(77, seat('Emma Hagen', 'NO', 2, 1), seat('Sofia Berg', 'SE', 2, 1), settled ? 'a' : undefined)
  ]);
}

describe('plan', () => {
  it('posts pairings for the followed players at the event when a round starts', () => {
    const steps = plan(view(4, [frankfurtRound4(false)], { decks: { 'luca rossi|IT': "N's Zoroark" } }), squad, progress(3));
    assert.deepEqual(sent(steps), ['r4:pairings']);
    const body = text(steps, 'r4:pairings');
    assert.match(body, /^\*\*Frankfurt · Round 4\*\*$/m);
    assert.match(body, /^\[playing\] Tord Reklev · 3-0-0 \| Table 12 vs Ahmed Nasser$/m);
    assert.match(body, /^\[playing\] Jasmine Dickinson · 2-1-0 \| Table 40 vs Luca Rossi \(N's Zoroark\)$/m);
    assert.doesNotMatch(body, /Reese/);
    // Table order, not follow order.
    assert.ok(body.indexOf('Emma') < body.indexOf('Natalie'));
  });

  it('waits until every followed player has a result before posting results', () => {
    const partial = frankfurtRound4(false);
    partial.matches[0] = match(12, seat('Tord Reklev', 'NO', 3), seat('Ahmed Nasser', 'DE', 3), 'a');
    assert.deepEqual(sent(plan(view(4, [partial]), squad, progress(3, ['r4:pairings']))), ['r4:pairings']);

    const steps = plan(view(4, [frankfurtRound4(true)]), squad, progress(3, ['r4:pairings']));
    assert.deepEqual(sent(steps), ['r4:pairings', 'advance 4']);
    assert.match(text(steps, 'r4:pairings'), /^\*\*Frankfurt · Round 4 results\*\*$/m);
    assert.match(text(steps, 'r4:pairings'), /^\[win\] Tord Reklev · 4-0-0 \| Won vs Ahmed Nasser$/m);
    assert.match(text(steps, 'r4:pairings'), /^\[loss\] Natalie Millar · 0-4-0 \| Lost vs Jan Novak$/m);
  });

  it('marks a drop, then stops waiting on the dropped player', () => {
    const r4 = frankfurtRound4(true);
    const natalie = r4.matches[2];
    assert.ok(natalie?.seats[0]);
    natalie.seats[0].dropped = true;
    assert.match(text(plan(view(4, [r4]), squad, progress(3)), 'r4:pairings'), /^\[loss\] Natalie Millar · 0-4-0 \| Lost vs Jan Novak · dropped$/m);

    // Round 5 is paired without her; the other three finishing is enough.
    const r5 = round(5, [
      match(8, seat('Tord Reklev', 'NO', 4), seat('Max Weber', 'DE', 4), 'a'),
      match(30, seat('Jasmine Dickinson', 'UK', 2, 2), seat('Eva Klein', 'AT', 2, 2), 'a'),
      match(60, seat('Emma Hagen', 'NO', 3, 1), seat('Tom Weiss', 'CH', 3, 1), 'b')
    ]);
    const steps = plan(view(5, [r4, r5]), squad, progress(4, ['r5:pairings']));
    assert.deepEqual(sent(steps), ['r5:pairings', 'advance 5']);
    assert.doesNotMatch(text(steps, 'r5:pairings'), /Natalie/);
  });

  it('edits the pairings when an opponent deck comes in, and leaves them alone otherwise', () => {
    const r4 = frankfurtRound4(false);
    const first = plan(view(4, [r4]), squad, progress(3));
    const posted = first[0];
    assert.ok(posted?.kind === 'send');
    const after: Progress = { resultsDone: 3, messages: { 'r4:pairings': { channelId: 'c', messageId: 'm', body: posted.body } } };
    assert.deepEqual(plan(view(4, [r4]), squad, after), []);

    const withDeck = plan(view(4, [r4], { decks: { 'ahmed nasser|DE': 'Gardevoir' } }), squad, after);
    assert.deepEqual(sent(withDeck), ['r4:pairings']);
    assert.match(text(withDeck, 'r4:pairings'), /Ahmed Nasser \(Gardevoir\)/);
  });

  it('highlights who made Day 2 before its first pairings, and forgets who did not', () => {
    const r9 = round(9, [
      match(5, seat('Tord Reklev', 'NO', 7, 1), seat('A B', 'DE', 7, 1), 'a'),
      match(200, seat('Emma Hagen', 'NO', 5, 3), seat('C D', 'DE', 5, 3), 'b'),
      ...filler(100)
    ]);
    const r10 = round(10, [match(3, seat('Tord Reklev', 'NO', 8, 1), seat('E F', 'FR', 8, 1)), ...filler(20)]);
    const steps = plan(view(10, [r9, r10]), squad, progress(9));
    assert.deepEqual(sent(steps), ['r10:milestone', 'r10:pairings']);
    const highlight = text(steps, 'r10:milestone');
    assert.match(highlight, /^\*\*Frankfurt · Day 2\*\*$/m);
    assert.match(highlight, /^\[win\] Tord Reklev · 8-1-0 \| Day 2$/m);
    assert.doesNotMatch(highlight, /Emma/);

    // The highlight is sent once.
    assert.deepEqual(sent(plan(view(10, [r9, r10]), squad, progress(9, ['r10:milestone', 'r10:pairings']))), ['r10:pairings']);
  });

  it('does not call an ordinary round with a few drops Day 2', () => {
    const r5 = round(5, filler(100));
    const r6 = round(6, [match(1, seat('Tord Reklev', 'NO', 5), seat('X Y', 'DE', 5)), ...filler(90)]);
    assert.deepEqual(sent(plan(view(6, [r5, r6]), squad, progress(5))), ['r6:pairings']);
  });

  it('highlights the top cut, labels its rounds, and drops the eliminated', () => {
    const swiss = round(14, [match(1, seat('Tord Reklev', 'NO', 11, 2), seat('Q R', 'IT', 11, 2), 'a'), ...filler(200)]);
    const top8 = round(
      15,
      [
        match(1, seat('Tord Reklev', 'NO', 12, 2), seat('Katy Montgomerie', 'UK', 12, 2), 'a'),
        match(2, seat('Emma Hagen', 'NO', 11, 3), seat('Adam Denk', 'CZ', 12, 1), 'b'),
        ...filler(2)
      ],
      true
    );
    const top4 = round(16, [match(1, seat('Tord Reklev', 'NO', 12, 2), seat('Adam Denk', 'CZ', 12, 1)), ...filler(1)], true);
    const steps = plan(view(16, [swiss, top8, top4]), squad, progress(14));
    assert.deepEqual(sent(steps), ['r15:milestone', 'r15:pairings', 'advance 15', 'r16:pairings']);
    assert.match(text(steps, 'r15:milestone'), /Top 8/);
    assert.match(text(steps, 'r15:pairings'), /Top 8 results/);
    assert.match(text(steps, 'r15:pairings'), /^\[loss\] Emma Hagen \| Lost vs Adam Denk$/m);
    assert.match(text(steps, 'r16:pairings'), /^\*\*Frankfurt · Top 4\*\*/m);
    assert.match(text(steps, 'r16:pairings'), /^\[playing\] Tord Reklev \| Table 1 vs Adam Denk$/m);
    assert.doesNotMatch(text(steps, 'r16:pairings'), /Emma/);
  });

  it('catches up on several finished rounds in order', () => {
    const r1 = round(1, [match(1, seat('Tord Reklev', 'NO'), seat('A', 'DE'), 'a')]);
    const r2 = round(2, [match(1, seat('Tord Reklev', 'NO', 1), seat('B', 'DE', 1), 'a')]);
    const r3 = round(3, [match(1, seat('Tord Reklev', 'NO', 2), seat('C', 'DE', 2))]);
    assert.deepEqual(sent(plan(view(3, [r1, r2, r3]), squad, progress(0))), [
      'r1:pairings',
      'advance 1',
      'r2:pairings',
      'advance 2',
      'r3:pairings'
    ]);
  });

  it('skips past rounds with nobody followed in them, but not the current one', () => {
    const empty = round(1, filler(3));
    const current = round(2, filler(3));
    assert.deepEqual(sent(plan(view(2, [empty, current]), squad, progress(0))), ['advance 1']);
  });

  it('shows a bye', () => {
    const r2 = round(2, [{ table: 0, seats: [seat('Tord Reklev', 'NO', 2, 0, { result: 'win' })], complete: true }, match(1, seat('Emma Hagen', 'NO', 1), seat('Z', 'DE', 1))]);
    const steps = plan(view(2, [r2]), squad, progress(1));
    assert.match(text(steps, 'r2:pairings'), /^\[playing\] Tord Reklev · 1-0-0 \| Bye$/m);
  });

  it('gives two followed players at one table an embed each', () => {
    const r2 = round(2, [match(9, seat('Tord Reklev', 'NO', 1), seat('Emma Hagen', 'NO', 1))]);
    const body = text(plan(view(2, [r2]), squad, progress(1)), 'r2:pairings');
    assert.match(body, /^\[playing\] Tord Reklev · 1-0-0 \| Table 9 vs Emma Hagen$/m);
    assert.match(body, /^\[playing\] Emma Hagen · 1-0-0 \| Table 9 vs Tord Reklev$/m);
  });

  it('runs more than ten players over several messages, the header on the first', () => {
    const many = Array.from({ length: 23 }, (_, i) => follow(`Player ${i}`, 'US'));
    const r1 = round(1, many.map((f, i) => match(i + 1, seat(f.name, 'US'), seat(`Opp ${i}`, 'DE'))));
    const steps = plan(view(1, [r1]), many, progress(0));
    assert.deepEqual(sent(steps), ['r1:pairings', 'r1:pairings:2', 'r1:pairings:3']);
    assert.equal(text(steps, 'r1:pairings').split('\n').length, 11);
    assert.match(text(steps, 'r1:pairings:2'), /^\n\[playing\] Player 10 /);
    assert.equal(text(steps, 'r1:pairings:3').split('\n').length, 4);
  });

  it('escapes Discord markdown in names', () => {
    const r1 = round(1, [match(1, seat('Tord Reklev', 'NO'), seat('x_x*', 'DE'))]);
    assert.match(text(plan(view(1, [r1]), squad, progress(0)), 'r1:pairings'), /x\\_x\\\*/);
  });
});

describe('initialProgress', () => {
  it('starts a server at the current round', () => {
    assert.deepEqual(initialProgress(index(8)), { resultsDone: 7, messages: {} });
  });
});

describe('isFinished', () => {
  it('is true only once the final is published and reported', () => {
    assert.equal(isFinished(index(17, { finished: true }), progress(17)), true);
    assert.equal(isFinished(index(17, { finished: true }), progress(16)), false);
    assert.equal(isFinished(index(17), progress(17)), false);
  });
});

describe('plan with RK9 gaps', () => {
  it('shows the record a player sat down with, even once their result is in', () => {
    const r8 = round(8, [
      match(3, seat('Tord Reklev', 'NO', 7), seat('A', 'IT', 7), 'a'),
      match(9, seat('Emma Hagen', 'NO', 5, 2), seat('B', 'IT', 5, 2))
    ]);
    assert.match(text(plan(view(8, [r8]), squad, progress(7)), 'r8:pairings'), /^\[playing\] Tord Reklev · 7-0-0 \|/m);
  });

  it('reports a past round RK9 never finished rather than stalling on it', () => {
    const r8 = round(8, [match(3, seat('Tord Reklev', 'NO', 7), seat('A', 'IT', 7))]);
    const r9 = round(9, [match(1, seat('Tord Reklev', 'NO', 8), seat('B', 'IT', 8))]);
    const steps = plan(view(9, [r8, r9]), squad, progress(7));
    assert.deepEqual(sent(steps), ['r8:pairings', 'advance 8', 'r9:pairings']);
    assert.match(text(steps, 'r8:pairings'), /^\[grey\] Tord Reklev · 7-0-0 \| No result posted vs A$/m);
  });
});

describe('plan with seat aliases', () => {
  it('shows the name a player goes by, and keeps deck reports on the registered name', () => {
    const decks = { 'cali white|CA': 'Gardevoir' };
    const followed = round(3, [match(7, seat('Cali White', 'CA', 2), seat('Ann Lee', 'US', 2))]);
    const asPlayer = text(plan(view(3, [followed], { decks }), [follow('Caitlin White', 'CA')], progress(2)), 'r3:pairings');
    assert.match(asPlayer, /^\[playing\] Caitlin White · 2-0-0 \| Table 7 vs Ann Lee$/m);

    const opposing = round(3, [match(8, seat('Tord Reklev', 'NO', 2), seat('Cali White', 'CA', 2))]);
    const asOpponent = text(plan(view(3, [opposing], { decks }), [follow('Tord Reklev', 'NO')], progress(2)), 'r3:pairings');
    assert.match(asOpponent, /^\[playing\] Tord Reklev · 2-0-0 \| Table 8 vs Caitlin White \(Gardevoir\)$/m);
  });
});

describe('plan with preferred names', () => {
  const r2 = round(2, [
    match(3, seat('Jordan Vale', 'US', 1), seat('Tord Reklev', 'NO', 1)),
    match(9, seat('Emma Hagen', 'NO', 1), seat('Cali White', 'CA', 1))
  ]);

  it("uses the server's name for a player, as a follow and as someone's opponent", () => {
    const follows = [{ ...follow('Jordan Vale', 'US'), preferredName: 'Jay Vale' }, follow('Tord Reklev', 'NO')];
    const body = text(plan(view(2, [r2]), follows, progress(1)), 'r2:pairings');
    assert.match(body, /^\[playing\] Jay Vale · 1-0-0 \| Table 3 vs Tord Reklev$/m);
    assert.match(body, /^\[playing\] Tord Reklev · 1-0-0 \| Table 3 vs Jay Vale$/m);
    assert.doesNotMatch(body, /Jordan/);
  });

  it('keeps it to that server: another server following the same player sees the published name', () => {
    const body = text(plan(view(2, [r2]), [follow('Jordan Vale', 'US')], progress(1)), 'r2:pairings');
    assert.match(body, /^\[playing\] Jordan Vale · 1-0-0 \| Table 3 vs Tord Reklev$/m);
  });

  it("puts a server's name ahead of the published alias", () => {
    const follows = [{ ...follow('Caitlin White', 'CA'), preferredName: 'Cai' }, follow('Emma Hagen', 'NO')];
    const body = text(plan(view(2, [r2]), follows, progress(1)), 'r2:pairings');
    assert.match(body, /^\[playing\] Cai · 1-0-0 \| Table 9 vs Emma Hagen$/m);
    assert.match(body, /^\[playing\] Emma Hagen · 1-0-0 \| Table 9 vs Cai$/m);
  });
});
