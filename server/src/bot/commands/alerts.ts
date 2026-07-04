import { Message } from 'discord.js';
import { api } from '../utils/api';
import { buildAlertsEmbed, buildErrorEmbed } from '../utils/embeds';
import type { CommandContext } from './registry';

export const alertsCommand = {
  name:        'alerts',
  aliases:     ['a', 'warn', 'warnings'],
  description: 'Show all active alerts — after-hours devices and sustained load.',

  async execute(_args: string[], message: Message, _ctx: CommandContext): Promise<void> {
    const typing = message.channel.sendTyping();

    try {
      const alerts = await api.alerts();
      await typing;
      await message.reply({ embeds: [buildAlertsEmbed(alerts)] });
    } catch (err: any) {
      await typing;
      await message.reply({
        embeds: [buildErrorEmbed(`Could not fetch alerts.\n\`${err.message}\``)],
      });
    }
  },
};
