/**
 * Messages as Discord shows them: a bold header line, then one small embed per
 * followed player, its side bar coloured by how their round went. Discord allows
 * ten embeds a message, so a long list of players runs over several messages.
 */

import { displayName } from '../live/aliases.ts';
import { seatKey } from '../live/fold.ts';
import type { LiveResult, LiveRound, LiveSeat } from '../live/types.ts';
import type { FollowedSeat } from './follows.ts';
import type { Milestone } from './milestones.ts';

/** Ciphermaniac's dark-mode marigold, for a round still being played. */
const ACCENT = 0xeeaa11;
/** Discord's own green, red and grey. */
const COLORS: Record<LiveResult | 'none', number> = { win: 0x23a55a, loss: 0xf23f43, tie: 0x80848e, none: 0x80848e };
const EMBEDS_PER_MESSAGE = 10;

interface Embed {
  title: string;
  description: string;
  color: number;
}

/** A message body as Discord's API takes it. Mentions are off: player names are not pings. */
export interface MessagePayload {
  content: string;
  embeds: Embed[];
  allowedMentions: { parse: [] };
}

export interface RenderContext {
  slug: string;
  eventName: string;
  round: LiveRound;
  decks: Readonly<Record<string, string>>;
  /** Names for the server's followed seats, which may be preferred names; anyone else goes by `displayName`. */
  labels: ReadonlyMap<LiveSeat, string>;
}

function nameOf(seat: LiveSeat, context: RenderContext): string {
  return escape(context.labels.get(seat) ?? displayName(seat));
}

function escape(text: string): string {
  return text.replace(/([\\*_~`|>[\]])/g, '\\$1');
}

/** "Frankfurt" for "Frankfurt Regional Championships", or the whole name if that leaves nothing. */
function shortName(eventName: string): string {
  return eventName.replace(/\s*\b(?:Regional|International|World)?\s*Championships$/i, '').trim() || eventName;
}

function record(seat: LiveSeat): string {
  return `${seat.wins}-${seat.losses}-${seat.ties}`;
}

/** The record a player sat down with: RK9 counts a result into the record as soon as it is in. */
function enteringRecord(seat: LiveSeat): string {
  const { result } = seat;
  return record({
    ...seat,
    wins: seat.wins - (result === 'win' ? 1 : 0),
    losses: seat.losses - (result === 'loss' ? 1 : 0),
    ties: seat.ties - (result === 'tie' ? 1 : 0)
  });
}

function roundLabel(round: LiveRound): string {
  if (!round.topCut) {
    return `Round ${round.round}`;
  }
  const players = round.matches.length * 2;
  return players === 2 ? 'Finals' : `Top ${players}`;
}

/** An opponent, with the deck ciphermaniac shows for them if it knows one. */
function opponentText(seat: LiveSeat, context: RenderContext): string {
  const deck = context.decks[seatKey(seat)];
  const name = nameOf(seat, context);
  return deck ? `${name} (${escape(deck)})` : name;
}

/** A player's name, with a record unless the round is top cut, where records are frozen. */
function playerTitle(seat: LiveSeat, context: RenderContext, shown: string): string {
  const name = nameOf(seat, context);
  return context.round.topCut ? name : `${name} · ${shown}`;
}

/** The header on the first message and the embeds, split into as many messages as Discord needs. */
function messages(header: string, embeds: readonly Embed[]): MessagePayload[] {
  const payloads: MessagePayload[] = [];
  for (let start = 0; start < embeds.length; start += EMBEDS_PER_MESSAGE) {
    payloads.push({
      content: start === 0 ? header : '',
      embeds: embeds.slice(start, start + EMBEDS_PER_MESSAGE),
      allowedMentions: { parse: [] }
    });
  }
  return payloads;
}

function header(context: RenderContext, title: string): string {
  return `**${escape(`${shortName(context.eventName)} · ${title}`)}**`;
}

function pairingText(entry: FollowedSeat, context: RenderContext): string {
  const { opponent, seat } = entry;
  if (!opponent) {
    return seat.result === 'win' ? 'Bye' : 'Unpaired';
  }
  const table = entry.match.table > 0 ? `Table ${entry.match.table} vs ` : 'vs ';
  return `${table}${opponentText(opponent, context)}`;
}

export function renderPairings(entries: readonly FollowedSeat[], context: RenderContext): MessagePayload[] {
  const embeds = entries.map(entry => ({
    title: playerTitle(entry.seat, context, enteringRecord(entry.seat)),
    description: pairingText(entry, context),
    color: ACCENT
  }));
  return messages(header(context, roundLabel(context.round)), embeds);
}

const WORDS = { win: 'Won', loss: 'Lost', tie: 'Tied' } as const;

function resultText(entry: FollowedSeat, context: RenderContext): string {
  const { opponent, seat } = entry;
  if (!opponent) {
    return seat.result === 'win' ? 'Bye' : 'Unpaired loss';
  }
  const against = opponentText(opponent, context);
  return seat.result ? `${WORDS[seat.result]} vs ${against}` : `No result posted vs ${against}`;
}

export function renderResults(entries: readonly FollowedSeat[], context: RenderContext): MessagePayload[] {
  const embeds = entries.map(entry => ({
    title: playerTitle(entry.seat, context, record(entry.seat)),
    description: entry.seat.dropped ? `${resultText(entry, context)} · dropped` : resultText(entry, context),
    color: COLORS[entry.seat.result ?? 'none']
  }));
  return messages(header(context, `${roundLabel(context.round)} results`), embeds);
}

/** Followed players who made Day 2 or the top cut, with the record that got them there. */
export function renderMilestone(
  milestone: Milestone,
  entries: readonly FollowedSeat[],
  context: RenderContext
): MessagePayload[] {
  const title = milestone.kind === 'day2' ? 'Day 2' : `Top ${milestone.size}`;
  const embeds = entries.map(entry => ({
    title: `${nameOf(entry.seat, context)} · ${enteringRecord(entry.seat)}`,
    description: title,
    color: COLORS.win
  }));
  return messages(header(context, title), embeds);
}
