import { Message } from 'discord.js';
import { api } from '../utils/api';
import { buildRoomEmbed, buildErrorEmbed } from '../utils/embeds';
import type { CommandContext } from './registry';

const KNOWN_ROOMS = ['Drawing Room', 'Work Room 1', 'Work Room 2'];

function resolveRoomName(input: string): string | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;

  const exact = KNOWN_ROOMS.find((r) => r.toLowerCase() === q);
  if (exact) return exact;

  const partial = KNOWN_ROOMS.find((r) => r.toLowerCase().includes(q));
  if (partial) return partial;

  const normalised = q
    .replace(/\bwr\s*([12])\b/,   'work room $1')
    .replace(/\bwork\s*([12])\b/, 'work room $1')
    .replace(/\bdr\b/,             'drawing room');

  return KNOWN_ROOMS.find((r) => r.toLowerCase().includes(normalised)) ?? null;
}

export const roomCommand = {
  name:        'room',
  aliases:     ['r'],
  description: 'Show detailed status for one room. Usage: `!room <name>`',

  async execute(args: string[], message: Message, _ctx: CommandContext): Promise<void> {
    const rawInput = args.join(' ');
    const roomName = resolveRoomName(rawInput);

    if (!roomName) {
      const list = KNOWN_ROOMS.map((r) => `• ${r}`).join('\n');
      await message.reply({
        embeds: [buildErrorEmbed(`Room not recognised: **"${rawInput || '(none)'}"**\n\nAvailable rooms:\n${list}`)],
      });
      return;
    }

    const typing = (message.channel as unknown as { sendTyping: () => Promise<void> }).sendTyping();
    try {
      const room = await api.room(roomName);
      await typing;
      await message.reply({ embeds: [buildRoomEmbed(room)] });
    } catch (err: any) {
      await typing;
      await message.reply({ embeds: [buildErrorEmbed(`Could not fetch data for **${roomName}**.\n\`${err.message}\``)] });
    }
  },
};
