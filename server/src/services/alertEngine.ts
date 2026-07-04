/**
 * Alert Engine
 *
 * Two alert rules:
 *
 *   AFTER_HOURS   — any device that is ON after 17:00 (5 PM).
 *                   Re-evaluated every minute. Clears automatically
 *                   when the device turns OFF or office hours resume.
 *
 *   SUSTAINED_LOAD — all devices in a room have been ON continuously
 *                   for more than 2 hours.
 *                   Triggered once per room per sustained-on window;
 *                   escalates to CRITICAL after 4 hours.
 *
 * Duplicate prevention
 * ────────────────────
 * Every alert has a deterministic string id derived from its rule + context.
 * The in-memory store is a Map<id, Alert>, so inserting the same id twice
 * is a no-op — no duplicates can accumulate.
 *
 * Lifecycle
 * ─────────
 *   startAlertEngine(io)  — begin evaluation loop
 *   stopAlertEngine()     — cancel all timers
 *   getAlerts()           — current snapshot (used by REST + socket)
 *   resolveAlert(id)      — manually dismiss an alert (e.g. from admin UI)
 *   onAlert(fn)           — subscribe to new-alert events (for Discord bot etc.)
 */

import { Server as SocketServer } from 'socket.io';
import * as store from '../store/deviceStore';
import { ROOMS } from '../store/deviceStore';
import { getEffectiveHour } from './demoModeService';

// ─── Schema ───────────────────────────────────────────────────────────────────

export type AlertType     = 'AFTER_HOURS' | 'SUSTAINED_LOAD';
export type AlertSeverity = 'WARNING' | 'CRITICAL';

export interface Alert {
  id:        string;
  room:      string | null;   // null for device-level alerts without room context
  type:      AlertType;
  message:   string;
  timestamp: string;          // ISO — when this alert was first raised
  severity:  AlertSeverity;
  // Extended metadata (not in the base schema, included for richness)
  deviceId:  string | null;
  resolvedAt: string | null;
  meta:      Record<string, unknown>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OFFICE_CLOSE_HOUR        = 17;                   // 5 PM
const SUSTAINED_WARN_MS        = 2 * 60 * 60 * 1000;  // 2 h  → WARNING
const SUSTAINED_CRITICAL_MS    = 4 * 60 * 60 * 1000;  // 4 h  → CRITICAL (escalation)
const EVALUATION_INTERVAL_MS   = 60_000;               // evaluate every 60 s

// ─── In-memory store ──────────────────────────────────────────────────────────
//
// Map<alertId, Alert>  — deterministic ids prevent duplicates.
// Only ACTIVE (unresolved) alerts live here.

const _alerts = new Map<string, Alert>();

// Tracks when each room first had every device ON in the current window.
// Separate from deviceStore._roomAllOnSince so the engine owns its own state.
const _roomAllOnSince = new Map<string, Date | null>(
  ROOMS.map((r) => [r, null])
);

// ─── Subscriber registry (Discord bot hook) ───────────────────────────────────

type AlertListener = (alert: Alert) => void;
const _listeners: AlertListener[] = [];

export function onAlert(fn: AlertListener): () => void {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx !== -1) _listeners.splice(idx, 1);
  };
}

function _notify(alert: Alert): void {
  for (const fn of _listeners) {
    try { fn(alert); } catch { /* listener errors must not crash the engine */ }
  }
}

// ─── Alert helpers ────────────────────────────────────────────────────────────

function _isAfterHours(): boolean {
  return getEffectiveHour() >= OFFICE_CLOSE_HOUR;
}

function _upsertAlert(alert: Alert, io: SocketServer | null): void {
  const isNew = !_alerts.has(alert.id);

  if (!isNew) {
    // Only update severity (escalation) — do not change timestamp or message
    const existing = _alerts.get(alert.id)!;
    if (existing.severity === alert.severity) return; // nothing changed
    _alerts.set(alert.id, { ...existing, severity: alert.severity });
    _broadcastAlerts(io);
    return;
  }

  _alerts.set(alert.id, alert);
  _notify(alert);
  _broadcastAlerts(io);

  console.log(
    `[alert-engine] ▲ ${alert.severity} ${alert.type} — ${alert.message}`
  );
}

function _resolveById(id: string, io: SocketServer | null): void {
  const alert = _alerts.get(id);
  if (!alert) return;
  _alerts.delete(id);
  _broadcastAlerts(io);
  console.log(`[alert-engine] ✓ resolved: ${id}`);
}

function _broadcastAlerts(io: SocketServer | null): void {
  if (!io) return;
  io.emit('alerts:update', getAlerts());
}

// ─── Rule 1: After-hours devices ─────────────────────────────────────────────

function _evaluateAfterHours(io: SocketServer | null): void {
  if (!_isAfterHours()) {
    // Office hours resumed — clear all after-hours alerts
    for (const id of _alerts.keys()) {
      if (id.startsWith('after_hours:')) _resolveById(id, io);
    }
    return;
  }

  const onDevices = store.getAllDevices().filter((d) => d.status);
  const activeIds = new Set(onDevices.map((d) => `after_hours:${d.id}`));

  // Raise alerts for devices that are ON
  for (const device of onDevices) {
    const alertId = `after_hours:${device.id}`;
    _upsertAlert(
      {
        id:        alertId,
        room:      device.room,
        type:      'AFTER_HOURS',
        message:   `${device.name} in "${device.room}" is ON after office hours (${OFFICE_CLOSE_HOUR}:00)`,
        timestamp: new Date().toISOString(),
        severity:  'WARNING',
        deviceId:  device.id,
        resolvedAt: null,
        meta: {
          deviceType: device.type,
          powerDraw:  device.powerDraw,
        },
      },
      io
    );
  }

  // Clear alerts for devices that have since turned OFF
  for (const id of _alerts.keys()) {
    if (id.startsWith('after_hours:') && !activeIds.has(id)) {
      _resolveById(id, io);
    }
  }
}

// ─── Rule 2: Sustained load (all devices in a room ON for >2 h) ───────────────

function _evaluateSustainedLoad(io: SocketServer | null): void {
  for (const room of ROOMS) {
    const roomDevices  = store.getDevicesByRoom(room);
    const allOn        = roomDevices.length > 0 && roomDevices.every((d) => d.status);
    const alertId      = `sustained_load:${room.replace(/\s+/g, '_').toLowerCase()}`;

    if (!allOn) {
      // Reset tracking and clear any existing sustained-load alert for this room
      _roomAllOnSince.set(room, null);
      _resolveById(alertId, io);
      continue;
    }

    // Start tracking if this is the beginning of an all-on window
    if (!_roomAllOnSince.get(room)) {
      _roomAllOnSince.set(room, new Date());
    }

    const since      = _roomAllOnSince.get(room)!;
    const durationMs = Date.now() - since.getTime();
    const hours      = (durationMs / 3_600_000).toFixed(1);

    if (durationMs < SUSTAINED_WARN_MS) continue;  // under threshold — no alert yet

    const severity: AlertSeverity = durationMs >= SUSTAINED_CRITICAL_MS ? 'CRITICAL' : 'WARNING';
    const totalWatts = roomDevices.reduce((sum, d) => sum + d.powerDraw, 0);

    _upsertAlert(
      {
        id:       alertId,
        room,
        type:     'SUSTAINED_LOAD',
        message:  `All devices in "${room}" have been ON for ${hours} hours (${totalWatts}W sustained)`,
        timestamp: since.toISOString(),      // when the window started, not now
        severity,
        deviceId:  null,
        resolvedAt: null,
        meta: {
          durationMs,
          totalWatts,
          deviceCount: roomDevices.length,
          sinceISO:    since.toISOString(),
        },
      },
      io
    );
  }
}

// ─── Evaluation loop ──────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;
let _io: SocketServer | null = null;

function _runEvaluation(): void {
  _evaluateAfterHours(_io);
  _evaluateSustainedLoad(_io);
}

export function startAlertEngine(io: SocketServer): void {
  if (_timer) {
    console.warn('[alert-engine] Already running');
    return;
  }
  _io = io;
  _runEvaluation();                                  // immediate first pass
  _timer = setInterval(_runEvaluation, EVALUATION_INTERVAL_MS);
  console.log(`[alert-engine] Started — evaluating every ${EVALUATION_INTERVAL_MS / 1000}s`);
}

export function stopAlertEngine(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    _io = null;
    console.log('[alert-engine] Stopped');
  }
}

// ─── Public query API ─────────────────────────────────────────────────────────

/** All currently active (unresolved) alerts, newest first. */
export function getAlerts(): Alert[] {
  return [..._alerts.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/** Alerts filtered by room. */
export function getAlertsByRoom(room: string): Alert[] {
  return getAlerts().filter((a) => a.room === room);
}

/** Alerts filtered by type. */
export function getAlertsByType(type: AlertType): Alert[] {
  return getAlerts().filter((a) => a.type === type);
}

/** Manually resolve an alert by id (admin dismiss). */
export function resolveAlert(id: string): boolean {
  if (!_alerts.has(id)) return false;
  _resolveById(id, _io);
  return true;
}

/**
 * Force an immediate evaluation pass.
 * Call this after any device state change for instant alert feedback
 * rather than waiting for the next 60 s tick.
 */
export function evaluateNow(): void {
  _runEvaluation();
}

/**
 * Returns a structured summary — designed for Discord embeds or Slack payloads.
 * Returns null when there are no active alerts.
 */
export function getAlertSummaryForBot(): {
  total: number;
  critical: number;
  warning: number;
  afterHours: number;
  sustainedLoad: number;
  alerts: Alert[];
} | null {
  const active = getAlerts();
  if (active.length === 0) return null;
  return {
    total:         active.length,
    critical:      active.filter((a) => a.severity === 'CRITICAL').length,
    warning:       active.filter((a) => a.severity === 'WARNING').length,
    afterHours:    active.filter((a) => a.type === 'AFTER_HOURS').length,
    sustainedLoad: active.filter((a) => a.type === 'SUSTAINED_LOAD').length,
    alerts: active,
  };
}
