/**
 * What a server should be sent about one event, given what it has been sent.
 *
 * Pure: the runner fetches, this decides, the runner sends. Rounds are walked in
 * order from the first one whose results the server has not had, so a server
 * that missed several rounds (a restart, or a top cut RK9 posted all at once)
 * is caught up in order rather than skipped ahead.
 */

import type { LiveIndex, LiveRound } from '../live/types.ts';
import { type Follow, type FollowedSeat, findFollowed } from './follows.ts';
import { milestoneFor } from './milestones.ts';
import { type MessagePayload, type RenderContext, renderMilestone, renderPairings, renderResults } from './render.ts';

export interface SentMessage {
  channelId: string;
  messageId: string;
  /** The payload as last sent, to tell whether an edit is due. */
  body: string;
}

/** A server's progress through one event. */
export interface Progress {
  /** The last round whose results the server has had, or has nothing to hear about. */
  resultsDone: number;
  /** Keyed `r{round}:{pairings|results|milestone}`. */
  messages: Record<string, SentMessage>;
}

export interface EventView {
  slug: string;
  index: LiveIndex;
  rounds: ReadonlyMap<number, LiveRound>;
  decks: Readonly<Record<string, string>>;
}

/** Send (or edit, if the key was sent before) a message, or mark a round's results as done. */
export type Step =
  | { kind: 'send'; key: string; payload: MessagePayload; body: string }
  | { kind: 'advance'; round: number };

/**
 * Where a server starts on an event it has not seen: the current round, so
 * joining mid-event does not replay the rounds before it.
 */
export function initialProgress(index: LiveIndex): Progress {
  return { resultsDone: index.round - 1, messages: {} };
}

/** Whether a server has had everything the event will ever say. */
export function isFinished(index: LiveIndex, progress: Progress): boolean {
  return index.finished === true && progress.resultsDone >= index.round;
}

function send(key: string, payload: MessagePayload): Step & { kind: 'send' } {
  return { kind: 'send', key, payload, body: JSON.stringify(payload) };
}

/** A send for a new message, or an edit of a sent one whose content has changed. */
function sendIfChanged(key: string, payload: MessagePayload, progress: Progress): Step[] {
  const step = send(key, payload);
  return progress.messages[key]?.body === step.body ? [] : [step];
}

function milestoneSteps(view: EventView, round: LiveRound, entries: FollowedSeat[], context: RenderContext, progress: Progress): Step[] {
  const key = `r${round.round}:milestone`;
  const milestone = milestoneFor(round, view.rounds.get(round.round - 1), view.index);
  if (!milestone || key in progress.messages) {
    return [];
  }
  return [send(key, renderMilestone(milestone, entries, context))];
}

interface RoundPlan {
  steps: Step[];
  /** The round's results are settled, so the next round can be looked at. */
  done: boolean;
}

function planRound(view: EventView, round: LiveRound, follows: readonly Follow[], progress: Progress): RoundPlan {
  const isCurrent = round.round === view.index.round;
  const entries = findFollowed(round, follows);
  if (entries.length === 0) {
    return isCurrent ? { steps: [], done: false } : { steps: [{ kind: 'advance', round: round.round }], done: true };
  }
  const context: RenderContext = { slug: view.slug, eventName: view.index.name, round, decks: view.decks };
  const steps = milestoneSteps(view, round, entries, context, progress);
  if (!entries.every(entry => entry.match.complete)) {
    // The poller only moves on from a complete round, so only the current one waits, its pairings kept current meanwhile.
    if (isCurrent) {
      steps.push(...sendIfChanged(`r${round.round}:pairings`, renderPairings(entries, context), progress));
    }
    return { steps, done: false };
  }
  steps.push(send(`r${round.round}:results`, renderResults(entries, context)), { kind: 'advance', round: round.round });
  return { steps, done: true };
}

export function plan(view: EventView, follows: readonly Follow[], progress: Progress): Step[] {
  const steps: Step[] = [];
  for (let number = progress.resultsDone + 1; number <= view.index.round; number += 1) {
    const round = view.rounds.get(number);
    if (!round) {
      break;
    }
    const planned = planRound(view, round, follows, progress);
    steps.push(...planned.steps);
    if (!planned.done) {
      break;
    }
  }
  return steps;
}
