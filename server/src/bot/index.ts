/**
 * Office Power Monitor — Discord Bot
 *
 * Run standalone:   npm run bot          (ts-node, development)
 *                   npm run bot:start    (node dist/bot/index.js, production)
 *
 * The bot shares no in-process state with the Express server.
 * It fetches live data from the backend REST API on every command.
 *
 * Required env vars:
 *   DISCORD_TOKEN      — bot token from Discord Developer Portal
 *   API_BASE_URL       — backend URL, e.g. http://localhost:3001
 *
 * Optional env vars:
 *   DISCORD_PREFIX     — command prefix (default: !)
 *   DISCORD_CHANNEL_ID — restrict bot to one channel (default: all channels)
 */

import { Client, GatewayIntentBits, Events, Message } from 'discord.js';
import botConfig from './config';
import { findCommand } from './commands/registry';
import { buildErrorEmbed } from './utils/embeds';
import { onAlert, getAlertSummaryForBot } from '../services/alertEngine';

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // required for prefix commands in v14
  ],
});

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, (c) => {
  console.log(`[discord] Logged in as ${c.user.tag}`);
  console.log(`[discord] Prefix: "${botConfig.prefix}"`);
  console.log(`[discord] API:    ${botConfig.apiBaseUrl}`);
  if (botConfig.channelId) {
    console.log(`[discord] Restricted to channel: ${botConfig.channelId}`);
  }
  c.user.setActivity(`${botConfig.prefix}help | office power`, { type: 3 /* WATCHING */ });
});

// ─── Message handler ──────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore bots (including self)
  if (message.author.bot) return;

  // Channel restriction
  if (botConfig.channelId && message.channelId !== botConfig.channelId) return;

  // Must start with prefix
  if (!message.content.startsWith(botConfig.prefix)) return;

  // Parse trigger + args
  const [rawTrigger, ...args] = message.content
    .slice(botConfig.prefix.length)
    .trim()
    .split(/\s+/);

  const trigger = rawTrigger?.toLowerCase();
  if (!trigger) return;

  const command = findCommand(trigger);

  if (!command) {
    await message.reply({
      embeds: [
        buildErrorEmbed(
          `Unknown command: \`${botConfig.prefix}${trigger}\`\n` +
          `Try \`${botConfig.prefix}help\` to see available commands.`
        ),
      ],
    });
    return;
  }

  try {
    await command.execute(args, message, { prefix: botConfig.prefix });
  } catch (err: any) {
    console.error(`[discord] Unhandled error in command "${trigger}":`, err);
    await message.reply({
      embeds: [buildErrorEmbed(`An unexpected error occurred: \`${err.message}\``)],
    }).catch(() => { /* message may have been deleted */ });
  }
});

// ─── Alert Engine → Discord push notifications ────────────────────────────────
//
// The alert engine fires onAlert() synchronously when a new alert is raised.
// The bot forwards CRITICAL alerts to the configured channel automatically —
// no polling, no repeated notifications for the same alert.

let _alertChannel: import('discord.js').TextChannel | null = null;

async function getAlertChannel() {
  if (_alertChannel) return _alertChannel;
  if (!botConfig.channelId) return null;

  try {
    const ch = await client.channels.fetch(botConfig.channelId);
    if (ch?.isTextBased() && 'send' in ch) {
      _alertChannel = ch as import('discord.js').TextChannel;
    }
  } catch {
    // channel not found or bot lacks access — fail silently
  }
  return _alertChannel;
}

onAlert(async (alert) => {
  // Only push CRITICAL alerts automatically; WARNING alerts surface on demand via !alerts
  if (alert.severity !== 'CRITICAL') return;

  const ch = await getAlertChannel();
  if (!ch) return;

  const { EmbedBuilder, Colors } = await import('discord.js');
  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('🔴  Critical Alert')
    .setDescription(alert.message)
    .addFields(
      { name: 'Room',      value: alert.room ?? 'N/A', inline: true },
      { name: 'Type',      value: alert.type,           inline: true },
      { name: 'Triggered', value: `<t:${Math.floor(new Date(alert.timestamp).getTime() / 1000)}:R>`, inline: true }
    )
    .setFooter({ text: `Alert ID: ${alert.id}` })
    .setTimestamp();

  await ch.send({ content: '@here', embeds: [embed] }).catch(console.error);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('[discord] SIGTERM received, destroying client');
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  client.destroy();
  process.exit(0);
});

// ─── Login ────────────────────────────────────────────────────────────────────

client.login(botConfig.token).catch((err) => {
  console.error('[discord] Login failed:', err.message);
  process.exit(1);
});
