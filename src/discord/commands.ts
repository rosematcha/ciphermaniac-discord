import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder
} from 'discord.js';

import { foldName } from '../live/fold.ts';
import type { LiveEvent } from '../live/types.ts';
import type { Follow } from '../tracker/follows.ts';
import { canManage, type Context, followLabel, listFollows, MAX_FOLLOWS, NOT_ALLOWED } from './context.ts';
import { startSetup } from './onboarding.ts';

const CHOICE_MAX = 100;
const PREFERRED_MAX = 60;

export const commandData = [
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Choose the updates channel and the players to follow')
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('follow')
    .setDescription('Follow a player at every event they play')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('player').setDescription('Player name').setRequired(true).setAutocomplete(true).setMaxLength(CHOICE_MAX)
    ),
  new SlashCommandBuilder()
    .setName('unfollow')
    .setDescription('Stop following a player')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('player').setDescription('Player name').setRequired(true).setAutocomplete(true).setMaxLength(CHOICE_MAX)
    ),
  new SlashCommandBuilder()
    .setName('preferred-name')
    .setDescription('Set what this server calls a followed player; leave the name out to clear it')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('player').setDescription('Followed player').setRequired(true).setAutocomplete(true).setMaxLength(CHOICE_MAX)
    )
    .addStringOption(option => option.setName('name').setDescription('Name to use').setMaxLength(PREFERRED_MAX)),
  new SlashCommandBuilder()
    .setName('following')
    .setDescription('List the players this server follows')
    .setContexts(InteractionContextType.Guild),
  new SlashCommandBuilder()
    .setName('hush')
    .setDescription("Stop updates from this weekend's events; the next event is reported as usual")
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('event').setDescription('Only this event; leave out to hush every live one').setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName('unhush')
    .setDescription('Resume updates from a hushed event')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(option =>
      option.setName('event').setDescription('Only this event; leave out to resume every live one').setAutocomplete(true)
    )
].map(command => command.toJSON());

/** A suggestion's value carries the country, so picking one follows that exact player. */
function choiceValue(follow: Follow): string {
  return `${follow.name}|${follow.country}`;
}

function parseChoice(value: string, context: Context): Follow {
  const picked = /^(.+)\|([A-Z]{0,3})$/.exec(value);
  if (!picked?.[1]) {
    return context.directory.resolve(value);
  }
  return { nameKey: foldName(picked[1]), name: picked[1], country: picked[2] ?? '' };
}

function choice(label: string, value: string): { name: string; value: string } {
  return { name: label.slice(0, CHOICE_MAX), value: value.slice(0, CHOICE_MAX) };
}

function ephemeral(content: string) {
  return { content, flags: MessageFlags.Ephemeral } as const;
}

async function follow(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  if (!canManage(interaction, context)) {
    await interaction.reply(NOT_ALLOWED);
    return;
  }
  const { store } = context;
  if (store.follows(interaction.guildId).length >= MAX_FOLLOWS) {
    await interaction.reply(ephemeral(`This server already follows ${MAX_FOLLOWS} players. Unfollow someone first.`));
    return;
  }
  const player = parseChoice(interaction.options.getString('player', true), context);
  store.follow(interaction.guildId, player);
  // Read back, so a follow that already had a preferred name is confirmed under it.
  const stored = store.follows(interaction.guildId).find(f => f.nameKey === player.nameKey) ?? player;
  const hint = store.channelFor(interaction.guildId) ? '' : ' Run /setup to choose where updates go.';
  await interaction.reply(ephemeral(`Following ${followLabel(stored)}.${hint}`));
}

async function unfollow(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  if (!canManage(interaction, context)) {
    await interaction.reply(NOT_ALLOWED);
    return;
  }
  const target = await followedTarget(interaction, context);
  if (target) {
    context.store.unfollow(interaction.guildId, target.nameKey);
    await interaction.reply(ephemeral(`Stopped following ${followLabel(target)}.`));
  }
}

/** The followed player a `player` option names, or null after saying the server doesn't follow them. */
async function followedTarget(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<Follow | null> {
  const value = interaction.options.getString('player', true);
  const follows = context.store.follows(interaction.guildId);
  const target = follows.find(f => f.nameKey === value) ?? follows.find(f => f.nameKey === context.directory.resolve(value).nameKey);
  if (!target) {
    await interaction.reply(ephemeral(`This server doesn't follow ${value}.`));
  }
  return target ?? null;
}

async function preferredName(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  if (!canManage(interaction, context)) {
    await interaction.reply(NOT_ALLOWED);
    return;
  }
  const target = await followedTarget(interaction, context);
  if (!target) {
    return;
  }
  const name = interaction.options.getString('name')?.trim().replace(/\s+/g, ' ') ?? '';
  context.store.setPreferredName(interaction.guildId, target.nameKey, name || null);
  // Only ever the name being set: the published one may be a name the player no longer uses.
  const reply = name ? `Updates in this server will now say ${name}.` : `Updates in this server will now use ${target.name}.`;
  await interaction.reply(ephemeral(reply));
}

async function following(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  const follows = context.store.follows(interaction.guildId);
  const channelId = context.store.channelFor(interaction.guildId);
  const where = channelId ? `Updates go to <#${channelId}>.` : 'No updates channel yet: run /setup.';
  const list = follows.length > 0 ? listFollows(follows, '\n') : 'Not following anyone yet.';
  await interaction.reply(ephemeral(`${where}\n\n${list}`));
}

/** The live events an `event` option names, all of them when it is left out; empty after saying why. */
async function pickedEvents(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<LiveEvent[]> {
  const live = context.liveEvents();
  const slug = interaction.options.getString('event');
  const picked = slug ? live.filter(event => event.slug === slug) : live;
  if (picked.length === 0) {
    await interaction.reply(ephemeral(slug ? `${slug} isn't live right now.` : 'No events are live right now.'));
  }
  return picked;
}

function eventNames(events: readonly LiveEvent[]): string {
  return events.map(event => event.name).join(', ');
}

async function hush(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  if (!canManage(interaction, context)) {
    await interaction.reply(NOT_ALLOWED);
    return;
  }
  const events = await pickedEvents(interaction, context);
  if (events.length > 0) {
    events.forEach(event => context.store.hush(interaction.guildId, event.slug));
    await interaction.reply(ephemeral(`Hushed ${eventNames(events)} in this server. /unhush resumes it.`));
  }
}

async function unhush(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  if (!canManage(interaction, context)) {
    await interaction.reply(NOT_ALLOWED);
    return;
  }
  const events = await pickedEvents(interaction, context);
  if (events.length > 0) {
    events.forEach(event => context.store.unhush(interaction.guildId, event.slug));
    await interaction.reply(ephemeral(`Resumed ${eventNames(events)}, from the current round.`));
  }
}

const handlers: Record<string, (interaction: ChatInputCommandInteraction<'cached'>, context: Context) => Promise<void>> = {
  setup: startSetup,
  follow,
  unfollow,
  'preferred-name': preferredName,
  following,
  hush,
  unhush
};

export async function handleCommand(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  await handlers[interaction.commandName]?.(interaction, context);
}

/** The server's follows, matched on the name it shows as well as the published one. */
function followChoices(query: string, follows: readonly Follow[]): { name: string; value: string }[] {
  const folded = foldName(query);
  return follows
    .filter(f => f.nameKey.includes(folded) || foldName(f.preferredName ?? '').includes(folded))
    .slice(0, 25)
    .map(f => choice(followLabel(f), f.nameKey));
}

/** Suggestions from the player index, shown under this server's preferred name for anyone it already follows. */
function playerChoices(query: string, follows: readonly Follow[], context: Context): { name: string; value: string }[] {
  const followed = new Map(follows.map(f => [f.nameKey, f]));
  return context.directory.search(query).map(f => choice(followLabel(followed.get(f.nameKey) ?? f), choiceValue(f)));
}

function eventChoices(query: string, context: Context): { name: string; value: string }[] {
  const folded = foldName(query);
  return context
    .liveEvents()
    .filter(event => foldName(event.name).includes(folded))
    .slice(0, 25)
    .map(event => choice(event.name, event.slug));
}

type Suggest = (query: string, interaction: AutocompleteInteraction<'cached'>, context: Context) => { name: string; value: string }[];

const suggestFollowed: Suggest = (query, interaction, context) => followChoices(query, context.store.follows(interaction.guildId));

const suggesters: Record<string, Suggest> = {
  follow: (query, interaction, context) => playerChoices(query, context.store.follows(interaction.guildId), context),
  unfollow: suggestFollowed,
  'preferred-name': suggestFollowed,
  hush: (query, _interaction, context) => eventChoices(query, context),
  unhush: (query, _interaction, context) => eventChoices(query, context)
};

export async function handleAutocomplete(interaction: AutocompleteInteraction<'cached'>, context: Context): Promise<void> {
  const suggest = suggesters[interaction.commandName] ?? suggestFollowed;
  await interaction.respond(suggest(interaction.options.getFocused(), interaction, context));
}
