import { seatNameKeys } from '../live/aliases.ts';
import { foldName } from '../live/fold.ts';
import type { LiveMatch, LiveRound, LiveSeat } from '../live/types.ts';

/** A player a server follows. RK9 has no player IDs, so a follow is a name with a country hint. */
export interface Follow {
  /** `foldName` of the name; one follow per folded name per server. */
  nameKey: string;
  name: string;
  /** `''` when the country is unknown. */
  country: string;
}

export interface FollowedSeat {
  match: LiveMatch;
  seat: LiveSeat;
  /** Absent for a bye or an unpaired loss. */
  opponent?: LiveSeat;
}

function seatsByName(round: LiveRound): Map<string, { match: LiveMatch; seat: LiveSeat }[]> {
  const byName = new Map<string, { match: LiveMatch; seat: LiveSeat }[]>();
  for (const match of round.matches) {
    for (const seat of match.seats) {
      const key = foldName(seat.name);
      byName.set(key, [...(byName.get(key) ?? []), { match, seat }]);
    }
  }
  return byName;
}

/**
 * The seat a follow refers to. A lone name match is taken whatever its country,
 * since the player index and RK9 do not always agree on one; two players sharing
 * a name are told apart by country, and left alone if that cannot settle it.
 */
function pickSeat<T extends { seat: LiveSeat }>(candidates: readonly T[], follow: Follow): T | undefined {
  if (candidates.length === 1) {
    return candidates[0];
  }
  const sameCountry = candidates.filter(entry => entry.seat.country === follow.country);
  return sameCountry.length === 1 ? sameCountry[0] : undefined;
}

/** Every followed player paired in the round, in table order. */
export function findFollowed(round: LiveRound, follows: readonly Follow[]): FollowedSeat[] {
  const byName = seatsByName(round);
  const found: FollowedSeat[] = [];
  for (const follow of follows) {
    const candidates = seatNameKeys(follow.nameKey).flatMap(nameKey => byName.get(nameKey) ?? []);
    const hit = pickSeat(candidates, follow);
    if (hit) {
      const opponent = hit.match.seats.find(seat => seat !== hit.seat);
      found.push({ match: hit.match, seat: hit.seat, ...(opponent ? { opponent } : {}) });
    }
  }
  return found.sort((a, b) => a.match.table - b.match.table);
}
