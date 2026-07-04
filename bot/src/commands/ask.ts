/**
 * !ask command
 *
 * Sends the user's question to the backend POST /ai/ask endpoint.
 * The backend builds grounded context from live device state and calls the LLM.
 * The bot only displays the result — it never touches device data directly.
 */

import { Message, EmbedBuilder, Colors } from 'discord.js';
import { api } from '../utils/api';
import { buildErrorEmbed } from '../utils/embeds';
import type { CommandContext } from './registry';

const BRAND = 0x00d4ff;

const PROVIDER_ICONS: Record<string, string> = {
  openai:   '🤖',
  gemini:   '✨',
  deepseek: '🔍',
  ollama:   '🦙',
  canned:   '⚡',
};

export const askCommand = {
  name:        'ask',
  aliases:     ['ai', 'q', 'query'],
  description: 'Ask the AI assistant about the office. Usage: `!ask <question>`',

  async execute(args: string[], message: Message, ctx: CommandContext): Promise<void> {
    const question = args.join(' ').trim();

    if (!question) {
      await message.reply({
        embeds: [
          buildErrorEmbed(
            `Please include a question after \`${ctx.prefix}ask\`.\n\n**Examples:**\n` +
            `• \`${ctx.prefix}ask what rooms are consuming the most power?\`\n` +
            `• \`${ctx.prefix}ask is anything unusual happening?\`\n` +
            `• \`${ctx.prefix}ask summarize the office status\``
          ),
        ],
      });
      return;
    }

    await (message.channel as unknown as { sendTyping: () => Promise<void> }).sendTyping();

    const typingInterval = setInterval(
      () => (message.channel as unknown as { sendTyping: () => Promise<void> }).sendTyping().catch(() => {}),
      8_000
    );

    try {
      const result = await api.ask(question, message.author.id);
      clearInterval(typingInterval);

      const icon = PROVIDER_ICONS[result.provider] ?? '🤖';
      const providerBadge = result.provider === 'canned'
        ? `${icon} instant response`
        : `${icon} ${result.provider} · ${result.model}`;

      const embed = new EmbedBuilder()
        .setColor(BRAND)
        .setAuthor({ name: 'ARIA — Office Power Assistant', iconURL: 'https://cdn-icons-png.flaticon.com/512/4712/4712109.png' })
        .setDescription(result.answer)
        .setFooter({ text: `${providerBadge}  ·  ${result.latencyMs}ms` })
        .setTimestamp(new Date(result.capturedAt));

      await message.reply({ embeds: [embed] });
    } catch (err: any) {
      clearInterval(typingInterval);
      const isRateLimit = err.message?.includes('429') || err.message?.includes('Too many');
      await message.reply({
        embeds: [
          buildErrorEmbed(
            isRateLimit
              ? `⏳ Rate limit — please wait a moment before asking again.`
              : `The AI assistant ran into a problem:\n\`${err.message}\``
          ),
        ],
      });
    }
  },
};
