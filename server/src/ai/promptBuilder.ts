/**
 * Prompt Builder
 *
 * Assembles the system prompt and user message sent to the LLM.
 *
 * System prompt design principles:
 *   1. Ground the LLM to the provided context — explicitly forbid invented data.
 *   2. Define the voice: friendly, concise, non-technical, boss-friendly.
 *   3. Inject the full context as a JSON block so the LLM has structured facts.
 *   4. Set output constraints (length, format, no markdown in short answers).
 */
import fs   from 'fs';
import path from 'path';import type { OfficeContext } from './contextBuilder';

// ─── System prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(context: OfficeContext): string {
  return `
You are an intelligent office power monitoring assistant named ARIA (Automated Room Intelligence Assistant).

## YOUR ROLE
You help office staff and managers understand what is happening with the electrical devices in their office right now.
You answer questions in a friendly, concise, and non-technical way — as if briefing a busy manager who doesn't want jargon.

## STRICT DATA RULES
- You MUST only use the data provided in the OFFICE SNAPSHOT below.
- You MUST NOT invent, assume, or infer any device states, power figures, room names, or alert details that are not in the snapshot.
- If you cannot answer a question from the snapshot data alone, say so clearly.
- Always refer to data as "right now" or "as of ${new Date(context.capturedAt).toLocaleTimeString()}" — never use vague timings.

## RESPONSE STYLE
- Friendly and warm — like a helpful colleague, not a robot.
- Concise — 2 to 5 sentences max for most questions. Use bullet points only when listing multiple items.
- Non-technical — say "fan" not "HVAC unit", "light" not "luminaire", "turned on" not "status: ON".
- Boss-friendly — highlight what matters (high power draw, unusual activity, alerts) first.
- Never show raw JSON, IDs, or field names from the context in your response.

## OFFICE SNAPSHOT  (captured at ${new Date(context.capturedAt).toLocaleTimeString()})
\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

Answer the user's question using only the data above.
`.trim();
}

// ─── User message ─────────────────────────────────────────────────────────────

export function buildUserMessage(question: string): string {
  return question.trim();
}

// ─── Canned responses for edge cases (no LLM call needed) ────────────────────

/**
 * Lightweight reader for the JSON state file — gives us a small piece of
 * historical data (usage snapshots) without going through MongoDB.
 * Returns an empty array if the file is missing or malformed.
 */
function readRecentUsage(): { timestamp: string; totalSystemPower: number }[] {
  try {
    const filePath = path.resolve(
      process.cwd(),
      'data',
      'state.json',
    );
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      recentUsage?: { timestamp: string; totalSystemPower: number }[];
    };
    return Array.isArray(raw.recentUsage) ? raw.recentUsage : [];
  } catch {
    return [];
  }
}

function formatPeakTime(iso: string): string {
  const d   = new Date(iso);
  const now = Date.now();
  const diffMin = Math.round((now - d.getTime()) / 60_000);
  if (diffMin < 1)   return 'just now';
  if (diffMin < 60)  return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr  < 24)  return `${diffHr} hour${diffHr > 1 ? 's' : ''} ago`;
  return d.toLocaleString();
}

export function getCannedResponse(context: OfficeContext, question: string): string | null {
  const q = question.toLowerCase().trim();

  if (['hi', 'hello', 'hey'].includes(q)) {
    return `Hey! I'm ARIA, your office power assistant. The office is currently drawing **${context.power.formattedWatts}** with **${context.power.activeDevices}** of ${context.power.totalDevices} devices on. What would you like to know?`;
  }

  if (q === 'help' || q === '?') {
    return [
      "Here's what you can ask me:",
      '• **"What rooms are consuming the most power?"**',
      '• **"Is anything unusual happening?"**',
      '• **"Summarize the office status"**',
      '• **"Which devices have been on the longest?"**',
      '• **"Are there any alerts?"**',
      '• Any other question about devices, rooms, or power usage!',
    ].join('\n');
  }

  // Which lights / devices / fans are on — answered from live state
  if (
    /which\s+(lights?|devices?|fans?)\s+(are|is)\s+(on|running|active|turned\s+on|on\s+right\s+now)/.test(q) ||
    /what\s+(lights?|devices?|fans?)\s+(are|is)\s+(on|running|active|turned\s+on)/.test(q) ||
    /list\s+(the\s+)?(lights?|devices?|fans?)\s+(that\s+are\s+)?(on|running|active)/.test(q) ||
    /show\s+(me\s+)?(the\s+)?(lights?|devices?|fans?)\s+(that\s+are\s+)?(on|running|active)/.test(q)
  ) {
    const wantsLights = /light/.test(q);
    const wantsFans   = /fan/.test(q);
    const target      = wantsLights ? 'light' : wantsFans ? 'fan' : null;

    let list = context.devices;
    if (target) list = list.filter((d) => d.type === target);
    const on = list.filter((d) => d.status === 'ON');

    if (on.length === 0) {
      return `No ${target ?? 'devices'} are currently on. The office is drawing **${context.power.formattedWatts}** total.`;
    }
    const lines = on.map((d) => `• **${d.name}** in *${d.room}* (${d.powerWatts} W, on for ${d.lastChanged})`);
    return [
      `**${on.length} ${target ?? 'device'}${on.length === 1 ? '' : 's'} currently on:**`,
      ...lines,
      `Total: **${context.power.formattedWatts}**.`,
    ].join('\n');
  }

  // What's on in a specific room — answered from live state
  const roomMatch = q.match(/(?:what|which|whats|what's)\s+(?:is\s+)?(?:on|running|active|turned\s+on)\s+(?:in|at)\s+(?:the\s+)?([a-z][a-z0-9\s]+?)(?:\?|$)/);
  if (roomMatch) {
    const roomName = roomMatch[1].trim();
    const room = context.rooms.find((r) => r.name.toLowerCase().includes(roomName));
    if (room) {
      const onDevices = [
        ...room.lights.filter((l) => l.status === 'ON').map((l) => `• 💡 ${l.name} (${l.powerWatts} W)`),
        ...room.fans.filter((f) => f.status === 'ON').map((f) => `• 🌀 ${f.name} (${f.powerWatts} W)`),
      ];
      if (onDevices.length === 0) {
        return `Nothing is on in **${room.name}** right now. The room is idle.`;
      }
      return [
        `**Currently on in ${room.name}:**`,
        ...onDevices,
        `Room load: **${room.totalPowerWatts} W** (${room.loadPercent}% of max).`,
      ].join('\n');
    }
  }

  // Summarize the office — answered from live state
  if (/summar(y|ise|ize)\s+(the\s+)?(office|status|building)/.test(q) ||
      /what.?s\s+happening|how\s+is\s+(the\s+)?office|office\s+status/.test(q) ||
      /give\s+me\s+(a\s+)?(an?\s+)?(summary|overview|status|report)/.test(q)) {
    const rooms = context.rooms
      .filter((r) => r.totalPowerWatts > 0)
      .sort((a, b) => b.totalPowerWatts - a.totalPowerWatts)
      .slice(0, 3)
      .map((r) => `• **${r.name}** — ${r.totalPowerWatts} W (${r.loadPercent}% load)`);
    const alertLine = context.summary.hasAlerts
      ? `\n⚠️ **${context.summary.criticalAlerts} critical, ${context.summary.warningAlerts} warning alerts active.**`
      : `\n✅ No active alerts.`;
    return [
      `**Office status** (${context.officeStatus}, ${context.currentHour}:00):`,
      `Power: **${context.power.formattedWatts}** from ${context.power.activeDevices}/${context.power.totalDevices} devices on.`,
      `Highest-load rooms:`,
      ...(rooms.length > 0 ? rooms : ['• (no active rooms)']),
      alertLine,
    ].join('\n');
  }

  // Anything unusual / alerts
  if (/unusual|strange|weird|alert|warning|problem|issue|concern/.test(q)) {
    if (context.alerts.length === 0) {
      return `Nothing unusual — all devices are operating normally. Power: **${context.power.formattedWatts}**, ${context.power.activeDevices}/${context.power.totalDevices} devices on.`;
    }
    const lines = context.alerts.slice(0, 5).map(
      (a) => `• **[${a.severity}]** ${a.type} in ${a.room ?? 'office'} — ${a.message} (${a.since})`
    );
    return [`⚠️ **${context.alerts.length} active alert${context.alerts.length === 1 ? '' : 's'}:**`, ...lines].join('\n');
  }

  // Peak-power queries — answered from the persisted usage snapshots, no LLM call
  if (/highest\s+power|peak\s+power|power\s+(peak|record|highest|maximum|max)|max(imum)?\s+power/i.test(q)) {
    const snapshots = readRecentUsage();
    if (snapshots.length === 0) {
      return "I don't have any historical power samples yet — snapshots are taken every 5 minutes, so check back after the next one.";
    }
    const peak = snapshots.reduce(
      (best, s) => (s.totalSystemPower > best.totalSystemPower ? s : best),
      snapshots[0],
    );
    const formattedPeak =
      peak.totalSystemPower >= 1000
        ? `${(peak.totalSystemPower / 1000).toFixed(2)} kW`
        : `${peak.totalSystemPower} W`;
    return [
      `📈 The highest total power recorded so far was **${formattedPeak}** at ${new Date(peak.timestamp).toLocaleString()} (${formatPeakTime(peak.timestamp)}).`,
      `For reference, the office is currently drawing **${context.power.formattedWatts}**.`,
      `This answer came from stored usage history, so it works even without the AI service online.`,
    ].join('\n');
  }

  return null;
}
