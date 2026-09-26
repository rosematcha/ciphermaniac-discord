/**
 * Server settings, follows and per-event progress, in SQLite.
 *
 * Everything is keyed by server: follows are not tied to an event, so a player
 * followed today is reported at every event they play from then on.
 */

import { DatabaseSync } from 'node:sqlite';

import type { Follow } from '../tracker/follows.ts';
import type { Progress } from '../tracker/plan.ts';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS follows (
    guild_id TEXT NOT NULL,
    name_key TEXT NOT NULL,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    PRIMARY KEY (guild_id, name_key)
  );
  CREATE TABLE IF NOT EXISTS progress (
    guild_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    state TEXT NOT NULL,
    PRIMARY KEY (guild_id, slug)
  );
`;

export interface Subscriber {
  guildId: string;
  channelId: string;
  follows: Follow[];
}

interface FollowRow {
  guild_id: string;
  name_key: string;
  name: string;
  country: string;
  preferred_name: string | null;
}

function toFollow(row: FollowRow): Follow {
  const follow: Follow = { nameKey: row.name_key, name: row.name, country: row.country };
  return row.preferred_name ? { ...follow, preferredName: row.preferred_name } : follow;
}

export class Store {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec(SCHEMA);
    this.#migrate();
  }

  /** Columns added after the first release, for databases created before them. */
  #migrate(): void {
    const columns = this.#db.prepare('PRAGMA table_info(follows)').all() as unknown as { name: string }[];
    if (!columns.some(column => column.name === 'preferred_name')) {
      this.#db.exec('ALTER TABLE follows ADD COLUMN preferred_name TEXT');
    }
  }

  close(): void {
    this.#db.close();
  }

  setChannel(guildId: string, channelId: string): void {
    this.#db
      .prepare('INSERT INTO guilds (guild_id, channel_id) VALUES (?, ?) ON CONFLICT (guild_id) DO UPDATE SET channel_id = excluded.channel_id')
      .run(guildId, channelId);
  }

  channelFor(guildId: string): string | null {
    const row = this.#db.prepare('SELECT channel_id FROM guilds WHERE guild_id = ?').get(guildId) as
      | { channel_id: string }
      | undefined;
    return row?.channel_id ?? null;
  }

  /** Forgets a server entirely, for when the bot is removed from it. */
  removeGuild(guildId: string): void {
    for (const table of ['guilds', 'follows', 'progress']) {
      this.#db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId);
    }
  }

  /** Adds or updates a follow; false if it was already there unchanged. */
  follow(guildId: string, follow: Follow): boolean {
    const result = this.#db
      .prepare(
        `INSERT INTO follows (guild_id, name_key, name, country) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, name_key) DO UPDATE SET name = excluded.name, country = excluded.country
         WHERE name <> excluded.name OR country <> excluded.country`
      )
      .run(guildId, follow.nameKey, follow.name, follow.country);
    return result.changes > 0;
  }

  /** Sets what this server calls a followed player, or clears it with null; false if they are not followed. */
  setPreferredName(guildId: string, nameKey: string, preferredName: string | null): boolean {
    return (
      this.#db
        .prepare('UPDATE follows SET preferred_name = ? WHERE guild_id = ? AND name_key = ?')
        .run(preferredName, guildId, nameKey).changes > 0
    );
  }

  unfollow(guildId: string, nameKey: string): boolean {
    return this.#db.prepare('DELETE FROM follows WHERE guild_id = ? AND name_key = ?').run(guildId, nameKey).changes > 0;
  }

  follows(guildId: string): Follow[] {
    const rows = this.#db
      .prepare('SELECT * FROM follows WHERE guild_id = ? ORDER BY name COLLATE NOCASE')
      .all(guildId) as unknown as FollowRow[];
    return rows.map(toFollow);
  }

  /** Servers with a channel set and at least one follow. */
  subscribers(): Subscriber[] {
    const guilds = this.#db.prepare('SELECT guild_id, channel_id FROM guilds').all() as unknown as {
      guild_id: string;
      channel_id: string;
    }[];
    return guilds
      .map(row => ({ guildId: row.guild_id, channelId: row.channel_id, follows: this.follows(row.guild_id) }))
      .filter(subscriber => subscriber.follows.length > 0);
  }

  progress(guildId: string, slug: string): Progress | null {
    const row = this.#db.prepare('SELECT state FROM progress WHERE guild_id = ? AND slug = ?').get(guildId, slug) as
      | { state: string }
      | undefined;
    return row ? (JSON.parse(row.state) as Progress) : null;
  }

  saveProgress(guildId: string, slug: string, progress: Progress): void {
    this.#db
      .prepare('INSERT INTO progress (guild_id, slug, state) VALUES (?, ?, ?) ON CONFLICT (guild_id, slug) DO UPDATE SET state = excluded.state')
      .run(guildId, slug, JSON.stringify(progress));
  }

  /** Drops progress for events no longer on the schedule. An empty schedule is taken as a bad read and prunes nothing. */
  pruneProgress(scheduled: readonly string[]): void {
    if (scheduled.length === 0) {
      return;
    }
    const placeholders = scheduled.map(() => '?').join(', ');
    this.#db.prepare(`DELETE FROM progress WHERE slug NOT IN (${placeholders})`).run(...scheduled);
  }
}
