import { seatKey } from '../live/fold.ts';
import { eventUrl } from '../live/source.ts';
import type { LiveRound, LiveSeat } from '../live/types.ts';
import type { FollowedSeat } from './follows.ts';
import type { Milestone } from './milestones.ts';

/** Marigold, ciphermaniac's dark-mode accent. */
const COLOR = 0xeeaa11;
/** Under Discord's 4096 so the overflow line always fits. */
const MAX_DESCRIPTION = 3900;

interface Embed {
  title: string;
  url: string;
  description: string;
  color: number;
}

/** A message body as Discord's API takes it. Mentions are off: player names are not pings. */
export interface MessagePayload {
  embeds: Embed[];
  allowedMentions: { parse: [] };
}

export interface RenderContext {
  slug: string;
  eventName: string;
  round: LiveRound;
  decks: Readonly<Record<string, string>>;
}

function escape(text: string): string {
  return text.replace(/([\\*_~`|>[\]])/g, '\\$1');
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
function opponentText(seat: LiveSeat, decks: RenderContext['decks']): string {
  const deck = decks[seatKey(seat)];
  return deck ? `${escape(seat.name)} (${escape(deck)})` : escape(seat.name);
}

/** Joins lines up to the length Discord allows, then says how many were left out. */
function describe(lines: readonly string[]): string {
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > MAX_DESCRIPTION) {
      kept.push(`and ${lines.length - kept.length} more`);
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  return kept.join('\n');
}

function payload(context: RenderContext, title: string, lines: readonly string[]): MessagePayload {
  return {
    embeds: [
      {
        title: `${context.eventName} · ${title}`,
        url: eventUrl(context.slug),
        description: describe(lines),
        color: COLOR
      }
    ],
    allowedMentions: { parse: [] }
  };
}

function followedText(entry: FollowedSeat, withRecord: boolean): string {
  const name = `**${escape(entry.seat.name)}**`;
  return withRecord ? `${name} (${enteringRecord(entry.seat)})` : name;
}

function pairingLine(entry: FollowedSeat, followed: ReadonlySet<LiveSeat>, context: RenderContext): string {
  const withRecord = !context.round.topCut;
  const player = followedText(entry, withRecord);
  const { opponent } = entry;
  if (!opponent) {
    return entry.seat.result === 'win' ? `${player} has a bye` : `${player} is unpaired`;
  }
  const other = followed.has(opponent)
    ? `**${escape(opponent.name)}**`
    : opponentText(opponent, context.decks);
  const table = entry.match.table > 0 ? `Table ${entry.match.table} · ` : '';
  return `${table}${player} vs ${other}`;
}

/** Pairings for the followed players, one line a match: two followed players at one table share it. */
export function renderPairings(entries: readonly FollowedSeat[], context: RenderContext): MessagePayload {
  const followed = new Set(entries.map(entry => entry.seat));
  const shown = new Set<FollowedSeat['match']>();
  const lines: string[] = [];
  for (const entry of entries) {
    if (!shown.has(entry.match)) {
      shown.add(entry.match);
      lines.push(pairingLine(entry, followed, context));
    }
  }
  return payload(context, `${roundLabel(context.round)} pairings`, lines);
}

const VERBS = { win: 'beat', loss: 'lost to', tie: 'tied with' } as const;

function resultPhrase(entry: FollowedSeat, context: RenderContext): string {
  const { opponent, seat } = entry;
  if (!opponent) {
    return seat.result === 'win' ? 'had a bye' : 'took an unpaired loss';
  }
  const against = opponentText(opponent, context.decks);
  return seat.result ? `${VERBS[seat.result]} ${against}` : `played ${against}, no result posted`;
}

function resultLine(entry: FollowedSeat, context: RenderContext): string {
  const parts = [`**${escape(entry.seat.name)}** ${resultPhrase(entry, context)}`];
  if (!context.round.topCut) {
    parts.push(record(entry.seat));
  }
  if (entry.seat.dropped) {
    parts.push('dropped');
  }
  return parts.join(' · ');
}

export function renderResults(entries: readonly FollowedSeat[], context: RenderContext): MessagePayload {
  return payload(
    context,
    `${roundLabel(context.round)} results`,
    entries.map(entry => resultLine(entry, context))
  );
}

/** Followed players who made Day 2 or the top cut, with the record that got them there. */
export function renderMilestone(
  milestone: Milestone,
  entries: readonly FollowedSeat[],
  context: RenderContext
): MessagePayload {
  const title = milestone.kind === 'day2' ? 'Day 2' : `Top ${milestone.size}`;
  const lines = entries.map(entry => `**${escape(entry.seat.name)}** advanced at ${enteringRecord(entry.seat)}`);
  return payload(context, title, lines);
}
