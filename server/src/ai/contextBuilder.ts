/**
 * Context Builder
 *
 * Fetches a complete, grounded snapshot of the office state from the
 * in-memory store and alert engine. This context object is the ONLY source
 * of data passed to the LLM — it never calls an external API or database,
 * which guarantees the AI cannot hallucinate device facts.
 *
 * The context is intentionally human-readable (not raw IDs) so the LLM
 * can reason about it without needing further translation.
 */

import * as store         from '../store/deviceStore';
import { getAlerts }      from '../services/alertEngine';
import { getPowerSummary } from '../services/deviceSimulator';
import config             from '../config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeviceContext {
  id:          string;
  name:        string;
  room:        string;
  type:        'fan' | 'light';
  status:      'ON' | 'OFF';
  powerWatts:  number;
  lastChanged: string;   // relative, e.g. "3 minutes ago"
}

export interface RoomContext {
  name:          string;
  totalPowerWatts: number;
  activeDevices:  number;
  totalDevices:   number;
  loadPercent:    number;      // 0–100, % of maximum possible room load
  allOn:          boolean;
  allOff:         boolean;
  fans:           { name: string; status: 'ON' | 'OFF'; powerWatts: number }[];
  lights:         { name: string; status: 'ON' | 'OFF'; powerWatts: number }[];
}

export interface AlertContext {
  type:      string;
  severity:  'WARNING' | 'CRITICAL';
  message:   string;
  room:      string | null;
  since:     string;   // relative time
}

export interface OfficeContext {
  capturedAt:      string;   // ISO timestamp — LLM must quote this, not invent time
  officeStatus:    'OPEN' | 'AFTER_HOURS';
  currentHour:     number;
  officeHours:     string;   // e.g. "9:00 – 17:00"

  power: {
    totalWatts:    number;
    formattedWatts: string;  // "345 W" or "1.2 kW"
    activeDevices: number;
    totalDevices:  number;
    idleDevices:   number;
  };

  rooms:   RoomContext[];
  devices: DeviceContext[];
  alerts:  AlertContext[];

  summary: {
    hasAlerts:        boolean;
    criticalAlerts:   number;
    warningAlerts:    number;
    highestLoadRoom:  string | null;
    allDevicesOff:    boolean;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diffMs  = Date.now() - new Date(iso).getTime();
  const mins    = Math.floor(diffMs / 60_000);
  const hours   = Math.floor(mins / 60);
  const days    = Math.floor(hours / 24);
  if (days  > 0) return `${days} day${days  > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (mins  > 0) return `${mins} minute${mins  > 1 ? 's' : ''} ago`;
  return 'just now';
}

function formatWatts(w: number): string {
  return w >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${w} W`;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildOfficeContext(): OfficeContext {
  const now          = new Date();
  const hour         = now.getHours();
  const isOpen       = hour >= config.officeHours.start && hour < config.officeHours.end;
  const allDevices   = store.getAllDevices();
  const alerts       = getAlerts();
  const powerSummary = getPowerSummary();

  // ── Rooms ────────────────────────────────────────────────────────────────
  const rooms: RoomContext[] = store.getRooms().map((roomName) => {
    const rd      = store.getDevicesByRoom(roomName);
    const fans    = rd.filter((d) => d.type === 'fan');
    const lights  = rd.filter((d) => d.type === 'light');
    const maxLoad = fans.length * 60 + lights.length * 15;
    const curLoad = rd.reduce((s, d) => s + d.powerDraw, 0);
    const onCount = rd.filter((d) => d.status).length;

    return {
      name:            roomName,
      totalPowerWatts: curLoad,
      activeDevices:   onCount,
      totalDevices:    rd.length,
      loadPercent:     maxLoad > 0 ? Math.round((curLoad / maxLoad) * 100) : 0,
      allOn:           onCount === rd.length,
      allOff:          onCount === 0,
      fans:  fans.map((d)  => ({ name: d.name, status: d.status ? 'ON' : 'OFF', powerWatts: d.powerDraw })),
      lights: lights.map((d) => ({ name: d.name, status: d.status ? 'ON' : 'OFF', powerWatts: d.powerDraw })),
    };
  });

  // ── Devices ──────────────────────────────────────────────────────────────
  const devices: DeviceContext[] = allDevices.map((d) => ({
    id:          d.id,
    name:        d.name,
    room:        d.room,
    type:        d.type,
    status:      d.status ? 'ON' : 'OFF',
    powerWatts:  d.powerDraw,
    lastChanged: relativeTime(d.lastChanged),
  }));

  // ── Alerts ───────────────────────────────────────────────────────────────
  const alertCtx: AlertContext[] = alerts.map((a) => ({
    type:     a.type === 'AFTER_HOURS' ? 'After-hours device' : 'Sustained load',
    severity: a.severity,
    message:  a.message,
    room:     a.room,
    since:    relativeTime(a.timestamp),
  }));

  // ── Summary ───────────────────────────────────────────────────────────────
  const highestLoadRoom = rooms.reduce<RoomContext | null>(
    (best, r) => (!best || r.totalPowerWatts > best.totalPowerWatts) ? r : best,
    null
  );

  return {
    capturedAt:   now.toISOString(),
    officeStatus: isOpen ? 'OPEN' : 'AFTER_HOURS',
    currentHour:  hour,
    officeHours:  `${config.officeHours.start}:00 – ${config.officeHours.end}:00`,

    power: {
      totalWatts:    powerSummary.totalWatts,
      formattedWatts: formatWatts(powerSummary.totalWatts),
      activeDevices: powerSummary.onCount,
      totalDevices:  powerSummary.onCount + powerSummary.offCount,
      idleDevices:   powerSummary.offCount,
    },

    rooms,
    devices,
    alerts: alertCtx,

    summary: {
      hasAlerts:       alertCtx.length > 0,
      criticalAlerts:  alerts.filter((a) => a.severity === 'CRITICAL').length,
      warningAlerts:   alerts.filter((a) => a.severity === 'WARNING').length,
      highestLoadRoom: highestLoadRoom?.name ?? null,
      allDevicesOff:   powerSummary.onCount === 0,
    },
  };
}
