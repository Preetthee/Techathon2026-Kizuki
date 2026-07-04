import { Message } from 'discord.js';
import { api } from '../utils/api';
import { buildUsageEmbed, buildErrorEmbed } from '../utils/embeds';
import type { CommandContext } from './registry';

export const usageCommand = {
  name:        'usage',
  aliases:     ['u', 'power', 'watts'],
  description: 'Show live power consumption totals and per-room breakdown.',

  async execute(_args: string[], message: Message, _ctx: CommandContext): Promise<void> {
    const typing = message.channel.sendTyping();

    try {
      const usage = await api.usage();
      await typing;
      await message.reply({ embeds: [buildUsageEmbed(usage)] });
    } catch (err: any) {
      await typing;
      await message.reply({
        embeds: [buildErrorEmbed(`Could not fetch usage data.\n\`${err.message}\``)],
      });
    }
  },
};
