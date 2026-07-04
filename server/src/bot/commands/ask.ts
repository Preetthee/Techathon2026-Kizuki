/**
 * !ask command
 *
 * Sends the user's question through the full AI pipeline:
 *   contextBuilder → promptBuilder → LLM provider → Discord embed
 *
 * The embed colour signals the office state at the time of the response:
 *   🟢 green  — no alerts, office hours
 *   🟡 yellow — warnings only
 *   🔴 red    — critical alerts active
 *   🔵 blue   — after hours, no issues
 */

import { Message, EmbedBuilder, Colors } from 'discord.js';
import { ask }                            from '../../ai/aiService';
import { buildErrorEmbed }                from '../utils/embeds';
import type { CommandContext }            from './registry';
import type { OfficeContext }             from '../../ai/contextBuilder';

// ─── Embed colour logic ───────────────────────────────────────────────────────

function embedColor(ctx: OfficeContext): number {
  if (ctx.summary.criticalAlerts > 0) return Colors.Red;
  if (ctx.summary.warningAlerts  > 0) return Colors.Yellow;
  if (ctx.officeStatus === 'AFTER_HOURS')  return Colors.Blue;
  return 0x00d4ff;  // brand cyan — normal state
}

function providerBadge(provider: string, model: string): string {
  const icons: Record<string, string> = {
    openai:   '🤖',
    gemini:   '✨',
    deepseek: '🔍',
    ollama:   '🦙',
    canned:   '⚡',
  };
  const icon = icons[provider] ?? '🤖';
  return provider === 'canned'
    ? `${icon} instant response`
    : `${icon} ${provider} · ${model}`;
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const askCommand = {
  name:        'ask',
  aliases:     ['ai', 'q', 'query'],
  description: 'Ask the AI assistant about the office. Usage: `!ask <question>`',

  async execute(args: string[], message: Message, ctx: CommandContext): Promise<void> {
    const reply = (payload: unknown) => ctx.uniqueReply(message, payload);
    const question = args.join(' ').trim();

    if (!question) {
      await reply({
        embeds: [
          buildErrorEmbed(
            `Please include a question after \`${ctx.prefix}ask\`.\n\n` +
            `**Examples:**\n` +
            `• \`${ctx.prefix}ask what rooms are consuming the most power?\`\n` +
            `• \`${ctx.prefix}ask is anything unusual happening?\`\n` +
            `• \`${ctx.prefix}ask summarize the office status\``
          ),
        ],
      });
      return;
    }

    // Show typing indicator while the LLM thinks
    await (message.channel as unknown as { sendTyping: () => Promise<void> }).sendTyping();

    // Keep the typing indicator alive for slow providers
    const typingInterval = setInterval(
      () => (message.channel as unknown as { sendTyping: () => Promise<void> }).sendTyping().catch(() => {}),
      8_000
    );

    try {
      const result = await ask({
        question,
        callerId: message.author.id,
      });

      clearInterval(typingInterval);

      const color  = embedColor(result.context);
      const footer = [
        `📍 ${result.context.power.formattedWatts} live · ${result.context.power.activeDevices}/${result.context.power.totalDevices} devices on`,
        result.context.summary.hasAlerts
          ? `⚠️ ${result.context.alerts.length} alert${result.context.alerts.length > 1 ? 's' : ''} active`
          : '✅ No alerts',
        providerBadge(result.provider, result.model),
        `${result.latencyMs}ms`,
      ].join('  ·  ');

      const embed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: 'ARIA — Office Power Assistant', iconURL: 'https://cdn-icons-png.flaticon.com/512/4712/4712109.png' })
        .setDescription(result.answer)
        .setFooter({ text: footer })
        .setTimestamp(new Date(result.capturedAt));

      // Append a compact alerts snapshot if there are active alerts
      if (result.context.summary.hasAlerts && result.context.alerts.length <= 5) {
        const alertLines = result.context.alerts.map((a) =>
          `${a.severity === 'CRITICAL' ? '🔴' : '🟡'} ${a.message}`
        );
        embed.addFields({
          name:   `Active Alerts (${result.context.alerts.length})`,
          value:  alertLines.join('\n'),
          inline: false,
        });
      }

      await reply({ embeds: [embed] });

    } catch (err: any) {
      clearInterval(typingInterval);

      const isRateLimit = err.statusCode === 429;
      await reply({
        embeds: [
          buildErrorEmbed(
            isRateLimit
              ? `⏳ ${err.message}`
              : `The AI assistant ran into a problem:\n\`${err.message}\``
          ),
        ],
      });
    }
  },
};
