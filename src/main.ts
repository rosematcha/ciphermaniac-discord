import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client, Events, GatewayIntentBits } from 'discord.js';

import { commandData } from './discord/commands.ts';
import type { Context } from './discord/context.ts';
import { handleInteraction, welcome } from './discord/interactions.ts';
import { discordSender } from './discord/sender.ts';
import { Alarm, listenForNotices } from './live/notices.ts';
import { fetchDecks, fetchIndex, fetchPlayerIndex, fetchRound, fetchSchedule } from './live/source.ts';
import { Directory } from './players/directory.ts';
import { Store } from './store/store.ts';
import { Runner } from './tracker/runner.ts';

const TICK_MS = 60_000;
/** Looks follow notices at most this often, however many arrive. */
const NOTICE_GAP_MS = 1_000;
const DIRECTORY_MS = 12 * 3_600_000;
const SHUTDOWN_GRACE_MS = 8_000;

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

/** Runs `task` a minute after the last run ended, or sooner on a notice from the poller. */
async function onTickOrNotice(alarm: Alarm, task: () => Promise<void>, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await task().catch((error: unknown) => {
      console.error(error);
    });
    await sleep(NOTICE_GAP_MS, undefined, { signal }).catch(() => undefined);
    await alarm.wait(TICK_MS - NOTICE_GAP_MS, signal);
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
const loops: Promise<void>[] = [];
const alarm = new Alarm();
const noticePort = Number(process.env.NOTICE_PORT ?? '');
const notices =
  Number.isInteger(noticePort) && noticePort > 0
    ? listenForNotices(noticePort, () => {
        alarm.ring();
      })
    : null;

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
  loops.push(
    every(DIRECTORY_MS, () => loadDirectory(directory), stop.signal),
    onTickOrNotice(alarm, () => runner.tick(), stop.signal)
  );
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

/**
 * Lets a tick in flight finish before closing, so a message it has just posted gets its progress saved
 * rather than posted again after the restart. Docker allows ten seconds before it kills the process.
 */
async function shutdown(): Promise<void> {
  stop.abort();
  notices?.close();
  await Promise.race([Promise.all(loops), sleep(SHUTDOWN_GRACE_MS)]);
  await client.destroy();
  store.close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown());
}

await client.login(requireEnv('DISCORD_TOKEN'));
