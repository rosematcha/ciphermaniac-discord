import { foldName } from '../live/fold.ts';
import type { LiveIndex, LiveMatch, LiveResult, LiveRound, LiveSeat } from '../live/types.ts';
import type { Follow } from './follows.ts';

export function follow(name: string, country = ''): Follow {
  return { nameKey: foldName(name), name, country };
}

export function seat(name: string, country: string, wins = 0, losses = 0, extra: Partial<LiveSeat> = {}): LiveSeat {
  return { name, country, wins, losses, ties: 0, points: wins * 3, ...extra };
}

/** A two-seat match; with a winner the result lands on both seats and the records move. */
export function match(table: number, a: LiveSeat, b: LiveSeat, winner?: 'a' | 'b'): LiveMatch {
  if (!winner) {
    return { table, seats: [a, b], complete: false };
  }
  const settle = (s: LiveSeat, result: LiveResult): LiveSeat =>
    result === 'win' ? { ...s, wins: s.wins + 1, result } : { ...s, losses: s.losses + 1, result };
  return {
    table,
    seats: [settle(a, winner === 'a' ? 'win' : 'loss'), settle(b, winner === 'b' ? 'win' : 'loss')],
    complete: true
  };
}

/** Filler tables, so a round's size can be set for Day 2 detection. */
export function filler(count: number, from = 1000): LiveMatch[] {
  return Array.from({ length: count }, (_, i) =>
    match(from + i, seat(`Filler ${i}a`, 'US'), seat(`Filler ${i}b`, 'US'), 'a')
  );
}

export function round(number: number, matches: LiveMatch[], topCut = false): LiveRound {
  return { round: number, matches, ...(topCut ? { topCut: true as const } : {}) };
}

export function index(roundNumber: number, extra: Partial<LiveIndex> = {}): LiveIndex {
  return { slug: 'frankfurt-2027', name: 'Frankfurt', round: roundNumber, matches: 0, hash: 'h', ...extra };
}
