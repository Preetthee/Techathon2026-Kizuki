/**
 * Device Simulation Service
 *
 * Each of the 15 devices gets its own independent random-interval timer
 * (15–60 s). When a device toggles, powerDraw and lastChanged are updated
 * and three Socket.IO events are emitted:
 *
 *   device:stateChange  → the changed device
 *   usage:update        → recalculated power summary
 *   alerts:update       → active alert list
 */

import { Server as SocketServer } from 'socket.io';
import * as store from '../store/deviceStore';
import { Device, POWER, ROOMS } from '../store/deviceStore';
import { getAllAlerts } from './alertService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PowerSummary {
  totalWatts: number;
  onCount: number;
  offCount: number;
  rooms: RoomPower[];
  timestamp: string;
}

export interface RoomPower {
  room: string;
  watts: number;
  onCount: number;
  deviceCount: number;
}

export interface SimulatorStats {
  running: boolean;
  deviceCount: number;
  activeTimers: number;
  togglesSinceStart: number;
  startedAt: string | null;
}

// ─── Example Device Dataset ───────────────────────────────────────────────────
//
// This is the canonical 15-device layout used by the simulator.
// Fan wattage: 60 W  |  Light wattage: 15 W
//
export const EXAMPLE_DEVICE_DATASET: Omit<Device, 'lastChanged'>[] = [
  // Drawing Room
  { id: 'drawing_room_fan_1',   name: 'Fan 1',   room: 'Drawing Room', type: 'fan',   status: false, powerDraw: 0 },
  { id: 'drawing_room_fan_2',   name: 'Fan 2',   room: 'Drawing Room', type: 'fan',   status: false, powerDraw: 0 },
  { id: 'drawing_room_light_1', name: 'Light 1', room: 'Drawing Room', type: 'light', status: false, powerDraw: 0 },
  { id: 'drawing_room_light_2', name: 'Light 2', room: 'Drawing Room', type: 'light', status: false, powerDraw: 0 },
  { id: 'drawing_room_light_3', name: 'Light 3', room: 'Drawing Room', type: 'light', status: false, powerDraw: 0 },

  // Work Room 1
  { id: 'work_room_1_fan_1',    name: 'Fan 1',   room: 'Work Room 1',  type: 'fan',   status: false, powerDraw: 0 },
  { id: 'work_room_1_fan_2',    name: 'Fan 2',   room: 'Work Room 1',  type: 'fan',   status: false, powerDraw: 0 },
  { id: 'work_room_1_light_1',  name: 'Light 1', room: 'Work Room 1',  type: 'light', status: false, powerDraw: 0 },
  { id: 'work_room_1_light_2',  name: 'Light 2', room: 'Work Room 1',  type: 'light', status: false, powerDraw: 0 },
  { id: 'work_room_1_light_3',  name: 'Light 3', room: 'Work Room 1',  type: 'light', status: false, powerDraw: 0 },

  // Work Room 2
  { id: 'work_room_2_fan_1',    name: 'Fan 1',   room: 'Work Room 2',  type: 'fan',   status: false, powerDraw: 0 },
  { id: 'work_room_2_fan_2',    name: 'Fan 2',   room: 'Work Room 2',  type: 'fan',   status: false, powerDraw: 0 },
  { id: 'work_room_2_light_1',  name: 'Light 1', room: 'Work Room 2',  type: 'light', status: false, powerDraw: 0 },
  { id: 'work_room_2_light_2',  name: 'Light 2', room: 'Work Room 2',  type: 'light', status: false, powerDraw: 0 },
  { id: 'work_room_2_light_3',  name: 'Light 3', room: 'Work Room 2',  type: 'light', status: false, powerDraw: 0 },
];

// ─── Interval bounds (ms) ─────────────────────────────────────────────────────

const MIN_INTERVAL_MS = 15_000;  // 15 s
const MAX_INTERVAL_MS = 60_000;  // 60 s

// ─── Internal state ───────────────────────────────────────────────────────────

export interface SimulatorOptions {
  /** Called after each toggle — use this to broadcast via the /monitor namespace broadcaster. */
  onDeviceUpdate?: (device: Device) => void;
  /** Stagger initial timers over this window (ms) to avoid thundering-herd at start. */
  staggerMs?: number;
}

const _timers = new Map<string, ReturnType<typeof setTimeout>>();
let _io: SocketServer | null = null;
let _onDeviceUpdate: ((device: Device) => void) | null = null;
let _toggleCount = 0;
let _startedAt: string | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomInterval(): number {
  return Math.floor(Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS + 1)) + MIN_INTERVAL_MS;
}

function buildPowerSummary(): PowerSummary {
  const all = store.getAllDevices();
  const totalWatts = all.reduce((sum, d) => sum + d.powerDraw, 0);
  const onCount = all.filter((d) => d.status).length;

  const rooms: RoomPower[] = ROOMS.map((room) => {
    const roomDevices = store.getDevicesByRoom(room);
    return {
      room,
      watts: roomDevices.reduce((sum, d) => sum + d.powerDraw, 0),
      onCount: roomDevices.filter((d) => d.status).length,
      deviceCount: roomDevices.length,
    };
  });

  return {
    totalWatts,
    onCount,
    offCount: all.length - onCount,
    rooms,
    timestamp: new Date().toISOString(),
  };
}

// ─── Event emission ───────────────────────────────────────────────────────────

function emitStateChange(device: Device): void {
  const usage = buildPowerSummary();
  console.log(
    `[simulator] ${device.room} · ${device.name} → ${device.status ? 'ON' : 'OFF'} ` +
    `(${device.powerDraw}W) | total ${usage.totalWatts}W`
  );
  // Delegate broadcasting to the caller-supplied callback (the /monitor broadcaster)
  _onDeviceUpdate?.(device);
}

// ─── Per-device timer loop ────────────────────────────────────────────────────

function scheduleNextToggle(deviceId: string): void {
  if (!_timers.has(deviceId)) return; // simulator was stopped

  const delay = randomInterval();

  const handle = setTimeout(() => {
    const updated = store.toggleDevice(deviceId);
    if (updated) {
      _toggleCount++;
      emitStateChange(updated);
    }
    scheduleNextToggle(deviceId); // reschedule with a new random interval
  }, delay);

  _timers.set(deviceId, handle);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the simulator.
 * @param io      Socket.IO server (kept for compatibility; broadcasting is done via options.onDeviceUpdate)
 * @param options SimulatorOptions — broadcaster callback + stagger window
 */
export function startSimulator(io: SocketServer, options: SimulatorOptions = {}): void {
  if (_timers.size > 0) {
    console.warn('[simulator] Already running — call stopSimulator() first');
    return;
  }

  _io = io;
  _onDeviceUpdate = options.onDeviceUpdate ?? null;
  _toggleCount = 0;
  _startedAt = new Date().toISOString();

  const staggerMs = options.staggerMs ?? 10_000;
  const devices = store.getAllDevices();

  devices.forEach((device, index) => {
    const staggerDelay = Math.floor((index / devices.length) * staggerMs);

    const handle = setTimeout(() => {
      scheduleNextToggle(device.id);
    }, staggerDelay);

    // Park the stagger handle under the device id so stopSimulator can clear it
    _timers.set(device.id, handle);
  });

  console.log(
    `[simulator] Started — ${devices.length} devices, ` +
    `interval: ${MIN_INTERVAL_MS / 1000}–${MAX_INTERVAL_MS / 1000}s per device, ` +
    `stagger: ${staggerMs / 1000}s`
  );
}

/**
 * Stop all device timers cleanly.
 */
export function stopSimulator(): void {
  for (const handle of _timers.values()) {
    clearTimeout(handle);
  }
  _timers.clear();
  _io = null;
  console.log(`[simulator] Stopped after ${_toggleCount} toggle(s)`);
}

/**
 * Runtime stats — useful for a /health or /debug endpoint.
 */
export function getSimulatorStats(): SimulatorStats {
  return {
    running: _timers.size > 0,
    deviceCount: store.getAllDevices().length,
    activeTimers: _timers.size,
    togglesSinceStart: _toggleCount,
    startedAt: _startedAt,
  };
}

/**
 * Returns a snapshot of current power consumption.
 * Safe to call at any time (does not require simulator to be running).
 */
export function getPowerSummary(): PowerSummary {
  return buildPowerSummary();
}
