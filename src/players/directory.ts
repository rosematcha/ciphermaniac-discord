/**
 * Players to suggest when following: ciphermaniac's player index, plus anyone
 * seen in a live round, since a first-timer is in pairings before the index.
 */

import { foldName } from '../live/fold.ts';
import type { PlayerIndex } from '../live/source.ts';
import type { LiveRound } from '../live/types.ts';
import type { Follow } from '../tracker/follows.ts';

interface Entry {
  follow: Follow;
  /** Events played, to put regulars first. */
  events: number;
}

function key(follow: Follow): string {
  return `${follow.nameKey}|${follow.country}`;
}

function matches(nameKey: string, query: string): boolean {
  return nameKey.startsWith(query) || nameKey.includes(` ${query}`);
}

export class Directory {
  readonly #entries = new Map<string, Entry>();

  loadIndex(index: PlayerIndex): void {
    index.names.forEach((name, i) => {
      const follow: Follow = { nameKey: foldName(name), name, country: index.countries[i] ?? '' };
      this.#entries.set(key(follow), { follow, events: index.eventCounts[i] ?? 0 });
    });
  }

  addRound(round: LiveRound): void {
    for (const seat of round.matches.flatMap(match => match.seats)) {
      const follow: Follow = { nameKey: foldName(seat.name), name: seat.name, country: seat.country };
      if (!this.#entries.has(key(follow))) {
        this.#entries.set(key(follow), { follow, events: 0 });
      }
    }
  }

  /** Players whose name, or any word of it, starts with the query; regulars first. */
  search(query: string, limit = 25): Follow[] {
    const folded = foldName(query);
    if (!folded) {
      return [];
    }
    return [...this.#entries.values()]
      .filter(entry => matches(entry.follow.nameKey, folded))
      .sort((a, b) => b.events - a.events || a.follow.name.localeCompare(b.follow.name))
      .slice(0, limit)
      .map(entry => entry.follow);
  }

  /**
   * The player a typed name means: an exact name match, the most regular one if
   * several share it, or a follow by name alone when nobody known has it.
   */
  resolve(text: string): Follow {
    const nameKey = foldName(text);
    const best = [...this.#entries.values()]
      .filter(entry => entry.follow.nameKey === nameKey)
      .sort((a, b) => b.events - a.events)[0];
    return best?.follow ?? { nameKey, name: text.trim().replace(/\s+/g, ' '), country: '' };
  }
}
