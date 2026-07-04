export type DeviceType = 'fan' | 'light';

export interface Device {
  id: string;
  name: string;
  room: string;
  type: DeviceType;
  status: boolean;
  powerDraw: number;
  lastChanged: string;
}

export const POWER: Record<DeviceType, number> = { fan: 60, light: 15 };
export const ROOMS = ['Drawing Room', 'Work Room 1', 'Work Room 2'] as const;

function buildDevices(): Device[] {
  const devices: Device[] = [];
  ROOMS.forEach((room) => {
    for (let f = 1; f <= 2; f++) {
      const id = `${room.replace(/\s+/g, '_').toLowerCase()}_fan_${f}`;
      devices.push({ id, name: `Fan ${f}`, room, type: 'fan', status: false, powerDraw: 0, lastChanged: new Date().toISOString() });
    }
    for (let l = 1; l <= 3; l++) {
      const id = `${room.replace(/\s+/g, '_').toLowerCase()}_light_${l}`;
      devices.push({ id, name: `Light ${l}`, room, type: 'light', status: false, powerDraw: 0, lastChanged: new Date().toISOString() });
    }
  });
  return devices;
}

const _store = new Map<string, Device>(buildDevices().map((d) => [d.id, d]));

// Tracks the moment when ALL devices in a room turned ON simultaneously
const _roomAllOnSince = new Map<string, Date | null>(ROOMS.map((r) => [r, null]));

export function getAllDevices(): Device[] {
  return [..._store.values()];
}

export function getDeviceById(id: string): Device | null {
  return _store.get(id) ?? null;
}

export function getDevicesByRoom(room: string): Device[] {
  return [..._store.values()].filter((d) => d.room === room);
}

export function updateDevice(id: string, patch: Partial<Device>): Device | null {
  const device = _store.get(id);
  if (!device) return null;
  const updated: Device = { ...device, ...patch, id, lastChanged: new Date().toISOString() };
  updated.powerDraw = updated.status ? POWER[updated.type] : 0;
  _store.set(id, updated);
  _updateRoomAllOnTimestamp(updated.room);
  return updated;
}

export function toggleDevice(id: string): Device | null {
  const device = _store.get(id);
  if (!device) return null;
  return updateDevice(id, { status: !device.status });
}

export function getRooms(): readonly string[] {
  return ROOMS;
}

export function getRoomAllOnSince(room: string): Date | null {
  return _roomAllOnSince.get(room) ?? null;
}

function _updateRoomAllOnTimestamp(room: string): void {
  const devices = getDevicesByRoom(room);
  const allOn = devices.every((d) => d.status === true);
  if (allOn && _roomAllOnSince.get(room) === null) {
    _roomAllOnSince.set(room, new Date());
  } else if (!allOn) {
    _roomAllOnSince.set(room, null);
  }
}
