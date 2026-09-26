/**
 * Players who register on RK9 under a name other than the one they go by.
 * Mirrors `SEAT_ALIASES` in ciphermaniac's `shared/live/seatAliases.ts`; keep the
 * two in step.
 *
 * A follow is by the name a player goes by, so it has to find the seat under
 * the registered name, and messages show the name they go by. Deck reports stay
 * keyed by the registered name, as ciphermaniac keys them.
 */

import { foldName } from './fold.ts';

interface SeatAlias {
  /** The name the player goes by, as ciphermaniac publishes their career. */
  name: string;
  /** The name exactly as RK9 prints it on the pairing. */
  seatName: string;
  country: string;
}

const SEAT_ALIASES: readonly SeatAlias[] = [
  // Registers as Cali; her career is published as Caitlin White.
  { name: 'Caitlin White', seatName: 'Cali White', country: 'CA' }
];

const key = (name: string, country: string): string => `${foldName(name)}|${country}`;
const BY_SEAT = new Map(SEAT_ALIASES.map(alias => [key(alias.seatName, alias.country), alias.name]));

/** The name to show for a seat: the one the player goes by. */
export function displayName(seat: { name: string; country: string }): string {
  return BY_SEAT.get(key(seat.name, seat.country)) ?? seat.name;
}

/** Folded names a follow may appear under in pairings: its own, plus any registered alias. */
export function seatNameKeys(nameKey: string): string[] {
  const aliases = SEAT_ALIASES.filter(alias => foldName(alias.name) === nameKey).map(alias => foldName(alias.seatName));
  return [nameKey, ...aliases];
}
