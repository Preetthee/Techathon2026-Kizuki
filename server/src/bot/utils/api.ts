/**
 * Typed API client — thin fetch wrappers over the backend REST endpoints.
 * Uses the native Node 18+ fetch (no extra dependency).
 */

import botConfig from '../config';

// ─── Shared types (mirror the backend schemas) ────────────────────────────────

export interface Device {
  id: string;
  name: string;
  room: string;
  type: 'fan' | 'light';
  status: boolean;
  powerDraw: number;
  lastChanged: string;
}

export interface RoomSummary {
  room: string;
  deviceCount: number;
  onCount: number;
  offCount: number;
  totalPowerDraw: number;
  devices: Device[];
}

export interface RoomUsage {
  room: string;
  powerDraw: number;
  onCount: number;
}

export interface UsageSummary {
  totalPowerDraw: number;
  totalDevices: number;
  onCount: number;
  offCount: number;
  rooms: RoomUsage[];
  timestamp: string;
}

export interface Alert {
  id: string;
  room: string | null;
  type: 'AFTER_HOURS' | 'SUSTAINED_LOAD';
  message: string;
  timestamp: string;
  severity: 'WARNING' | 'CRITICAL';
  deviceId: string | null;
  meta: Record<string, unknown>;
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const url = `${botConfig.apiBaseUrl}${path}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(8_000) });

  if (!res.ok) {
    throw new Error(`API ${path} responded ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

// ─── Endpoint wrappers ────────────────────────────────────────────────────────

export const api = {
  devices: ()            => get<Device[]>('/devices'),
  rooms:   ()            => get<RoomSummary[]>('/rooms'),
  room:    (name: string)=> get<RoomSummary>(`/rooms/${encodeURIComponent(name)}`),
  usage:   ()            => get<UsageSummary>('/usage'),
  alerts:  ()            => get<Alert[]>('/alerts'),
};
