/**
 * One pass over every live event: fetch what changed, plan each server's
 * messages, send them. Called once a minute, matching the poller's pace.
 */

import { isEventLive } from '../live/source.ts';
import type { LiveEvent, LiveIndex, LiveRound, LiveSchedule } from '../live/types.ts';
import type { Directory } from '../players/directory.ts';
import type { Store, Subscriber } from '../store/store.ts';
import { type EventView, initialProgress, isFinished, plan, type Progress, type Step } from './plan.ts';
import type { MessagePayload } from './render.ts';

const SCHEDULE_TTL_MS = 10 * 60_000;

export interface Source {
  fetchSchedule: () => Promise<LiveSchedule | null>;
  fetchIndex: (slug: string) => Promise<LiveIndex | null>;
  fetchRound: (slug: string, round: number) => Promise<LiveRound | null>;
  fetchDecks: (slug: string) => Promise<Record<string, string>>;
}

export interface Sender {
  /** Posts a message and returns its ID. */
  post: (channelId: string, payload: MessagePayload) => Promise<string>;
  /** Edits a message; false if it no longer exists. */
  edit: (channelId: string, messageId: string, payload: MessagePayload) => Promise<boolean>;
}

export interface RunnerDeps {
  source: Source;
  sender: Sender;
  store: Store;
  directory: Directory;
  log?: (message: string) => void;
}

interface CachedRound {
  hash: string | null;
  round: LiveRound;
}

interface Tracked {
  subscriber: Subscriber;
  progress: Progress;
}

export class Runner {
  readonly #deps: RunnerDeps;
  readonly #log: (message: string) => void;
  #schedule: { events: LiveEvent[]; at: number } | null = null;
  /**
   * Rounds by `{slug}:{round}`. The current round is refetched when the index hash moves, and once more
   * after it stops being current, since its last results can land in the same minute the next round is
   * paired. After that a round never changes.
   */
  readonly #rounds = new Map<string, CachedRound>();

  constructor(deps: RunnerDeps) {
    this.#deps = deps;
    this.#log = deps.log ?? console.log;
  }

  async tick(now = new Date()): Promise<void> {
    const live = (await this.#events(now)).filter(e => isEventLive(e, now));
    this.#evictExcept(new Set(live.map(event => event.slug)));
    const subscribers = this.#deps.store.subscribers();
    for (const event of live) {
      try {
        await this.#tickEvent(event, subscribers);
      } catch (error) {
        this.#log(`${event.slug}: ${String(error)}`);
      }
    }
  }

  /** The events live now, from the last schedule read. */
  liveEvents(now = new Date()): LiveEvent[] {
    return (this.#schedule?.events ?? []).filter(event => isEventLive(event, now));
  }

  /**
   * The schedule, refreshed every few minutes. A failed or missing refresh keeps the last one: an empty
   * schedule would prune every server's progress and have it all posted again.
   */
  async #events(now: Date): Promise<LiveEvent[]> {
    if (this.#schedule && now.getTime() - this.#schedule.at < SCHEDULE_TTL_MS) {
      return this.#schedule.events;
    }
    const schedule = await this.#deps.source.fetchSchedule().catch((error: unknown) => {
      this.#log(`schedule: ${String(error)}`);
      return null;
    });
    if (schedule?.events.length) {
      this.#schedule = { events: schedule.events, at: now.getTime() };
      this.#deps.store.pruneProgress(schedule.events.map(event => event.slug));
    }
    return this.#schedule?.events ?? [];
  }

  /** Drops cached rounds of events that are no longer live. */
  #evictExcept(live: ReadonlySet<string>): void {
    for (const key of this.#rounds.keys()) {
      if (!live.has(key.slice(0, key.lastIndexOf(':')))) {
        this.#rounds.delete(key);
      }
    }
  }

  /** Drops an event's cached rounds before `from`; no server will look at them again. */
  #evictBefore(slug: string, from: number): void {
    let number = from - 1;
    while (this.#rounds.delete(`${slug}:${number}`)) {
      number -= 1;
    }
  }

  /** `hash` is the index hash for the current round, `null` for a past one. */
  async #round(slug: string, number: number, hash: string | null): Promise<LiveRound | null> {
    const key = `${slug}:${number}`;
    const cached = this.#rounds.get(key);
    if (cached?.hash === hash) {
      return cached.round;
    }
    const round = await this.#deps.source.fetchRound(slug, number);
    if (round) {
      this.#rounds.set(key, { hash, round });
      this.#deps.directory.addRound(round);
    }
    return round;
  }

  async #tickEvent(event: LiveEvent, subscribers: readonly Subscriber[]): Promise<void> {
    const index = await this.#deps.source.fetchIndex(event.slug);
    if (!index) {
      return;
    }
    // Fetched whoever is following, so newcomers can be found to follow.
    await this.#round(event.slug, index.round, index.hash);
    const tracked = this.#tracked(event.slug, index, subscribers);
    if (tracked.length === 0) {
      return;
    }
    const earliest = Math.min(...tracked.map(t => t.progress.resultsDone));
    this.#evictBefore(event.slug, earliest);
    const view = await this.#view(event.slug, index, earliest);
    for (const entry of tracked) {
      await this.#deliver(event.slug, entry, plan(view, entry.subscriber.follows, entry.progress));
    }
  }

  #tracked(slug: string, index: LiveIndex, subscribers: readonly Subscriber[]): Tracked[] {
    const tracked: Tracked[] = [];
    for (const subscriber of subscribers) {
      if (this.#deps.store.hushed(subscriber.guildId).has(slug)) {
        continue;
      }
      let progress = this.#deps.store.progress(subscriber.guildId, slug);
      if (!progress) {
        progress = initialProgress(index);
        this.#deps.store.saveProgress(subscriber.guildId, slug, progress);
      }
      if (!isFinished(index, progress)) {
        tracked.push({ subscriber, progress });
      }
    }
    return tracked;
  }

  /** The rounds from the one before the earliest unreported (for spotting Day 2) up to the current one. */
  async #view(slug: string, index: LiveIndex, resultsDone: number): Promise<EventView> {
    const rounds = new Map<number, LiveRound>();
    for (let number = Math.max(1, resultsDone); number <= index.round; number += 1) {
      const round = await this.#round(slug, number, number === index.round ? index.hash : null);
      if (round) {
        rounds.set(number, round);
      }
    }
    // Decks only add archetypes to the messages; they are not worth holding the round back for.
    const decks = await this.#deps.source.fetchDecks(slug).catch((error: unknown) => {
      this.#log(`${slug} decks: ${String(error)}`);
      return {};
    });
    return { slug, index, rounds, decks };
  }

  /** Sends in order, saving after each step; stops at the first failure so nothing goes out of order. */
  async #deliver(slug: string, { subscriber, progress }: Tracked, steps: readonly Step[]): Promise<void> {
    try {
      for (const step of steps) {
        await this.#apply(subscriber, progress, step);
        this.#deps.store.saveProgress(subscriber.guildId, slug, progress);
      }
    } catch (error) {
      this.#log(`${slug} for guild ${subscriber.guildId}: ${String(error)}`);
    }
  }

  async #apply(subscriber: Subscriber, progress: Progress, step: Step): Promise<void> {
    if (step.kind === 'advance') {
      progress.resultsDone = step.round;
      return;
    }
    const { sender } = this.#deps;
    const sent = progress.messages[step.key];
    if (sent && (await sender.edit(sent.channelId, sent.messageId, step.payload))) {
      sent.body = step.body;
      return;
    }
    const messageId = await sender.post(subscriber.channelId, step.payload);
    progress.messages[step.key] = { channelId: subscriber.channelId, messageId, body: step.body };
  }
}
