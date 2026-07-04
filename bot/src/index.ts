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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import config from './config';
import { findCommand } from './commands/registry';
import { buildErrorEmbed } from './utils/embeds';
import { api, type Alert } from './utils/api';

// ─── Single-instance guard (file lock) ────────────────────────────────────────
//
// Symptom of duplicate Discord clients: every !command produces two replies
// because Discord fans the gateway event out to every active connection sharing
// the token. The uniqueReply() Set can't help across two different processes.
//
// This lock file prevents a second instance from running at all. If the lock
// file already exists and the PID inside it is alive, this process exits
// immediately with code 42 so the wrapper (npm run dev / npm start) surfaces it.

function getLockPath(): string {
  const tokenHash = crypto.createHash('sha256').update(config.token).digest('hex').slice(0, 16);
  return process.env.DISCORD_BOT_LOCK_PATH
    ? path.resolve(process.env.DISCORD_BOT_LOCK_PATH)
    : path.join(os.tmpdir(), `office-power-monitor-discord-bot-${tokenHash}.lock`);
}

const LOCK_PATH = getLockPath();

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = check existence only, doesn't actually kill
    return true;
  } catch (err: any) {
    return err.code === 'EPERM'; // EPERM = process exists but we can't signal it
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
        console.error(
          `[discord] Kill the existing process first, or delete the lock file ` +
          `if you're sure no other bot is running.`
        );
        process.exit(42);
      } else {
        console.warn(
          `[discord] Stale lock file found (pid=${existing?.pid} not alive). Replacing.`
        );
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
process.on('exit',    releaseLock);
process.on('SIGTERM', () => { releaseLock(); shutdown('SIGTERM'); });
process.on('SIGINT',  () => { releaseLock(); shutdown('SIGINT');  });

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

async function pushOfficeAlert(alert: Alert | any, title = 'Office Alert'): Promise<void> {
  const ch = await getAlertChannel();
  if (!ch) return;

  const critical = alert.severity === 'CRITICAL';
  const embed = new EmbedBuilder()
    .setColor(critical ? Colors.Red : Colors.Yellow)
    .setTitle(critical ? `Critical ${title}` : title)
    .setDescription(alert.message)
    .addFields(
      { name: 'Room', value: alert.room ?? 'N/A', inline: true },
      { name: 'Type', value: alert.type, inline: true },
      { name: 'Severity', value: alert.severity ?? 'WARNING', inline: true },
      {
        name: 'Triggered',
        value: `<t:${Math.floor(new Date(alert.timestamp ?? alert.triggeredAt).getTime() / 1000)}:R>`,
        inline: true,
      }
    )
    .setFooter({ text: `Alert ID: ${alert.id ?? alert.alertId}` })
    .setTimestamp();

  await ch.send({ content: '@here', embeds: [embed] }).catch(console.error);
}

async function pushActiveAlertReminder(): Promise<void> {
  if (!config.channelId || config.alertRepeatIntervalMs <= 0) return;

  try {
    const alerts = await api.alerts();
    if (alerts.length === 0) return;

    const ch = await getAlertChannel();
    if (!ch) return;

    const critical = alerts.filter((a) => a.severity === 'CRITICAL').length;
    const afterHours = alerts.filter((a) => a.type === 'AFTER_HOURS').length;
    const embed = new EmbedBuilder()
      .setColor(critical > 0 ? Colors.Red : Colors.Yellow)
      .setTitle('Active Office Alert Reminder')
      .setDescription(
        `${alerts.length} alert${alerts.length === 1 ? '' : 's'} still active ` +
        `(${afterHours} after-hours, ${critical} critical).`
      )
      .addFields(
        alerts.slice(0, 10).map((alert) => ({
          name: `${alert.severity} - ${alert.room ?? 'Office'} - ${alert.type}`,
          value: `${alert.message}\nTriggered <t:${Math.floor(new Date(alert.timestamp).getTime() / 1000)}:R>`,
          inline: false,
        }))
      )
      .setFooter({ text: `Repeats every ${Math.round(config.alertRepeatIntervalMs / 60000)} min while alerts remain active.` })
      .setTimestamp();

    await ch.send({ content: '@here', embeds: [embed] }).catch(console.error);
  } catch (err: any) {
    console.warn(`[discord] Alert reminder failed: ${err.message}`);
  }
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

  // Listen for new alerts and push them immediately to Discord.
  _socket.on('alert:new', async (payload: { alert: any; isNew: boolean }) => {
    const alert = payload?.alert ?? payload;
    if (alert) await pushOfficeAlert(alert, payload?.isNew ? 'New Office Alert' : 'Updated Office Alert');
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
  if (config.alertRepeatIntervalMs > 0) {
    console.log(`[discord] Alert reminders every ${config.alertRepeatIntervalMs / 1000}s`);
    setInterval(() => void pushActiveAlertReminder(), config.alertRepeatIntervalMs);
  }
});

// ─── Message handler ──────────────────────────────────────────────────────────

// Unique per-process tag so duplicate-client issues are visible in the logs.
const _instanceId = Math.random().toString(36).slice(2, 8);
console.log(`[discord] Handler instance id: ${_instanceId} (pid=${process.pid})`);

const _repliedMessages = new Set<string>();

function uniqueReply(message: Message, payload: any): Promise<any> {
  // Defensive guard — prevents the same user message from being replied to twice
  // if the handler somehow ends up running in parallel for the same id.
  console.log(
    `[discord][inst=${_instanceId}] uniqueReply() called for message ${message.id} ` +
    `author=${message.author.tag} content=${JSON.stringify(message.content).slice(0, 80)}`
  );
  if (_repliedMessages.has(message.id)) {
    console.warn(
      `[discord][inst=${_instanceId}] Skipping duplicate reply to message ${message.id} ` +
      `(already replied by this instance)`
    );
    return Promise.resolve();
  }
  _repliedMessages.add(message.id);
  // Auto-expire so the set doesn't grow unbounded (1 hour is plenty)
  setTimeout(() => _repliedMessages.delete(message.id), 60 * 60 * 1000);
  console.log(
    `[discord][inst=${_instanceId}] SENDING reply via message.reply() for ${message.id}`
  );
  return message.reply(payload);
}

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

  console.log(
    `[discord][inst=${_instanceId}] MessageCreate received: ` +
    `msgId=${message.id} trigger=${trigger} args=${JSON.stringify(args)}`
  );

  const command = findCommand(trigger);

  if (!command) {
    await uniqueReply(message, {
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
    console.log(
      `[discord][inst=${_instanceId}] About to call ${trigger}Command.execute() for msg ${message.id}`
    );
    await command.execute(args, message, { prefix: config.prefix, uniqueReply });
    console.log(
      `[discord][inst=${_instanceId}] ${trigger}Command.execute() resolved for msg ${message.id}`
    );
  } catch (err: any) {
    console.error(`[discord] Unhandled error in command "${trigger}":`, err);
    await uniqueReply(message, {
      embeds: [buildErrorEmbed(`An unexpected error occurred: \`${err.message}\``)],
    }).catch(() => {});
  }
});

// Listener counts AFTER registration — should be exactly 1 each.
console.log(
  `[discord] MessageCreate listener count: ${client.listenerCount(Events.MessageCreate)}`
);
console.log(
  `[discord] InteractionCreate listener count: ${client.listenerCount(Events.InteractionCreate)}`
);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`[discord] ${signal} — shutting down`);
  _socket?.disconnect();
  client.destroy();
  // releaseLock() runs via the 'exit' handler installed at the top of the file.
  process.exit(0);
}

// Note: SIGTERM/SIGINT handlers are installed at the top of the file (right
// after acquireLock) so they can release the lock file before exiting.

// ─── Login ────────────────────────────────────────────────────────────────────

client.login(config.token).catch((err) => {
  console.error('[discord] Login failed:', err.message);
  process.exit(1);
});
