/**
 * JSON File Adapter  (fallback)
 *
 * Writes the full state to a single JSON file on every change.
 * Simpler than SQLite but less efficient for large histories.
 * Suitable for hackathons, CI environments, and systems without native modules.
 *
 * File layout:  { version, savedAt, devices[], activeAlerts[], recentUsage[] }
 *
 * Atomicity: writes to <file>.tmp first, then renames — prevents corruption
 * if the process is killed mid-write.
 */

import fs   from 'fs';
import path from 'path';
import type { IStorageAdapter, PersistedDevice, PersistedAlert, PersistedUsageSnapshot, PersistedState } from '../types';

const SCHEMA_VERSION    = 1;
const DEFAULT_KEEP_LAST = 200;

export function createJSONAdapter(filePath: string): IStorageAdapter {
  const absPath = path.resolve(filePath);
  const tmpPath = absPath + '.tmp';

  let _cache: PersistedState | null = null;

  function read(): PersistedState | null {
    if (_cache) return _cache;
    if (!fs.existsSync(absPath)) return null;
    try {
      _cache = JSON.parse(fs.readFileSync(absPath, 'utf8')) as PersistedState;
      return _cache;
    } catch {
      console.warn('[storage/json] State file is corrupted — starting fresh');
      return null;
    }
  }

  function write(state: PersistedState): void {
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(tmpPath, json, 'utf8');
    fs.renameSync(tmpPath, absPath);   // atomic on POSIX; near-atomic on Windows
    _cache = state;
  }

  function getOrDefault(): PersistedState {
    return read() ?? {
      version:      SCHEMA_VERSION,
      savedAt:      new Date().toISOString(),
      devices:      [],
      activeAlerts: [],
      recentUsage:  [],
    };
  }

  return {
    name: 'json',

    init() {
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      console.log(`[storage/json] Ready  →  ${absPath}`);
    },

    saveState(state: PersistedState) {
      write({ ...state, savedAt: new Date().toISOString() });
    },

    loadState(): PersistedState | null {
      return read();
    },

    saveDevice(device: PersistedDevice) {
      const state = getOrDefault();
      const idx   = state.devices.findIndex((d) => d.deviceId === device.deviceId);
      if (idx >= 0) state.devices[idx] = device;
      else          state.devices.push(device);
      write({ ...state, savedAt: new Date().toISOString() });
    },

    saveAlert(alert: PersistedAlert) {
      const state = getOrDefault();
      const idx   = state.activeAlerts.findIndex((a) => a.alertId === alert.alertId);
      if (idx >= 0) state.activeAlerts[idx] = alert;
      else          state.activeAlerts.push(alert);
      write({ ...state, savedAt: new Date().toISOString() });
    },

    resolveAlert(alertId: string, resolvedAt: string) {
      const state = getOrDefault();
      const alert = state.activeAlerts.find((a) => a.alertId === alertId);
      if (alert) alert.resolvedAt = resolvedAt;
      // Remove from active list — resolved alerts live in MongoDB history
      state.activeAlerts = state.activeAlerts.filter((a) => a.resolvedAt === null);
      write({ ...state, savedAt: new Date().toISOString() });
    },

    appendUsageSnapshot(snapshot: PersistedUsageSnapshot, keepLast = DEFAULT_KEEP_LAST) {
      const state = getOrDefault();
      state.recentUsage.unshift(snapshot);
      if (state.recentUsage.length > keepLast) {
        state.recentUsage = state.recentUsage.slice(0, keepLast);
      }
      write({ ...state, savedAt: new Date().toISOString() });
    },
  };
}
