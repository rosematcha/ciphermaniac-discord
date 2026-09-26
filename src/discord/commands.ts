import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder
} from 'discord.js';

import { foldName } from '../live/fold.ts';
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
    .setContexts(InteractionContextType.Guild)
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
  const hint = store.channelFor(interaction.guildId) ? '' : ' Run /setup to choose where updates go.';
  await interaction.reply(ephemeral(`Following ${followLabel(player)}.${hint}`));
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
  const reply = name ? `This server will call ${target.name} ${name}.` : `This server will call ${target.name} by their published name.`;
  await interaction.reply(ephemeral(reply));
}

async function following(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  const follows = context.store.follows(interaction.guildId);
  const channelId = context.store.channelFor(interaction.guildId);
  const where = channelId ? `Updates go to <#${channelId}>.` : 'No updates channel yet: run /setup.';
  const list = follows.length > 0 ? listFollows(follows, '\n') : 'Not following anyone yet.';
  await interaction.reply(ephemeral(`${where}\n\n${list}`));
}

const handlers: Record<string, (interaction: ChatInputCommandInteraction<'cached'>, context: Context) => Promise<void>> = {
  setup: startSetup,
  follow,
  unfollow,
  'preferred-name': preferredName,
  following
};

export async function handleCommand(interaction: ChatInputCommandInteraction<'cached'>, context: Context): Promise<void> {
  await handlers[interaction.commandName]?.(interaction, context);
}

export async function handleAutocomplete(interaction: AutocompleteInteraction<'cached'>, context: Context): Promise<void> {
  const query = interaction.options.getFocused();
  if (interaction.commandName === 'unfollow' || interaction.commandName === 'preferred-name') {
    const folded = foldName(query);
    const follows = context.store.follows(interaction.guildId).filter(f => f.nameKey.includes(folded));
    await interaction.respond(follows.slice(0, 25).map(f => choice(followLabel(f), f.nameKey)));
    return;
  }
  await interaction.respond(context.directory.search(query).map(f => choice(followLabel(f), choiceValue(f))));
}
