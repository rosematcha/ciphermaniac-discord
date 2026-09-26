/**
 * Setting a server up: pick the updates channel, then follow some players.
 *
 * Reached from `/setup` or from the button on the message the bot posts when it
 * joins a server. Every step is ephemeral and checks permission again, since
 * anyone can press the join message's button.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChannelSelectMenuInteraction,
  ChannelSelectMenuBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildBasedChannel,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import { canManage, type Context, listFollows, MAX_FOLLOWS, NOT_ALLOWED } from './context.ts';

const SETUP_IDS = {
  start: 'setup:start',
  channel: 'setup:channel',
  add: 'setup:add',
  players: 'setup:players',
  names: 'setup:names',
  done: 'setup:done'
} as const;

const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

export function canPost(channel: GuildBasedChannel, guild: Guild): boolean {
  const me = guild.members.me;
  return me !== null && (channel.permissionsFor(me).has(NEEDED));
}

function channelStep(context: Context, guildId: string, problem = '') {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(SETUP_IDS.channel)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setPlaceholder('Pick a channel');
  const current = context.store.channelFor(guildId);
  if (current) {
    select.setDefaultChannels(current);
  }
  return {
    content: `${problem}Which channel should tournament updates go to?`,
    components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select)]
  };
}

function playersStep(context: Context, guildId: string) {
  const follows = context.store.follows(guildId);
  const channelId = context.store.channelFor(guildId);
  const list = follows.length > 0 ? `Following: ${listFollows(follows, ', ')}` : 'Not following anyone yet.';
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETUP_IDS.add)
      .setLabel(follows.length > 0 ? 'Add more players' : 'Add players')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(SETUP_IDS.done).setLabel('Finish').setStyle(ButtonStyle.Secondary)
  );
  return { content: `Updates will go to <#${channelId ?? ''}>.\n\n${list}`, components: [buttons] };
}

const playersModal = new ModalBuilder()
  .setCustomId(SETUP_IDS.players)
  .setTitle('Follow players')
  .addLabelComponents(label =>
    label
      .setLabel('Players, one per line')
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId(SETUP_IDS.names)
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Tord Reklev\nEmma Hagen')
          .setRequired(true)
          .setMaxLength(2000)
      )
  );

export async function startSetup(
  interaction: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>,
  context: Context
): Promise<void> {
  if (!canManage(interaction, context)) {
    await interaction.reply(NOT_ALLOWED);
    return;
  }
  await interaction.reply({ ...channelStep(context, interaction.guildId), flags: MessageFlags.Ephemeral });
}

async function pickChannel(interaction: ChannelSelectMenuInteraction<'cached'>, context: Context): Promise<void> {
  const id = interaction.values[0];
  const channel = id ? await interaction.guild.channels.fetch(id) : null;
  if (!channel || !canPost(channel, interaction.guild)) {
    const problem = `I can't post in <#${id ?? ''}>. Give me View Channel, Send Messages and Embed Links there, or pick another.\n\n`;
    await interaction.update(channelStep(context, interaction.guildId, problem));
    return;
  }
  context.store.setChannel(interaction.guildId, channel.id);
  await interaction.update(playersStep(context, interaction.guildId));
}

async function addPlayers(interaction: ModalSubmitInteraction<'cached'>, context: Context): Promise<void> {
  const lines = interaction.fields.getTextInputValue(SETUP_IDS.names).split('\n');
  const room = MAX_FOLLOWS - context.store.follows(interaction.guildId).length;
  const names = [...new Set(lines.map(line => line.trim()).filter(Boolean))].slice(0, Math.max(0, room));
  for (const name of names) {
    context.store.follow(interaction.guildId, context.directory.resolve(name));
  }
  const step = playersStep(context, interaction.guildId);
  await (interaction.isFromMessage() ? interaction.update(step) : interaction.reply({ ...step, flags: MessageFlags.Ephemeral }));
}

async function finish(interaction: ButtonInteraction<'cached'>): Promise<void> {
  await interaction.update({
    content: 'All set. Use /follow and /unfollow to change who is followed, and /setup to change the channel.',
    components: []
  });
}

type Handler = (
  interaction: ButtonInteraction<'cached'> | ChannelSelectMenuInteraction<'cached'> | ModalSubmitInteraction<'cached'>,
  context: Context
) => Promise<void>;

const handlers: Record<string, Handler> = {
  [SETUP_IDS.start]: (i, c) => (i.isButton() ? startSetup(i, c) : Promise.resolve()),
  [SETUP_IDS.channel]: (i, c) => (i.isChannelSelectMenu() ? pickChannel(i, c) : Promise.resolve()),
  [SETUP_IDS.add]: i => (i.isButton() ? i.showModal(playersModal) : Promise.resolve()),
  [SETUP_IDS.players]: (i, c) => (i.isModalSubmit() ? addPlayers(i, c) : Promise.resolve()),
  [SETUP_IDS.done]: i => (i.isButton() ? finish(i) : Promise.resolve())
};

/** Routes a setup component or modal; anyone without permission is turned away first. */
export async function handleSetupComponent(
  interaction: ButtonInteraction<'cached'> | ChannelSelectMenuInteraction<'cached'> | ModalSubmitInteraction<'cached'>,
  context: Context
): Promise<void> {
  const handler = handlers[interaction.customId];
  if (!handler) {
    return;
  }
  if (!canManage(interaction, context)) {
    await interaction.reply(NOT_ALLOWED);
    return;
  }
  await handler(interaction, context);
}

/** The message posted on joining a server, pointing whoever can set the bot up at the button. */
export function welcomeMessage() {
  return {
    content: 'Thanks for adding me. Someone with Manage Server can set me up here.',
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(SETUP_IDS.start).setLabel('Set up').setStyle(ButtonStyle.Primary)
      )
    ]
  };
}
