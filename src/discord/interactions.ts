import { ChannelType, type Guild, type Interaction, MessageFlags, type TextChannel } from 'discord.js';

import { handleAutocomplete, handleCommand } from './commands.ts';
import type { Context } from './context.ts';
import { canPost, handleSetupComponent, welcomeMessage } from './onboarding.ts';

async function route(interaction: Interaction<'cached'>, context: Context): Promise<void> {
  if (interaction.isAutocomplete()) {
    await handleAutocomplete(interaction, context);
  } else if (interaction.isChatInputCommand()) {
    await handleCommand(interaction, context);
  } else if (interaction.isButton() || interaction.isChannelSelectMenu() || interaction.isModalSubmit()) {
    await handleSetupComponent(interaction, context);
  }
}

async function reportFailure(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable() || interaction.replied || interaction.deferred) {
    return;
  }
  await interaction.reply({ content: 'Something went wrong. Try again in a moment.', flags: MessageFlags.Ephemeral });
}

export async function handleInteraction(interaction: Interaction, context: Context): Promise<void> {
  if (!interaction.inCachedGuild()) {
    return;
  }
  try {
    await route(interaction, context);
  } catch (error) {
    console.error(`interaction ${interaction.id}:`, error);
    await reportFailure(interaction).catch(() => undefined);
  }
}

/**
 * On joining a server, posts the setup button in its system channel or the
 * first channel the bot can post in; failing both, tells the owner by DM.
 */
export async function welcome(guild: Guild): Promise<void> {
  const text = guild.channels.cache
    .filter((channel): channel is TextChannel => channel.type === ChannelType.GuildText)
    .sorted((a, b) => a.rawPosition - b.rawPosition);
  const target = [guild.systemChannel, ...text.values()].find(channel => channel && canPost(channel, guild));
  if (target) {
    await target.send(welcomeMessage());
    return;
  }
  const owner = await guild.fetchOwner();
  await owner.send(`Run /setup in ${guild.name} to choose where tournament updates go.`);
}
