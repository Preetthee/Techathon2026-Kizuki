/**
 * Storage Service
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                    PERSISTENCE FLOW                                  │
 * │                                                                      │
 * │  SERVER START                                                        │
 * │    └─ StorageService.init()                                          │
 * │         ├─ createAdapter()  (sqlite or json based on STORAGE_TYPE)   │
 * │         ├─ adapter.init()   (create tables / ensure directory)       │
 * │         └─ loadState()                                               │
 * │              ├─ [no saved state] → build default devices             │
 * │              └─ [saved state]    → restore devices + alerts          │
 * │                   ├─ store.updateDevice() for each persisted device  │
 * │                   └─ alertEngine re-seeded with active alerts        │
 * │                                                                      │
 * │  RUNTIME  (every state change)                                       │
 * │    ├─ Device toggle → saveDevice()  (single row, synchronous)        │
 * │    ├─ Alert raised  → saveAlert()   (single row, synchronous)        │
 * │    ├─ Alert resolved→ resolveAlert() + update in storage             │
 * │    └─ Usage logger  → appendUsageSnapshot() every 5 min             │
 * │                                                                      │
 * │  SERVER STOP  (SIGTERM)                                              │
 * │    └─ saveState()  — full atomic snapshot before process exits       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Storage options
 * ───────────────
 *   STORAGE_TYPE=sqlite  →  ./data/office.db    (preferred — WAL, atomic)
 *   STORAGE_TYPE=json    →  ./data/state.json   (fallback — tmp+rename)
 *
 * If SQLite initialisation fails (e.g. missing native module), the service
 * automatically falls back to the JSON adapter so the app always starts.
 */

import config                    from '../config';
import * as store                 from '../store/deviceStore';
import { getAlerts }              from '../services/alertEngine';
import { getPowerSummary }        from '../services/deviceSimulator';
import { isDemoActive }           from '../services/demoModeService';
import { createSQLiteAdapter }    from './adapters/sqlite';
import { createJSONAdapter }      from './adapters/json';
import type { IStorageAdapter, PersistedState, PersistedDevice, PersistedAlert } from './types';

// ─── Singleton adapter ────────────────────────────────────────────────────────

let _adapter: IStorageAdapter | null = null;

function getAdapter(): IStorageAdapter {
  if (_adapter) return _adapter;
  throw new Error('[storage] StorageService.init() must be called before use');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function init(): void {
  if (_adapter) return;

  if (config.storage.type === 'sqlite') {
    try {
      _adapter = createSQLiteAdapter(config.storage.sqlitePath);
      _adapter.init();
      return;
    } catch (err: any) {
      console.warn(`[storage] SQLite failed (${err.message}) — falling back to JSON`);
    }
  }

  _adapter = createJSONAdapter(config.storage.jsonPath);
  _adapter.init();
}

// ─── loadState ────────────────────────────────────────────────────────────────

/**
 * Restore persisted state into the in-memory store.
 *
 * @returns 'restored' | 'fresh'
 *   'restored' — previous state was found and applied
 *   'fresh'    — no saved state; default devices are already in the store
 */
export function loadState(): 'restored' | 'fresh' {
  const adapter = getAdapter();
  const saved   = adapter.loadState();

  if (!saved || saved.devices.length === 0) {
    console.log('[storage] No saved state — using default devices');
    // Persist the default device list so the next restart can restore it
    _persistAllDevices();
    return 'fresh';
  }

  // Restore device states
  let restoredCount = 0;
  for (const d of saved.devices) {
    const result = store.updateDevice(d.deviceId, {
      status:      d.status,
      powerDraw:   d.powerDraw,
      lastChanged: d.lastChanged,
    });
    if (result) restoredCount++;
  }

  console.log(
    `[storage] Restored ${restoredCount}/${saved.devices.length} devices` +
    ` · ${saved.activeAlerts.length} active alerts` +
    ` · ${saved.recentUsage.length} usage snapshots` +
    `  (saved at ${saved.savedAt})`
  );

  return 'restored';
}

// ─── saveState  (full atomic snapshot — called on shutdown) ──────────────────

export function saveState(): void {
  if (isDemoActive()) { console.log('[storage] saveState skipped — demo mode active'); return; }
  const adapter   = getAdapter();
  const devices   = store.getAllDevices().map(toPersistedDevice);
  const alerts    = getAlerts().map(toPersistedAlert);
  const usage     = buildUsageSnapshot();

  const state: PersistedState = {
    version:      1,
    savedAt:      new Date().toISOString(),
    devices,
    activeAlerts: alerts,
    recentUsage:  [usage],
  };

  adapter.saveState(state);
  console.log(`[storage] State saved  (${devices.length} devices, ${alerts.length} alerts)`);
}

// ─── Granular write-throughs (hot path) ──────────────────────────────────────

/** Call after every device toggle. Synchronous — completes before returning. */
export function saveDevice(device: import('../store/deviceStore').Device): void {
  if (isDemoActive()) return;
  getAdapter().saveDevice(toPersistedDevice(device));
}

/** Call after every alert raise or escalation. */
export function saveAlert(alert: import('../services/alertEngine').Alert): void {
  if (isDemoActive()) return;
  getAdapter().saveAlert(toPersistedAlert(alert));
}

/** Call after resolveAlert(). */
export function markAlertResolved(alertId: string): void {
  if (isDemoActive()) return;
  getAdapter().resolveAlert(alertId, new Date().toISOString());
}

/** Called by usageLogService on each interval tick. */
export function appendUsageSnapshot(): void {
  if (isDemoActive()) return;
  const summary = getPowerSummary();
  getAdapter().appendUsageSnapshot({
    timestamp:        new Date().toISOString(),
    totalSystemPower: summary.totalWatts,
    totalOnCount:     summary.onCount,
    totalDevices:     summary.onCount + summary.offCount,
    roomsJson:        JSON.stringify(summary.rooms),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toPersistedDevice(d: import('../store/deviceStore').Device): PersistedDevice {
  return {
    deviceId:    d.id,
    name:        d.name,
    room:        d.room,
    type:        d.type,
    status:      d.status,
    powerDraw:   d.powerDraw,
    lastChanged: d.lastChanged,
  };
}

function toPersistedAlert(a: import('../services/alertEngine').Alert): PersistedAlert {
  return {
    alertId:     a.id,
    room:        a.room,
    type:        a.type,
    message:     a.message,
    severity:    a.severity,
    deviceId:    a.deviceId,
    triggeredAt: a.timestamp,
    resolvedAt:  a.resolvedAt,
    meta:        JSON.stringify(a.meta ?? {}),
  };
}

function buildUsageSnapshot() {
  const s = getPowerSummary();
  return {
    timestamp:        new Date().toISOString(),
    totalSystemPower: s.totalWatts,
    totalOnCount:     s.onCount,
    totalDevices:     s.onCount + s.offCount,
    roomsJson:        JSON.stringify(s.rooms),
  };
}

function _persistAllDevices(): void {
  const adapter = getAdapter();
  for (const d of store.getAllDevices()) {
    adapter.saveDevice(toPersistedDevice(d));
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function getStorageInfo(): { adapter: string; path: string } {
  const a = getAdapter();
  return {
    adapter: a.name,
    path: a.name === 'sqlite' ? config.storage.sqlitePath : config.storage.jsonPath,
  };
}
