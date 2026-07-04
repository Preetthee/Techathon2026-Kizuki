import * as store from '../store/deviceStore';
import { Device } from '../store/deviceStore';

export interface RoomSummary {
  room: string;
  deviceCount: number;
  onCount: number;
  offCount: number;
  totalPowerDraw: number;
  devices: Device[];
}

export interface UsageSummary {
  totalPowerDraw: number;
  estimatedTodayKwh: number;
  projectedDailyKwh: number;
  totalDevices: number;
  onCount: number;
  offCount: number;
  rooms: { room: string; powerDraw: number; onCount: number }[];
  timestamp: string;
}

function makeError(message: string, statusCode: number): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

export function listDevices(): Device[] {
  return store.getAllDevices();
}

export function getDevice(id: string): Device {
  const d = store.getDeviceById(id);
  if (!d) throw makeError(`Device not found: ${id}`, 404);
  return d;
}

export function setDeviceStatus(id: string, status: boolean): Device {
  if (typeof status !== 'boolean') throw makeError('status must be a boolean', 400);
  const updated = store.updateDevice(id, { status });
  if (!updated) throw makeError(`Device not found: ${id}`, 404);
  return updated;
}

export function toggleDevice(id: string): Device {
  const updated = store.toggleDevice(id);
  if (!updated) throw makeError(`Device not found: ${id}`, 404);
  return updated;
}

export function getRoomSummaries(): RoomSummary[] {
  return store.getRooms().map((room) => {
    const devices = store.getDevicesByRoom(room);
    const totalPowerDraw = devices.reduce((sum, d) => sum + d.powerDraw, 0);
    const onCount = devices.filter((d) => d.status).length;
    return { room, deviceCount: devices.length, onCount, offCount: devices.length - onCount, totalPowerDraw, devices };
  });
}

export function getUsageSummary(): UsageSummary {
  const all = store.getAllDevices();
  const totalPowerDraw = all.reduce((sum, d) => sum + d.powerDraw, 0);
  const onCount = all.filter((d) => d.status).length;
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const elapsedHoursToday = Math.max((now.getTime() - startOfDay.getTime()) / 3_600_000, 0);
  const estimatedTodayKwh = Number(((totalPowerDraw * elapsedHoursToday) / 1000).toFixed(3));
  const projectedDailyKwh = Number(((totalPowerDraw * 24) / 1000).toFixed(3));
  const rooms = getRoomSummaries().map(({ room, totalPowerDraw: powerDraw, onCount: rOn }) => ({
    room,
    powerDraw,
    onCount: rOn,
  }));
  return {
    totalPowerDraw,
    estimatedTodayKwh,
    projectedDailyKwh,
    totalDevices: all.length,
    onCount,
    offCount: all.length - onCount,
    rooms,
    timestamp: now.toISOString(),
  };
}
