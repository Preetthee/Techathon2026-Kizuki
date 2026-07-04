import { Message } from 'discord.js';
import { api } from '../utils/api';
import { buildStatusEmbed, buildErrorEmbed } from '../utils/embeds';
import type { CommandContext } from './registry';

export const statusCommand = {
  name:        'status',
  aliases:     ['s', 'devices', 'all'],
  description: 'Show all 15 devices grouped by room with live wattage.',

  async execute(_args: string[], message: Message, _ctx: CommandContext): Promise<void> {
    const typing = message.channel.sendTyping();

    try {
      const rooms = await api.rooms();
      await typing;
      await message.reply({ embeds: [buildStatusEmbed(rooms)] });
    } catch (err: any) {
      await typing;
      await message.reply({
        embeds: [buildErrorEmbed(`Could not fetch device status.\n\`${err.message}\``)],
      });
    }
  },
};
