/**
 * Device DB Service
 *
 * Bridges the in-memory deviceStore (real-time state) and the MongoDB
 * Device collection (durable persistence).
 *
 * Strategy:
 *   • On server start → seed in-memory store from DB if records exist,
 *     otherwise write the store's default state to DB.
 *   • On every state change → upsert the changed device in DB.
 *   • DB failures are logged but never crash the process — the in-memory
 *     store continues to serve live data even if Mongo is temporarily down.
 */

import { DeviceModel, IDevice } from '../models/Device';
import * as store from '../store/deviceStore';
import { Device } from '../store/deviceStore';

// ─── Startup sync ─────────────────────────────────────────────────────────────

/**
 * Called once at boot.
 * If the DB has device records, load them into the in-memory store.
 * If not, persist the store's default initial state to the DB.
 */
export async function syncDevicesOnStartup(): Promise<void> {
  const count = await DeviceModel.countDocuments();

  if (count > 0) {
    // Restore last-known state from DB
    const dbDevices = await DeviceModel.find().lean();
    let restored = 0;

    for (const doc of dbDevices) {
      const updated = store.updateDevice(doc.deviceId, {
        status:      doc.status,
        powerDraw:   doc.powerDraw,
        lastChanged: new Date(doc.lastChanged).toISOString(),
      });
      if (updated) restored++;
    }

    console.log(`[device-db] Restored ${restored}/${dbDevices.length} device states from MongoDB`);
  } else {
    // First run — persist defaults
    const devices = store.getAllDevices();
    const docs = devices.map((d) => ({
      deviceId:    d.id,
      name:        d.name,
      room:        d.room,
      type:        d.type,
      status:      d.status,
      powerDraw:   d.powerDraw,
      lastChanged: new Date(d.lastChanged),
    }));

    await DeviceModel.insertMany(docs, { ordered: false });
    console.log(`[device-db] Seeded ${docs.length} devices into MongoDB`);
  }
}

// ─── Write-through on state change ───────────────────────────────────────────

/**
 * Upsert a single device after a state change.
 * Fire-and-forget — errors are logged, not propagated.
 */
export function persistDeviceChange(device: Device): void {
  DeviceModel.findOneAndUpdate(
    { deviceId: device.id },
    {
      status:      device.status,
      powerDraw:   device.powerDraw,
      lastChanged: new Date(device.lastChanged),
    },
    { upsert: true, new: true }
  ).catch((err) => console.error(`[device-db] Failed to persist ${device.id}:`, err.message));
}

// ─── Read queries ─────────────────────────────────────────────────────────────

export async function getDeviceHistory(
  deviceId: string,
  limitDays = 7
): Promise<{ timestamp: Date; status: boolean; powerDraw: number }[]> {
  const since = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  // Pull readings from UsageLogs — unwind device array and filter by deviceId
  const { UsageLogModel } = await import('../models/UsageLog');

  return UsageLogModel.aggregate([
    { $match: { timestamp: { $gte: since } } },
    { $unwind: '$devices' },
    { $match: { 'devices.deviceId': deviceId } },
    { $sort:  { timestamp: 1 } },
    {
      $project: {
        _id:       0,
        timestamp: 1,
        status:    '$devices.status',
        powerDraw: '$devices.powerDraw',
      },
    },
  ]);
}
