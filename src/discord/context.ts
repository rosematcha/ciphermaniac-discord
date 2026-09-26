import { MessageFlags, PermissionFlagsBits } from 'discord.js';

import type { Directory } from '../players/directory.ts';
import type { Store } from '../store/store.ts';
import type { Follow } from '../tracker/follows.ts';

export interface Context {
  store: Store;
  directory: Directory;
  /** A user who can manage the bot in any server, whatever their permissions there. */
  ownerId: string;
}

/** Enough of an interaction to tell who is asking and where. */
interface Asker {
  user: { id: string };
  memberPermissions: { has: (permission: bigint) => boolean } | null;
}

/** Whether the user may change a server's channel and follows: Manage Server, or the bot's owner. */
export function canManage(interaction: Asker, context: Context): boolean {
  const isOwner = context.ownerId !== '' && interaction.user.id === context.ownerId;
  return isOwner || (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false);
}

export const NOT_ALLOWED = {
  content: 'You need Manage Server to change this.',
  flags: MessageFlags.Ephemeral
} as const;

/** Most follows a server can have, so a round's message stays inside Discord's limits. */
export const MAX_FOLLOWS = 100;

export function followLabel(follow: Follow): string {
  const detail = [follow.preferredName ? follow.name : '', follow.country].filter(Boolean).join(', ');
  const name = follow.preferredName ?? follow.name;
  return detail ? `${name} (${detail})` : name;
}

/** Under Discord's 2000-character message limit, with room for the text around the list. */
const LIST_MAX = 1500;

/** The follows as one string, cut short with a count of the rest if it would not fit in a message. */
export function listFollows(follows: readonly Follow[], separator: string, max = LIST_MAX): string {
  let list = '';
  for (const [i, follow] of follows.entries()) {
    const next = list ? `${list}${separator}${followLabel(follow)}` : followLabel(follow);
    if (next.length > max) {
      return `${list}${separator}and ${follows.length - i} more`;
    }
    list = next;
  }
  return list;
}
