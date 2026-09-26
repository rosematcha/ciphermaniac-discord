/**
 * The live round files Ciphermaniac publishes under `live/v1/` on
 * r2.ciphermaniac.com. Mirrors `shared/live/types.ts` in the ciphermaniac repo,
 * trimmed to the fields this bot reads.
 */

export type LiveResult = 'win' | 'loss' | 'tie';

export interface LiveSeat {
  name: string;
  /** Country tag as RK9 prints it, `''` when there is none. */
  country: string;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  /** Present once the match is confirmed. */
  result?: LiveResult;
  /** The player dropped after this round. */
  dropped?: true;
}

export interface LiveMatch {
  /** `0` for a bye or an unpaired loss. */
  table: number;
  /** One seat for a bye or an unpaired loss, otherwise two. */
  seats: LiveSeat[];
  complete: boolean;
}

export interface LiveEvent {
  slug: string;
  name: string;
  firstDay: string;
  lastDay: string;
}

export interface LiveCut {
  from: number;
  size: number;
}

export interface LiveIndex {
  slug: string;
  name: string;
  round: number;
  matches: number;
  /** Changes whenever the current round's file does. */
  hash: string;
  cut?: LiveCut;
  finished?: true;
}

export interface LiveRound {
  round: number;
  topCut?: true;
  matches: LiveMatch[];
}

export interface LiveSchedule {
  events: LiveEvent[];
}

/** `live/v1/{slug}/reports.json`: the archetype shown for each seat key. */
export interface LiveReports {
  decks: Record<string, string>;
}
