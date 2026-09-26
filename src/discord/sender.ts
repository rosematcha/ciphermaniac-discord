import { type Client, DiscordAPIError, RESTJSONErrorCodes, type SendableChannels } from 'discord.js';

import type { Sender } from '../tracker/runner.ts';

/** A channel or message someone deleted: post afresh rather than retry forever. */
const GONE: readonly number[] = [RESTJSONErrorCodes.UnknownMessage, RESTJSONErrorCodes.UnknownChannel];

async function sendable(client: Client, channelId: string): Promise<SendableChannels> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`channel ${channelId} cannot be posted in`);
  }
  return channel;
}

export function discordSender(client: Client): Sender {
  return {
    async post(channelId, payload) {
      const message = await (await sendable(client, channelId)).send(payload);
      return message.id;
    },
    async edit(channelId, messageId, payload) {
      try {
        await (await sendable(client, channelId)).messages.edit(messageId, payload);
        return true;
      } catch (error) {
        if (error instanceof DiscordAPIError && typeof error.code === 'number' && GONE.includes(error.code)) {
          return false;
        }
        throw error;
      }
    }
  };
}
