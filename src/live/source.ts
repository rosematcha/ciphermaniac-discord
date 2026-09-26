import type { LiveEvent, LiveIndex, LiveReports, LiveRound, LiveSchedule } from './types.ts';

const BASE = 'https://r2.ciphermaniac.com';
const USER_AGENT = 'ciphermaniac-discord (+https://github.com/rosematcha/ciphermaniac-discord)';
const TIMEOUT_MS = 30_000;
const HOUR = 3_600_000;

/** Null for a file that does not exist yet; throws on anything else that is not a 200. */
async function fetchOptional<T>(path: string): Promise<T | null> {
  const response = await fetch(`${BASE}/${path}`, {
    headers: { 'User-Agent': USER_AGENT },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

export function fetchSchedule(): Promise<LiveSchedule | null> {
  return fetchOptional<LiveSchedule>('live/v1/schedule.json');
}

export function fetchIndex(slug: string): Promise<LiveIndex | null> {
  return fetchOptional<LiveIndex>(`live/v1/${encodeURIComponent(slug)}/index.json`);
}

export function fetchRound(slug: string, round: number): Promise<LiveRound | null> {
  return fetchOptional<LiveRound>(`live/v1/${encodeURIComponent(slug)}/r${round}.json`);
}

export async function fetchDecks(slug: string): Promise<Record<string, string>> {
  const reports = await fetchOptional<LiveReports>(`live/v1/${encodeURIComponent(slug)}/reports.json`);
  return reports?.decks ?? {};
}

export interface PlayerIndex {
  names: string[];
  countries: string[];
  eventCounts: number[];
}

export function fetchPlayerIndex(): Promise<PlayerIndex | null> {
  return fetchOptional<PlayerIndex>('players/index-slim.json');
}

/**
 * The poller's window: the listed days with a day either side, so no time zone
 * is cut short. Same as ciphermaniac's `isEventLive`.
 */
export function isEventLive(event: LiveEvent, now: Date): boolean {
  const first = Date.parse(`${event.firstDay}T00:00:00Z`);
  const last = Date.parse(`${event.lastDay}T00:00:00Z`);
  return now.getTime() >= first - 24 * HOUR && now.getTime() < last + 48 * HOUR;
}

export function eventUrl(slug: string): string {
  return `https://ciphermaniac.com/live/${encodeURIComponent(slug)}`;
}
