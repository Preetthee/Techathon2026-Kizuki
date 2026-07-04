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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import botConfig from './config';
import { findCommand } from './commands/registry';
import { buildErrorEmbed } from './utils/embeds';
import { onAlert, getAlertSummaryForBot } from '../services/alertEngine';

function getLockPath(): string {
  const tokenHash = crypto.createHash('sha256').update(botConfig.token).digest('hex').slice(0, 16);
  return process.env.DISCORD_BOT_LOCK_PATH
    ? path.resolve(process.env.DISCORD_BOT_LOCK_PATH)
    : path.join(os.tmpdir(), `office-power-monitor-discord-bot-${tokenHash}.lock`);
}

const LOCK_PATH = getLockPath();

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

function acquireLock(): void {
  if (fs.existsSync(LOCK_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')) as {
        pid: number;
        startedAt: string;
      };

      if (existing?.pid && isPidAlive(existing.pid)) {
        console.error(
          `[discord] ABORT: another bot instance is already running ` +
          `(pid=${existing.pid}, started=${existing.startedAt}). ` +
          `Lock file: ${LOCK_PATH}`
        );
        process.exit(42);
      }
    } catch {
      console.warn(`[discord] Unreadable lock file at ${LOCK_PATH}. Replacing.`);
    }
  }

  fs.writeFileSync(
    LOCK_PATH,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
  );
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8')) as { pid?: number };
      if (parsed?.pid === process.pid) fs.unlinkSync(LOCK_PATH);
    }
  } catch {
    /* best-effort */
  }
}

acquireLock();
process.on('exit', releaseLock);

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

const _repliedMessages = new Set<string>();

function uniqueReply(message: Message, payload: unknown): Promise<unknown> {
  if (_repliedMessages.has(message.id)) {
    console.warn(`[discord] Skipping duplicate reply to message ${message.id}`);
    return Promise.resolve();
  }

  _repliedMessages.add(message.id);
  setTimeout(() => _repliedMessages.delete(message.id), 60 * 60 * 1000);

  return message.reply(payload as any);
}

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
    await uniqueReply(message, {
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
    await command.execute(args, message, { prefix: botConfig.prefix, uniqueReply });
  } catch (err: any) {
    console.error(`[discord] Unhandled error in command "${trigger}":`, err);
    await uniqueReply(message, {
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
  releaseLock();
  client.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  releaseLock();
  client.destroy();
  process.exit(0);
});

// ─── Login ────────────────────────────────────────────────────────────────────

client.login(botConfig.token).catch((err) => {
  console.error('[discord] Login failed:', err.message);
  process.exit(1);
});
