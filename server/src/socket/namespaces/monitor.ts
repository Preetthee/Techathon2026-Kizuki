/**
 * /monitor namespace
 *
 * The primary Socket.IO namespace. All dashboard clients connect here.
 * Admin tooling can connect to /admin (separate namespace, not yet built).
 *
 * Responsibilities
 * ────────────────
 *   • Manage client lifecycle (connect / disconnect / room subscriptions)
 *   • Expose a typed broadcaster used by the simulator and alert engine
 *   • Rate-limit client-initiated events to protect the backend
 *   • Track per-socket metadata for observability
 *
 * Broadcaster pattern
 * ───────────────────
 * Rather than the simulator or alert engine holding a reference to `io`,
 * they receive a typed broadcaster callback. This keeps them decoupled
 * from the transport layer — the same services can be tested or driven
 * by a CLI without a Socket.IO server present.
 */

import {
  Namespace,
  Server as SocketServer,
  Socket,
} from 'socket.io';

import * as deviceService from '../../services/deviceService';
import { resolveAlert, getAlerts, evaluateNow } from '../../services/alertEngine';
import { getPowerSummary }         from '../../services/deviceSimulator';
import { enableDemoMode, disableDemoMode, getDemoStatus } from '../../services/demoModeService';

import {
  EVENTS,
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  DeviceUpdatePayload,
  AlertNewPayload,
  AlertResolvedPayload,
} from '../events';

import {
  ROOM_KEYS,
  AUTO_JOIN_ROOMS,
  SUBSCRIBABLE_ROOMS,
  deviceRoomToKey,
  isValidRoomKey,
  roomKeyLabel,
} from '../rooms';

import type { Alert } from '../../services/alertEngine';
import type { Device } from '../../store/deviceStore';

// ─── Types ────────────────────────────────────────────────────────────────────

type MonitorNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type MonitorSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

// Broadcaster functions consumed by simulator + alert engine
export interface MonitorBroadcaster {
  broadcastDeviceUpdate: (device: Device) => void;
  broadcastUsageUpdate:  () => void;
  broadcastAlertNew:     (alert: Alert, isNew: boolean) => void;
  broadcastAlertResolved:(alertId: string) => void;
}

// ─── Rate limiter (per socket, per event type) ────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 2_000;
const RATE_LIMIT_MAX       = 5;       // max 5 client-initiated events per 2 s

function makeRateLimiter() {
  const counts = new Map<string, number[]>(); // socketId+event → timestamps[]

  return function isAllowed(socketId: string, event: string): boolean {
    const key  = `${socketId}:${event}`;
    const now  = Date.now();
    const hits  = (counts.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    hits.push(now);
    counts.set(key, hits);
    return hits.length <= RATE_LIMIT_MAX;
  };
}

// ─── Connection stats ─────────────────────────────────────────────────────────

const _stats = {
  totalConnections: 0,
  peakConcurrent:   0,
  serverStartedAt:  Date.now(),
};

// ─── Namespace bootstrap ──────────────────────────────────────────────────────

export function createMonitorNamespace(
  io: SocketServer
): { ns: MonitorNamespace; broadcaster: MonitorBroadcaster } {

  const ns: MonitorNamespace = io.of('/monitor');
  const isAllowed = makeRateLimiter();

  // ── Connection handler ───────────────────────────────────────────────────

  ns.on('connection', async (socket: MonitorSocket) => {
    _stats.totalConnections++;
    const concurrent = ns.sockets.size;
    if (concurrent > _stats.peakConcurrent) _stats.peakConcurrent = concurrent;

    // Attach per-socket metadata
    socket.data.connectedAt     = new Date();
    socket.data.subscribedRooms = new Set(AUTO_JOIN_ROOMS);

    // Auto-join global + alerts feed
    await socket.join(AUTO_JOIN_ROOMS);

    console.log(
      `[socket /monitor] + ${socket.id}  (${concurrent} connected)`
    );

    // ── Welcome payload ────────────────────────────────────────────────────
    socket.emit(EVENTS.CONNECTED, {
      socketId:   socket.id,
      rooms:      AUTO_JOIN_ROOMS,
      serverTime: new Date().toISOString(),
      version:    '1.0.0',
    });

    // ── Initial snapshot (full state, no polling needed) ───────────────────
    socket.emit(EVENTS.DEVICES_SNAPSHOT, {
      devices:   deviceService.listDevices(),
      timestamp: new Date().toISOString(),
    });

    socket.emit(EVENTS.USAGE_UPDATE, getPowerSummary());

    socket.emit(EVENTS.ALERTS_SNAPSHOT, {
      alerts:    getAlerts(),
      timestamp: new Date().toISOString(),
    });

    // Send current demo status so client knows immediately on connect
    socket.emit(EVENTS.DEMO_STATUS, getDemoStatus());

    // ── Subscribe to a device-room feed ───────────────────────────────────
    socket.on(EVENTS.SUBSCRIBE_ROOM, async ({ room }, ack) => {
      if (!isAllowed(socket.id, EVENTS.SUBSCRIBE_ROOM)) {
        ack?.({ ok: false });
        return;
      }

      if (!isValidRoomKey(room)) {
        ack?.({ ok: false });
        return;
      }

      await socket.join(room);
      socket.data.subscribedRooms.add(room);
      console.log(`[socket /monitor] ${socket.id} → joined ${roomKeyLabel(room)}`);
      ack?.({ ok: true });
    });

    // ── Unsubscribe from a device-room feed ───────────────────────────────
    socket.on(EVENTS.UNSUBSCRIBE_ROOM, async ({ room }, ack) => {
      if (AUTO_JOIN_ROOMS.includes(room)) {
        ack?.({ ok: false }); // cannot leave auto-join rooms
        return;
      }
      await socket.leave(room);
      socket.data.subscribedRooms.delete(room);
      console.log(`[socket /monitor] ${socket.id} ← left ${roomKeyLabel(room)}`);
      ack?.({ ok: true });
    });

    // ── Client-initiated device toggle ────────────────────────────────────
    socket.on(EVENTS.DEVICE_TOGGLE, ({ deviceId }, ack) => {
      if (!isAllowed(socket.id, EVENTS.DEVICE_TOGGLE)) {
        ack?.({ ok: false, error: 'Rate limit exceeded' });
        return;
      }

      try {
        const updated = deviceService.toggleDevice(deviceId);
        ack?.({ ok: true, device: updated });
        // Broadcast handled by the simulator broadcaster after store update
      } catch (err: any) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // ── Client-initiated alert resolve ────────────────────────────────────
    socket.on(EVENTS.ALERT_RESOLVE, ({ alertId }, ack) => {
      if (!isAllowed(socket.id, EVENTS.ALERT_RESOLVE)) {
        ack?.({ ok: false, error: 'Rate limit exceeded' });
        return;
      }
      const ok = resolveAlert(alertId);
      ack?.({ ok, error: ok ? undefined : 'Alert not found' });
    });

    // ── Demo mode: set fake time ──────────────────────────────────────────
    socket.on(EVENTS.DEMO_SET, ({ hour, minute = 0 }, ack) => {
      if (!isAllowed(socket.id, EVENTS.DEMO_SET)) {
        ack?.({ ok: false, error: 'Rate limit exceeded' });
        return;
      }
      try {
        enableDemoMode(hour, minute);
        evaluateNow();   // immediately re-evaluate alerts at demo time
        const status = getDemoStatus();
        // Broadcast to all clients so every open tab reflects demo mode
        ns.to(ROOM_KEYS.GLOBAL).emit(EVENTS.DEMO_STATUS, status);
        ack?.({ ok: true, status });
      } catch (err: any) {
        ack?.({ ok: false, error: err.message });
      }
    });

    // ── Demo mode: clear (restore real state) ─────────────────────────────
    socket.on(EVENTS.DEMO_CLEAR, (ack) => {
      disableDemoMode();
      evaluateNow();   // re-evaluate alerts at real system time
      const status = getDemoStatus();
      ns.to(ROOM_KEYS.GLOBAL).emit(EVENTS.DEMO_STATUS, status);
      ack?.({ ok: true, status });
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      console.log(
        `[socket /monitor] - ${socket.id}  reason: ${reason}  ` +
        `(${ns.sockets.size} remaining)`
      );
    });
  });

  // ── Broadcaster (used by simulator and alert engine) ─────────────────────

  const broadcaster: MonitorBroadcaster = {

    broadcastDeviceUpdate(device: Device) {
      const payload: DeviceUpdatePayload = {
        device,
        changedAt: device.lastChanged,
      };

      const deviceRoom = deviceRoomToKey(device.room);

      // Emit to the device's specific room (subscribers who want room-level granularity)
      ns.to(deviceRoom).emit(EVENTS.DEVICE_UPDATE, payload);

      // Also emit to global (dashboard clients watching everything)
      // Use except() to avoid double-delivery to sockets in both rooms
      ns.to(ROOM_KEYS.GLOBAL).except(deviceRoom).emit(EVENTS.DEVICE_UPDATE, payload);
    },

    broadcastUsageUpdate() {
      const payload = getPowerSummary();
      // Usage is always global — every connected client needs total + room breakdown
      ns.to(ROOM_KEYS.GLOBAL).emit(EVENTS.USAGE_UPDATE, payload);
    },

    broadcastAlertNew(alert: Alert, isNew: boolean) {
      const payload: AlertNewPayload = { alert, isNew };

      // Emit to dedicated alert-feed room (clients that subscribed for alerts)
      ns.to(ROOM_KEYS.ALERTS_FEED).emit(EVENTS.ALERT_NEW, payload);

      // Also emit to the room the alert concerns (if device-specific)
      if (alert.room) {
        const deviceRoom = deviceRoomToKey(alert.room);
        ns
          .to(deviceRoom)
          .except(ROOM_KEYS.ALERTS_FEED)  // avoid double-delivery
          .emit(EVENTS.ALERT_NEW, payload);
      }
    },

    broadcastAlertResolved(alertId: string) {
      const payload: AlertResolvedPayload = {
        alertId,
        resolvedAt: new Date().toISOString(),
      };
      // Resolved alerts go everywhere — clients need to clear them from UI
      ns.to(ROOM_KEYS.GLOBAL).emit(EVENTS.ALERT_RESOLVED, payload);
    },
  };

  // ── Periodic server-stats broadcast (every 30 s) ─────────────────────────
  setInterval(() => {
    if (ns.sockets.size === 0) return;

    const roomCounts: Record<string, number> = {};
    for (const room of [ROOM_KEYS.GLOBAL, ROOM_KEYS.ALERTS_FEED, ...SUBSCRIBABLE_ROOMS]) {
      const roomSockets = ns.adapter.rooms.get(room);
      roomCounts[room] = roomSockets?.size ?? 0;
    }

    ns.to(ROOM_KEYS.GLOBAL).emit(EVENTS.SERVER_STATS, {
      totalConnections: _stats.totalConnections,
      roomCounts,
      uptime: Math.floor((Date.now() - _stats.serverStartedAt) / 1000),
    });
  }, 30_000);

  return { ns, broadcaster };
}
