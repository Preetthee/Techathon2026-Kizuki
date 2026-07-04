/**
 * Room Registry
 *
 * Socket.IO "rooms" are named channels within a namespace. Every connected
 * socket can join zero or more rooms. Emitting to a room delivers only to
 * sockets in that room — no wasted bandwidth.
 *
 * Room layout (all within the /monitor namespace)
 * ────────────────────────────────────────────────
 *
 *   global                 ─ every socket is auto-joined here on connect;
 *                            receives all broadcast events
 *
 *   room:drawing_room      ─ events scoped to Drawing Room devices
 *   room:work_room_1       ─ events scoped to Work Room 1 devices
 *   room:work_room_2       ─ events scoped to Work Room 2 devices
 *
 *   feed:alerts            ─ sockets that want alert push notifications;
 *                            auto-joined on connect (alerts affect all rooms)
 *
 * When a device in "Work Room 1" changes, we emit to:
 *   • room:work_room_1   (room-specific subscribers)
 *   • global             (dashboard clients watching everything)
 *
 * When an alert fires we emit to:
 *   • feed:alerts        (dedicated alert subscribers)
 *   • global
 */

import { ROOMS } from '../store/deviceStore';

// ─── Room key constants ───────────────────────────────────────────────────────

export const ROOM_KEYS = {
  GLOBAL:      'global',
  ALERTS_FEED: 'feed:alerts',
  ...Object.fromEntries(
    ROOMS.map((r) => [
      r.replace(/\s+/g, '_').toUpperCase(),
      `room:${r.replace(/\s+/g, '_').toLowerCase()}`,
    ])
  ),
} as const;

export type RoomKey = string;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a device's room name → room key, e.g. "Work Room 1" → "room:work_room_1" */
export function deviceRoomToKey(roomName: string): RoomKey {
  return `room:${roomName.replace(/\s+/g, '_').toLowerCase()}`;
}

/** All auto-join rooms for a freshly connected socket. */
export const AUTO_JOIN_ROOMS: RoomKey[] = [
  ROOM_KEYS.GLOBAL,
  ROOM_KEYS.ALERTS_FEED,
];

/** All valid subscribable room keys (clients can also opt in to device-room feeds). */
export const SUBSCRIBABLE_ROOMS: RoomKey[] = [
  ...ROOMS.map(deviceRoomToKey),
];

/** Validate that a client-supplied room key is one we actually manage. */
export function isValidRoomKey(key: string): boolean {
  return (
    SUBSCRIBABLE_ROOMS.includes(key) ||
    (Object.values(ROOM_KEYS) as string[]).includes(key)
  );
}

/** Human-readable label for a room key (used in log messages). */
export function roomKeyLabel(key: RoomKey): string {
  return key.replace('room:', '').replace(/_/g, ' ');
}
