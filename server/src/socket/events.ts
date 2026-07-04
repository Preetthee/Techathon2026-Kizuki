/**
 * Socket.IO Event Catalogue
 *
 * Single source of truth for every event name and its payload shape.
 * Import these constants instead of using raw strings anywhere — a typo
 * in an event name is a silent bug; a TypeScript error is not.
 *
 * Convention
 * ──────────
 *   S→C  Server → Client  (emit / broadcast)
 *   C→S  Client → Server  (on / once)
 */

import type { Device }       from '../store/deviceStore';
import type { Alert }        from '../services/alertEngine';
import type { PowerSummary } from '../services/deviceSimulator';

// ─── Event name constants ─────────────────────────────────────────────────────

export const EVENTS = {
  // S→C ── device
  DEVICE_UPDATE:    'device:update',   // single device changed
  DEVICES_SNAPSHOT: 'devices:snapshot',// full array on first connect

  // S→C ── power
  USAGE_UPDATE:     'usage:update',    // total + per-room watts

  // S→C ── alerts
  ALERT_NEW:        'alert:new',       // a new alert has been raised
  ALERT_RESOLVED:   'alert:resolved',  // an alert was cleared
  ALERTS_SNAPSHOT:  'alerts:snapshot', // full list on first connect

  // S→C ── meta
  CONNECTED:        'connected',       // welcome payload (socketId, rooms, server time)
  SERVER_STATS:     'server:stats',    // connection counts, uptime

  // C→S ── subscriptions
  SUBSCRIBE_ROOM:   'subscribe:room',  // join a room feed
  UNSUBSCRIBE_ROOM: 'unsubscribe:room',

  // C→S ── control (UI override)
  DEVICE_TOGGLE:    'device:toggle',   // request a toggle (ack-based)
  ALERT_RESOLVE:    'alert:resolve',   // dismiss an alert   (ack-based)

  // Demo mode  (bidirectional)
  DEMO_SET:    'demo:set',     // C→S: { hour, minute } — activate demo time
  DEMO_CLEAR:  'demo:clear',   // C→S: clear demo time, restore real state
  DEMO_STATUS: 'demo:status',  // S→C: DemoStatusPayload broadcast to all clients
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];

// ─── Payload interfaces ───────────────────────────────────────────────────────

export interface DeviceUpdatePayload {
  device:    Device;
  changedAt: string;           // ISO — same as device.lastChanged
}

export interface DevicesSnapshotPayload {
  devices:   Device[];
  timestamp: string;
}

export interface UsageUpdatePayload extends PowerSummary {}

export interface AlertNewPayload {
  alert:     Alert;
  isNew:     boolean;          // false = severity escalation of existing alert
}

export interface AlertResolvedPayload {
  alertId:   string;
  resolvedAt: string;
}

export interface AlertsSnapshotPayload {
  alerts:    Alert[];
  timestamp: string;
}

export interface ConnectedPayload {
  socketId:  string;
  rooms:     string[];         // room keys the client has been auto-joined to
  serverTime: string;
  version:   string;
}

export interface ServerStatsPayload {
  totalConnections: number;
  roomCounts:       Record<string, number>;
  uptime:           number;    // seconds since server start
}

export interface SubscribeRoomPayload {
  room: string;                // a ROOM_KEY value
}

export interface DeviceTogglePayload {
  deviceId: string;
}

export interface DeviceToggleAck {
  ok:     boolean;
  device?: Device;
  error?: string;
}

export interface AlertResolveAck {
  ok:     boolean;
  error?: string;
}

export interface DemoStatusPayload {
  active:     boolean;
  hour?:      number;
  minute?:    number;
  enabledAt?: string;
}

export interface DemoSetPayload {
  hour:   number;
  minute?: number;
}

export interface DemoAck {
  ok:     boolean;
  status?: DemoStatusPayload;
  error?: string;
}

// ─── Typed event maps ─────────────────────────────────────────────────────────
// Used by the Socket.IO Server<C, S> generic to enforce payload types.

export interface ServerToClientEvents {
  [EVENTS.DEVICE_UPDATE]:    (payload: DeviceUpdatePayload)     => void;
  [EVENTS.DEVICES_SNAPSHOT]: (payload: DevicesSnapshotPayload)  => void;
  [EVENTS.USAGE_UPDATE]:     (payload: UsageUpdatePayload)      => void;
  [EVENTS.ALERT_NEW]:        (payload: AlertNewPayload)         => void;
  [EVENTS.ALERT_RESOLVED]:   (payload: AlertResolvedPayload)    => void;
  [EVENTS.ALERTS_SNAPSHOT]:  (payload: AlertsSnapshotPayload)   => void;
  [EVENTS.CONNECTED]:        (payload: ConnectedPayload)        => void;
  [EVENTS.SERVER_STATS]:     (payload: ServerStatsPayload)      => void;
  [EVENTS.DEMO_STATUS]:      (payload: DemoStatusPayload)       => void;
}

export interface ClientToServerEvents {
  [EVENTS.SUBSCRIBE_ROOM]:   (payload: SubscribeRoomPayload,   ack?: (r: { ok: boolean }) => void) => void;
  [EVENTS.UNSUBSCRIBE_ROOM]: (payload: SubscribeRoomPayload,   ack?: (r: { ok: boolean }) => void) => void;
  [EVENTS.DEVICE_TOGGLE]:    (payload: DeviceTogglePayload,    ack?: (r: DeviceToggleAck) => void) => void;
  [EVENTS.ALERT_RESOLVE]:    (payload: { alertId: string },    ack?: (r: AlertResolveAck) => void) => void;
  [EVENTS.DEMO_SET]:         (payload: DemoSetPayload,         ack?: (r: DemoAck) => void) => void;
  [EVENTS.DEMO_CLEAR]:       (ack?: (r: DemoAck) => void) => void;
}

export interface InterServerEvents {}   // for Socket.IO cluster adapter (future)
export interface SocketData {
  connectedAt: Date;
  subscribedRooms: Set<string>;
}
