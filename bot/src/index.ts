/**
 * Office Power Monitor — Discord Bot (standalone)
 *
 * This bot is completely independent of the server/ project.
 * It connects to the backend via:
 *   • REST API  — for all command responses (!status, !room, !usage, !alerts, !ask)
 *   • Socket.IO — for real-time critical alert push notifications
 *
 * Required env vars:  DISCORD_TOKEN, DISCORD_CLIENT_ID, API_BASE_URL
 * Optional env vars:  DISCORD_PREFIX (!), DISCORD_CHANNEL_ID, DISCORD_GUILD_ID
 *
 * Run:
 *   npm run dev    (development, ts-node)
 *   npm start      (production, compiled dist/)
 */

import { Client, GatewayIntentBits, Events, Message, EmbedBuilder, Colors, TextChannel } from 'discord.js';
import { io as ioClient, Socket } from 'socket.io-client';
import config from './config';
import { findCommand } from './commands/registry';
import { buildErrorEmbed } from './utils/embeds';

// ─── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── Socket.IO → critical alert push notifications ───────────────────────────

let _alertChannel: TextChannel | null = null;
let _socket: Socket | null = null;

async function getAlertChannel(): Promise<TextChannel | null> {
  if (_alertChannel) return _alertChannel;
  if (!config.channelId) return null;
  try {
    const ch = await client.channels.fetch(config.channelId);
    if (ch?.isTextBased() && 'send' in ch) {
      _alertChannel = ch as TextChannel;
    }
  } catch {
    // channel not found or bot lacks access
  }
  return _alertChannel;
}

async function pushCriticalAlert(alert: any): Promise<void> {
  const ch = await getAlertChannel();
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('🔴  Critical Alert')
    .setDescription(alert.message)
    .addFields(
      { name: 'Room',      value: alert.room ?? 'N/A',  inline: true },
      { name: 'Type',      value: alert.type,            inline: true },
      {
        name:   'Triggered',
        value:  `<t:${Math.floor(new Date(alert.timestamp ?? alert.triggeredAt).getTime() / 1000)}:R>`,
        inline: true,
      }
    )
    .setFooter({ text: `Alert ID: ${alert.id ?? alert.alertId}` })
    .setTimestamp();

  await ch.send({ content: '@here', embeds: [embed] }).catch(console.error);
}

function connectToBackend(): void {
  const url = `${config.apiBaseUrl}/monitor`;

  _socket = ioClient(url, {
    reconnectionDelay:    2_000,
    reconnectionAttempts: Infinity,
    transports: ['websocket', 'polling'],
  });

  _socket.on('connect', () =>
    console.log(`[socket] Connected to backend ${url}`)
  );

  _socket.on('disconnect', (reason) =>
    console.log(`[socket] Disconnected from backend: ${reason}`)
  );

  _socket.on('connect_error', (err) =>
    console.warn(`[socket] Connection error: ${err.message} — will retry`)
  );

  // Listen for new alerts and push critical ones to Discord
  _socket.on('alert:new', async (payload: { alert: any; isNew: boolean }) => {
    const alert = payload?.alert ?? payload;
    if (alert?.severity === 'CRITICAL') {
      await pushCriticalAlert(alert);
    }
  });
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, (c) => {
  console.log(`[discord] Logged in as ${c.user.tag}`);
  console.log(`[discord] Client ID: ${config.clientId}`);
  console.log(`[discord] Prefix: "${config.prefix}"`);
  console.log(`[discord] Backend: ${config.apiBaseUrl}`);
  if (config.channelId) console.log(`[discord] Alert channel: ${config.channelId}`);

  c.user.setActivity(`${config.prefix}help | office power`, { type: 3 /* WATCHING */ });

  // Connect to backend Socket.IO after bot is ready
  connectToBackend();
});

// ─── Message handler ──────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (config.channelId && message.channelId !== config.channelId) return;
  if (!message.content.startsWith(config.prefix)) return;

  const [rawTrigger, ...args] = message.content
    .slice(config.prefix.length)
    .trim()
    .split(/\s+/);

  const trigger = rawTrigger?.toLowerCase();
  if (!trigger) return;

  const command = findCommand(trigger);

  if (!command) {
    await message.reply({
      embeds: [
        buildErrorEmbed(
          `Unknown command: \`${config.prefix}${trigger}\`\n` +
          `Try \`${config.prefix}help\` to see available commands.`
        ),
      ],
    });
    return;
  }

  try {
    await command.execute(args, message, { prefix: config.prefix });
  } catch (err: any) {
    console.error(`[discord] Unhandled error in command "${trigger}":`, err);
    await message.reply({
      embeds: [buildErrorEmbed(`An unexpected error occurred: \`${err.message}\``)],
    }).catch(() => {});
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`[discord] ${signal} — shutting down`);
  _socket?.disconnect();
  client.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── Login ────────────────────────────────────────────────────────────────────

client.login(config.token).catch((err) => {
  console.error('[discord] Login failed:', err.message);
  process.exit(1);
});
