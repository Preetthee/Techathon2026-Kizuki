import { Message } from 'discord.js';
import { api } from '../utils/api';
import { buildUsageEmbed, buildErrorEmbed } from '../utils/embeds';
import type { CommandContext } from './registry';

export const usageCommand = {
  name:        'usage',
  aliases:     ['u', 'power', 'watts'],
  description: 'Show live power consumption totals and per-room breakdown.',

  async execute(_args: string[], message: Message, ctx: CommandContext): Promise<void> {
    const reply = (payload: unknown) => ctx.uniqueReply(message, payload);
    const typing = (message.channel as unknown as { sendTyping: () => Promise<void> }).sendTyping();

    try {
      const usage = await api.usage();
      await typing;
      await reply({ embeds: [buildUsageEmbed(usage)] });
    } catch (err: any) {
      await typing;
      await reply({ embeds: [buildErrorEmbed(`Could not fetch usage data.\n\`${err.message}\``)] });
    }
  },
};
