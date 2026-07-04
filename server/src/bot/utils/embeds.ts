/**
 * Embed builders — every command response is a rich Discord embed.
 * No raw string replies; everything is structured and branded.
 */

import { EmbedBuilder, Colors } from 'discord.js';
import type { Device, RoomSummary, UsageSummary, Alert } from './api';

// ─── Palette ──────────────────────────────────────────────────────────────────

const BRAND = 0x00d4ff;  // electric cyan  — matches the frontend theme

// ─── Shared helpers ───────────────────────────────────────────────────────────

function deviceIcon(type: Device['type']): string {
  return type === 'fan' ? '🌀' : '💡';
}

function statusBadge(on: boolean): string {
  return on ? '🟢 ON' : '⚫ OFF';
}

function severityEmoji(s: Alert['severity']): string {
  return s === 'CRITICAL' ? '🔴' : '🟡';
}

function formatWatts(w: number): string {
  return w >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${w} W`;
}

function formatKwh(kwh: number): string {
  return `${kwh.toFixed(2)} kWh`;
}

function relativeTime(iso: string): string {
  const diffMs  = Date.now() - new Date(iso).getTime();
  const mins    = Math.floor(diffMs / 60_000);
  const hours   = Math.floor(mins / 60);
  if (hours > 0) return `${hours}h ${mins % 60}m ago`;
  if (mins  > 0) return `${mins}m ago`;
  return 'just now';
}

function footer(timestamp: string): { text: string } {
  return { text: `Office Power Monitor · ${new Date(timestamp).toLocaleTimeString()}` };
}

// ─── !status embed ────────────────────────────────────────────────────────────

export function buildStatusEmbed(rooms: RoomSummary[]): EmbedBuilder {
  const totalOn    = rooms.reduce((s, r) => s + r.onCount, 0);
  const totalAll   = rooms.reduce((s, r) => s + r.deviceCount, 0);
  const totalWatts = rooms.reduce((s, r) => s + r.totalPowerDraw, 0);

  const embed = new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('⚡  Office Device Status')
    .setDescription(
      `**${totalOn}** of **${totalAll}** devices active · ` +
      `**${formatWatts(totalWatts)}** live draw`
    )
    .setTimestamp();

  for (const room of rooms) {
    const lines = room.devices.map(
      (d) => `${deviceIcon(d.type)} \`${d.name}\`  ${statusBadge(d.status)}  **${d.powerDraw}W**`
    );

    const label =
      room.onCount === room.deviceCount ? '🔥 All ON' :
      room.onCount === 0               ? '🌙 All OFF' :
                                         `${room.onCount}/${room.deviceCount} ON`;

    embed.addFields({
      name:   `${room.room}  ·  ${label}  ·  ${formatWatts(room.totalPowerDraw)}`,
      value:  lines.join('\n'),
      inline: false,
    });
  }

  embed.setFooter(footer(new Date().toISOString()));
  return embed;
}

// ─── !room embed ──────────────────────────────────────────────────────────────

export function buildRoomEmbed(room: RoomSummary): EmbedBuilder {
  const fans   = room.devices.filter((d) => d.type === 'fan');
  const lights = room.devices.filter((d) => d.type === 'light');

  const deviceLine = (d: Device) =>
    `${deviceIcon(d.type)} **${d.name}** — ${statusBadge(d.status)} · ${d.powerDraw}W · changed ${relativeTime(d.lastChanged)}`;

  const loadPct = room.devices.reduce((s, d) => s + (d.type === 'fan' ? 60 : 15), 0);
  const pct     = loadPct > 0 ? Math.round((room.totalPowerDraw / loadPct) * 100) : 0;
  const bar     = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));

  const color =
    pct === 100 ? Colors.Red :
    pct > 50    ? Colors.Yellow :
                  BRAND;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`📍  ${room.room}`)
    .setDescription(
      `**${room.onCount}** of **${room.deviceCount}** devices ON  ·  ` +
      `**${formatWatts(room.totalPowerDraw)}** live\n` +
      `\`${bar}\` ${pct}% load`
    )
    .addFields(
      { name: '🌀 Fans', value: fans.map(deviceLine).join('\n')   || '—', inline: false },
      { name: '💡 Lights', value: lights.map(deviceLine).join('\n') || '—', inline: false }
    )
    .setFooter(footer(new Date().toISOString()))
    .setTimestamp();
}

// ─── !usage embed ─────────────────────────────────────────────────────────────

export function buildUsageEmbed(usage: UsageSummary): EmbedBuilder {
  const maxPossible = 15 * 15;   // rough ceiling: all lights on (conservative)

  const roomFields = usage.rooms.map((r) => {
    const share = usage.totalPowerDraw > 0
      ? Math.round((r.powerDraw / usage.totalPowerDraw) * 100)
      : 0;
    const bar = '█'.repeat(Math.round(share / 10)) + '░'.repeat(10 - Math.round(share / 10));
    return {
      name:   r.room,
      value:  `\`${bar}\` **${formatWatts(r.powerDraw)}**  (${share}%)  ·  ${r.onCount} device${r.onCount !== 1 ? 's' : ''} ON`,
      inline: false,
    };
  });

  return new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle('📊  Live Power Usage')
    .addFields(
      {
        name: 'Total Draw',
        value: `**${formatWatts(usage.totalPowerDraw)}**`,
        inline: true,
      },
      {
        name: 'Today Estimate',
        value: `**${formatKwh(usage.estimatedTodayKwh)}**`,
        inline: true,
      },
      {
        name: '24h Projection',
        value: `**${formatKwh(usage.projectedDailyKwh)}**`,
        inline: true,
      },
      {
        name: 'Devices Active',
        value: `**${usage.onCount}** / ${usage.totalDevices}`,
        inline: true,
      },
      {
        name: 'Idle Devices',
        value: `**${usage.offCount}**`,
        inline: true,
      },
      ...roomFields,
    )
    .setFooter(footer(usage.timestamp))
    .setTimestamp(new Date(usage.timestamp));
}

// ─── !alerts embed ────────────────────────────────────────────────────────────

export function buildAlertsEmbed(alerts: Alert[]): EmbedBuilder {
  if (alerts.length === 0) {
    return new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('✅  No Active Alerts')
      .setDescription('All systems nominal. No devices in violation.')
      .setFooter(footer(new Date().toISOString()))
      .setTimestamp();
  }

  const critical = alerts.filter((a) => a.severity === 'CRITICAL');
  const warning  = alerts.filter((a) => a.severity === 'WARNING');

  const embed = new EmbedBuilder()
    .setColor(critical.length > 0 ? Colors.Red : Colors.Yellow)
    .setTitle(`⚠️  Active Alerts  (${alerts.length})`)
    .setDescription(
      [
        critical.length > 0 ? `🔴 **${critical.length} critical**` : '',
        warning.length  > 0 ? `🟡 **${warning.length} warning**`  : '',
      ].filter(Boolean).join('  ·  ')
    );

  // Group by type for readability
  const grouped: Record<string, Alert[]> = {};
  for (const a of alerts) {
    (grouped[a.type] ??= []).push(a);
  }

  for (const [type, group] of Object.entries(grouped)) {
    const label = type === 'AFTER_HOURS' ? '🌙 After Hours' : '🔥 Sustained Load';
    const lines = group.map((a) =>
      `${severityEmoji(a.severity)} ${a.message}\n` +
      `> triggered ${relativeTime(a.timestamp)}`
    );
    embed.addFields({ name: label, value: lines.join('\n\n'), inline: false });
  }

  embed.setFooter(footer(new Date().toISOString())).setTimestamp();
  return embed;
}

// ─── !help embed ──────────────────────────────────────────────────────────────

export function buildHelpEmbed(prefix: string): EmbedBuilder {
  const cmd = (name: string, usage: string, desc: string) =>
    `\`${prefix}${name} ${usage}\`\n${desc}`;

  return new EmbedBuilder()
    .setColor(BRAND)
    .setTitle('⚡  Office Power Monitor — Commands')
    .addFields(
      {
        name: cmd('status', '', 'All 15 devices grouped by room with live wattage'),
        value: '​',
        inline: false,
      },
      {
        name: cmd('room', '<name>', 'Detailed view of one room. Name can be partial (e.g. `work 1`)'),
        value: '​',
        inline: false,
      },
      {
        name: cmd('usage', '', 'Live power consumption totals and per-room breakdown'),
        value: '​',
        inline: false,
      },
      {
        name: cmd('alerts', '', 'All active alerts — after-hours devices and sustained load'),
        value: '​',
        inline: false,
      },
      {
        name: cmd('ask', '<question>', 'Ask the AI assistant anything about the office'),
        value: '​',
        inline: false,
      },
      {
        name: cmd('help', '', 'Show this message'),
        value: '​',
        inline: false,
      }
    )
    .setFooter({ text: 'Data is fetched live from the backend on every command.' });
}

// ─── Error embed ──────────────────────────────────────────────────────────────

export function buildErrorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('❌  Error')
    .setDescription(message)
    .setFooter(footer(new Date().toISOString()));
}
