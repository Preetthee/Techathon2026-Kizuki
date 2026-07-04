/**
 * SQLite Adapter  (preferred)
 *
 * Uses better-sqlite3 — synchronous, zero-config, single file.
 * Perfect for hackathons: no separate process, no network, instant reads.
 *
 * Schema
 * ──────
 *   devices          — one row per device, upserted on every state change
 *   alerts           — full alert history (active + resolved)
 *   usage_snapshots  — time-series power snapshots, auto-pruned to last 1 000
 *   server_meta      — key/value pairs (schema version, last save time)
 */

import Database from 'better-sqlite3';
import path     from 'path';
import fs       from 'fs';
import type { IStorageAdapter, PersistedDevice, PersistedAlert, PersistedUsageSnapshot, PersistedState } from '../types';

const SCHEMA_VERSION   = 1;
const DEFAULT_KEEP_LAST = 1_000;   // usage snapshots retained

// ─── DDL ──────────────────────────────────────────────────────────────────────

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS server_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  device_id    TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  room         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('fan','light')),
  status       INTEGER NOT NULL DEFAULT 0,
  power_draw   REAL    NOT NULL DEFAULT 0,
  last_changed TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_room ON devices(room);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id     TEXT PRIMARY KEY,
  room         TEXT,
  type         TEXT NOT NULL,
  message      TEXT NOT NULL,
  severity     TEXT NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  device_id    TEXT,
  triggered_at TEXT NOT NULL,
  resolved_at  TEXT,
  meta         TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_alerts_type      ON alerts(type);
CREATE INDEX IF NOT EXISTS idx_alerts_severity  ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved  ON alerts(resolved_at);

CREATE TABLE IF NOT EXISTS usage_snapshots (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp          TEXT    NOT NULL,
  total_system_power REAL    NOT NULL,
  total_on_count     INTEGER NOT NULL,
  total_devices      INTEGER NOT NULL,
  rooms_json         TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_snapshots(timestamp DESC);
`;

// ─── Adapter ──────────────────────────────────────────────────────────────────

export function createSQLiteAdapter(dbPath: string): IStorageAdapter {
  let db: Database.Database;

  return {
    name: 'sqlite',

    init() {
      // Ensure parent directory exists
      const dir = path.dirname(path.resolve(dbPath));
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      db = new Database(dbPath);
      db.exec(DDL);

      // Stamp schema version if missing
      const meta = db.prepare('INSERT OR IGNORE INTO server_meta VALUES (?,?)');
      meta.run('schema_version', String(SCHEMA_VERSION));

      console.log(`[storage/sqlite] Ready  →  ${path.resolve(dbPath)}`);
    },

    // ── Full state ────────────────────────────────────────────────────────────

    saveState(state: PersistedState) {
      const tx = db.transaction(() => {
        // Devices
        const upsertDevice = db.prepare(`
          INSERT INTO devices (device_id,name,room,type,status,power_draw,last_changed)
          VALUES (@deviceId,@name,@room,@type,@status,@powerDraw,@lastChanged)
          ON CONFLICT(device_id) DO UPDATE SET
            status       = excluded.status,
            power_draw   = excluded.power_draw,
            last_changed = excluded.last_changed
        `);
        for (const d of state.devices) {
          upsertDevice.run({ ...d, status: d.status ? 1 : 0 });
        }

        // Alerts (upsert — preserves triggeredAt on re-raise)
        const upsertAlert = db.prepare(`
          INSERT INTO alerts (alert_id,room,type,message,severity,device_id,triggered_at,resolved_at,meta)
          VALUES (@alertId,@room,@type,@message,@severity,@deviceId,@triggeredAt,@resolvedAt,@meta)
          ON CONFLICT(alert_id) DO UPDATE SET
            severity    = excluded.severity,
            message     = excluded.message,
            resolved_at = excluded.resolved_at,
            meta        = excluded.meta
        `);
        for (const a of state.activeAlerts) upsertAlert.run(a);

        // Usage snapshots
        const insertSnap = db.prepare(`
          INSERT INTO usage_snapshots (timestamp,total_system_power,total_on_count,total_devices,rooms_json)
          VALUES (@timestamp,@totalSystemPower,@totalOnCount,@totalDevices,@roomsJson)
        `);
        for (const s of state.recentUsage) insertSnap.run(s);

        // Meta
        db.prepare('INSERT OR REPLACE INTO server_meta VALUES (?,?)').run('last_saved_at', state.savedAt);
      });

      tx();
    },

    loadState(): PersistedState | null {
      const lastSaved = db.prepare<[], { value: string }>(
        "SELECT value FROM server_meta WHERE key='last_saved_at'"
      ).get();

      if (!lastSaved) return null;

      const devices = db.prepare<[], Record<string, unknown>>(
        'SELECT device_id,name,room,type,status,power_draw,last_changed FROM devices'
      ).all().map((r) => ({
        deviceId:    r.device_id    as string,
        name:        r.name         as string,
        room:        r.room         as string,
        type:        r.type         as 'fan' | 'light',
        status:      (r.status as number) === 1,
        powerDraw:   r.power_draw   as number,
        lastChanged: r.last_changed as string,
      }));

      const activeAlerts = db.prepare<[], Record<string, unknown>>(
        'SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY triggered_at DESC'
      ).all().map((r) => ({
        alertId:     r.alert_id     as string,
        room:        r.room         as string | null,
        type:        r.type         as 'AFTER_HOURS' | 'SUSTAINED_LOAD',
        message:     r.message      as string,
        severity:    r.severity     as 'WARNING' | 'CRITICAL',
        deviceId:    r.device_id    as string | null,
        triggeredAt: r.triggered_at as string,
        resolvedAt:  r.resolved_at  as string | null,
        meta:        r.meta         as string,
      }));

      const recentUsage = db.prepare<[], Record<string, unknown>>(
        'SELECT timestamp,total_system_power,total_on_count,total_devices,rooms_json FROM usage_snapshots ORDER BY timestamp DESC LIMIT 100'
      ).all().map((r) => ({
        timestamp:        r.timestamp         as string,
        totalSystemPower: r.total_system_power as number,
        totalOnCount:     r.total_on_count     as number,
        totalDevices:     r.total_devices      as number,
        roomsJson:        r.rooms_json         as string,
      }));

      return {
        version:      SCHEMA_VERSION,
        savedAt:      lastSaved.value,
        devices,
        activeAlerts,
        recentUsage,
      };
    },

    // ── Granular writes (hot path — called on every state change) ─────────────

    saveDevice(device: PersistedDevice) {
      db.prepare(`
        INSERT INTO devices (device_id,name,room,type,status,power_draw,last_changed)
        VALUES (@deviceId,@name,@room,@type,@status,@powerDraw,@lastChanged)
        ON CONFLICT(device_id) DO UPDATE SET
          status       = excluded.status,
          power_draw   = excluded.power_draw,
          last_changed = excluded.last_changed
      `).run({ ...device, status: device.status ? 1 : 0 });
    },

    saveAlert(alert: PersistedAlert) {
      db.prepare(`
        INSERT INTO alerts (alert_id,room,type,message,severity,device_id,triggered_at,resolved_at,meta)
        VALUES (@alertId,@room,@type,@message,@severity,@deviceId,@triggeredAt,@resolvedAt,@meta)
        ON CONFLICT(alert_id) DO UPDATE SET
          severity    = excluded.severity,
          message     = excluded.message,
          resolved_at = excluded.resolved_at,
          meta        = excluded.meta
      `).run(alert);
    },

    resolveAlert(alertId: string, resolvedAt: string) {
      db.prepare('UPDATE alerts SET resolved_at=? WHERE alert_id=?').run(resolvedAt, alertId);
    },

    appendUsageSnapshot(snapshot: PersistedUsageSnapshot, keepLast = DEFAULT_KEEP_LAST) {
      db.prepare(`
        INSERT INTO usage_snapshots (timestamp,total_system_power,total_on_count,total_devices,rooms_json)
        VALUES (@timestamp,@totalSystemPower,@totalOnCount,@totalDevices,@roomsJson)
      `).run(snapshot);

      // Prune old rows beyond keepLast
      db.prepare(`
        DELETE FROM usage_snapshots
        WHERE id NOT IN (
          SELECT id FROM usage_snapshots ORDER BY id DESC LIMIT ?
        )
      `).run(keepLast);
    },
  };
}
