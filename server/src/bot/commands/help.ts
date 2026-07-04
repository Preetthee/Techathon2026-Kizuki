import { Message } from 'discord.js';
import { buildHelpEmbed } from '../utils/embeds';
import type { CommandContext } from './registry';

export const helpCommand = {
  name:        'help',
  aliases:     ['h', '?', 'commands'],
  description: 'List all available commands.',

  async execute(_args: string[], message: Message, ctx: CommandContext): Promise<void> {
    await ctx.uniqueReply(message, { embeds: [buildHelpEmbed(ctx.prefix)] });
  },
};
