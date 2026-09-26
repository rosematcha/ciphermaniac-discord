import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client, Events, GatewayIntentBits } from 'discord.js';

import { commandData } from './discord/commands.ts';
import type { Context } from './discord/context.ts';
import { handleInteraction, welcome } from './discord/interactions.ts';
import { discordSender } from './discord/sender.ts';
import { fetchDecks, fetchIndex, fetchPlayerIndex, fetchRound, fetchSchedule } from './live/source.ts';
import { Directory } from './players/directory.ts';
import { Store } from './store/store.ts';
import { Runner } from './tracker/runner.ts';

const TICK_MS = 60_000;
const DIRECTORY_MS = 12 * 3_600_000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/** Runs `task` every `intervalMs` from the end of the last run, so runs never overlap. */
async function every(intervalMs: number, task: () => Promise<void>, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await task().catch((error: unknown) => {
      console.error(error);
    });
    await sleep(intervalMs, undefined, { signal }).catch(() => undefined);
  }
}

async function loadDirectory(directory: Directory): Promise<void> {
  const index = await fetchPlayerIndex();
  if (index) {
    directory.loadIndex(index);
    console.log(`player index: ${index.names.length} players`);
  }
}

const databasePath = process.env.DATABASE_PATH ?? 'data/bot.db';
mkdirSync(dirname(databasePath), { recursive: true });
const store = new Store(databasePath);
const directory = new Directory();
const context: Context = { store, directory, ownerId: process.env.OWNER_ID ?? '' };
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const stop = new AbortController();

client.once(Events.ClientReady, ready => {
  console.log(`logged in as ${ready.user.tag} in ${ready.guilds.cache.size} servers`);
  void ready.application.commands.set(commandData).catch((error: unknown) => {
    console.error('registering commands:', error);
  });
  const runner = new Runner({
    source: { fetchSchedule, fetchIndex, fetchRound, fetchDecks },
    sender: discordSender(ready),
    store,
    directory
  });
  void every(DIRECTORY_MS, () => loadDirectory(directory), stop.signal);
  void every(TICK_MS, () => runner.tick(), stop.signal);
});

client.on(Events.GuildCreate, guild => {
  if (store.channelFor(guild.id)) {
    return;
  }
  welcome(guild).catch((error: unknown) => {
    console.error(`welcoming ${guild.id}:`, error);
  });
});

client.on(Events.GuildDelete, guild => {
  store.removeGuild(guild.id);
});

client.on(Events.InteractionCreate, interaction => {
  void handleInteraction(interaction, context);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stop.abort();
    void client.destroy().finally(() => {
      store.close();
      process.exit(0);
    });
  });
}

await client.login(requireEnv('DISCORD_TOKEN'));
