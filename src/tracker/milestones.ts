import type { LiveIndex, LiveRound } from '../live/types.ts';

/**
 * A round whose field is under this share of the last one's is the first round
 * of Day 2. Drops take a few percent a round; the Day 2 cut takes most of the
 * field (Baltimore 2027 went from 922 tables to 279).
 */
const DAY2_SHARE = 0.6;

export type Milestone = { kind: 'day2' } | { kind: 'cut'; size: number };

function isCutStart(round: LiveRound, previous: LiveRound | undefined, index: LiveIndex): boolean {
  if (!round.topCut) {
    return false;
  }
  return previous ? !previous.topCut : index.cut?.from === round.round;
}

function isDay2Start(round: LiveRound, previous: LiveRound | undefined): boolean {
  if (round.topCut || !previous || previous.topCut) {
    return false;
  }
  return round.matches.length < previous.matches.length * DAY2_SHARE;
}

/** What starting this round means, if anything: the first round of Day 2 or of the top cut. */
export function milestoneFor(round: LiveRound, previous: LiveRound | undefined, index: LiveIndex): Milestone | null {
  if (isCutStart(round, previous, index)) {
    return { kind: 'cut', size: round.matches.length * 2 };
  }
  return isDay2Start(round, previous) ? { kind: 'day2' } : null;
}
