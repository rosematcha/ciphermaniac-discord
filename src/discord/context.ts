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
  return interaction.user.id === context.ownerId || (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false);
}

export const NOT_ALLOWED = {
  content: 'You need Manage Server to change this.',
  flags: MessageFlags.Ephemeral
} as const;

/** Most follows a server can have, so a round's message stays inside Discord's limits. */
export const MAX_FOLLOWS = 100;

export function followLabel(follow: Follow): string {
  return follow.country ? `${follow.name} (${follow.country})` : follow.name;
}
