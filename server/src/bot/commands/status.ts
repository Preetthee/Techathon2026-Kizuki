import { Message } from 'discord.js';
import { api } from '../utils/api';
import { buildStatusEmbed, buildErrorEmbed } from '../utils/embeds';
import type { CommandContext } from './registry';

export const statusCommand = {
  name:        'status',
  aliases:     ['s', 'devices', 'all'],
  description: 'Show all 15 devices grouped by room with live wattage.',

  async execute(_args: string[], message: Message, ctx: CommandContext): Promise<void> {
    const reply = (payload: unknown) => ctx.uniqueReply(message, payload);
    const typing = (message.channel as unknown as { sendTyping: () => Promise<void> }).sendTyping();

    try {
      const rooms = await api.rooms();
      await typing;
      await reply({ embeds: [buildStatusEmbed(rooms)] });
    } catch (err: any) {
      await typing;
      await reply({ embeds: [buildErrorEmbed(`Could not fetch device status.\n\`${err.message}\``)] });
    }
  },
};
