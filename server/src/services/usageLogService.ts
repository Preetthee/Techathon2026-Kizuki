/**
 * Usage Log Service
 *
 * Snapshots device state to MongoDB on a configurable interval.
 * Each document captures the full system state at one point in time.
 *
 * This is the data source for all aggregation queries (aggregationService.ts).
 */

import { UsageLogModel }         from '../models/UsageLog';
import * as store                from '../store/deviceStore';
import config                    from '../config';
import { appendUsageSnapshot }   from '../storage/StorageService';

let _timer: ReturnType<typeof setInterval> | null = null;

// ─── Snapshot writer ──────────────────────────────────────────────────────────

async function writeSnapshot(): Promise<void> {
  const allDevices = store.getAllDevices();
  const rooms      = store.getRooms();

  const deviceReadings = allDevices.map((d) => ({
    deviceId:  d.id,
    name:      d.name,
    room:      d.room,
    type:      d.type,
    status:    d.status,
    powerDraw: d.powerDraw,
  }));

  const roomRollups = rooms.map((room) => {
    const rd = allDevices.filter((d) => d.room === room);
    return {
      room,
      totalPowerDraw: rd.reduce((s, d) => s + d.powerDraw, 0),
      onCount:        rd.filter((d) => d.status).length,
      deviceCount:    rd.length,
    };
  });

  const totalSystemPower = allDevices.reduce((s, d) => s + d.powerDraw, 0);
  const totalOnCount     = allDevices.filter((d) => d.status).length;

  // Persist to disk (SQLite/JSON) — synchronous, always succeeds
  appendUsageSnapshot();

  // Persist to MongoDB — async, best-effort for analytics
  await UsageLogModel.create({
    timestamp:        new Date(),
    totalSystemPower,
    totalOnCount,
    totalDevices:     allDevices.length,
    intervalMs:       config.usageLogIntervalMs,
    devices:          deviceReadings,
    rooms:            roomRollups,
  });
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function startUsageLogger(): void {
  if (_timer) return;

  // Write an initial snapshot immediately at startup
  writeSnapshot().catch((err) =>
    console.error('[usage-log] Initial snapshot failed:', err.message)
  );

  _timer = setInterval(() => {
    writeSnapshot().catch((err) =>
      console.error('[usage-log] Snapshot failed:', err.message)
    );
  }, config.usageLogIntervalMs);

  console.log(
    `[usage-log] Started — snapshotting every ${config.usageLogIntervalMs / 1000}s`
  );
}

export function stopUsageLogger(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('[usage-log] Stopped');
  }
}
