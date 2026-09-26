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
  /** Rounds by `{slug}:{round}`. A past round never changes; the current one is refetched when the index hash moves. */
  readonly #rounds = new Map<string, CachedRound>();

  constructor(deps: RunnerDeps) {
    this.#deps = deps;
    this.#log = deps.log ?? console.log;
  }

  async tick(now = new Date()): Promise<void> {
    const events = await this.#events(now);
    const subscribers = this.#deps.store.subscribers();
    for (const event of events.filter(e => isEventLive(e, now))) {
      try {
        await this.#tickEvent(event, subscribers);
      } catch (error) {
        this.#log(`${event.slug}: ${String(error)}`);
      }
    }
  }

  async #events(now: Date): Promise<LiveEvent[]> {
    if (!this.#schedule || now.getTime() - this.#schedule.at >= SCHEDULE_TTL_MS) {
      const schedule = await this.#deps.source.fetchSchedule();
      this.#schedule = { events: schedule?.events ?? [], at: now.getTime() };
      this.#deps.store.pruneProgress(this.#schedule.events.map(event => event.slug));
    }
    return this.#schedule.events;
  }

  async #round(slug: string, number: number, hash: string | null): Promise<LiveRound | null> {
    const key = `${slug}:${number}`;
    const cached = this.#rounds.get(key);
    if (cached && (hash === null || cached.hash === hash)) {
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
    const view = await this.#view(event.slug, index, Math.min(...tracked.map(t => t.progress.resultsDone)));
    for (const entry of tracked) {
      await this.#deliver(event.slug, entry, plan(view, entry.subscriber.follows, entry.progress));
    }
  }

  #tracked(slug: string, index: LiveIndex, subscribers: readonly Subscriber[]): Tracked[] {
    const tracked: Tracked[] = [];
    for (const subscriber of subscribers) {
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
    return { slug, index, rounds, decks: await this.#deps.source.fetchDecks(slug) };
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
