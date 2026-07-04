/**
 * Aggregation Service
 *
 * All MongoDB aggregation pipelines live here.
 * These are the only queries that touch UsageLog and cannot be answered
 * by the in-memory store (which holds only the current instant).
 *
 * Three core aggregations:
 *
 *   1. totalPowerConsumption(days)
 *      → Average, peak, and total kWh over the requested window
 *
 *   2. roomWisePowerConsumption(days)
 *      → Per-room average watts, peak watts, and estimated kWh
 *
 *   3. dailyEnergyUsage(days)
 *      → kWh per calendar day for charting / billing estimates
 *
 * Energy calculation
 * ──────────────────
 * Each UsageLog document records watts at an instant. To convert to kWh:
 *
 *   kWh = (average_watts × interval_hours) × num_intervals
 *       = average_watts × (total_hours_covered)
 *
 * We derive total_hours_covered from the interval_ms field stored per document.
 */

import { UsageLogModel } from '../models/UsageLog';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sinceDate(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
}

function msToHours(ms: number): number {
  return ms / 3_600_000;
}

// ─── 1. Total power consumption ───────────────────────────────────────────────

export interface TotalPowerResult {
  period:          string;       // e.g. "7 days"
  avgWatts:        number;       // average system watts over the period
  peakWatts:       number;       // highest single-snapshot system power
  minWatts:        number;       // lowest single-snapshot system power
  estimatedKwh:    number;       // total energy consumed (approximated)
  snapshotCount:   number;       // number of data points analysed
  avgOnCount:      number;       // average devices ON
}

export async function totalPowerConsumption(days = 7): Promise<TotalPowerResult> {
  const since = sinceDate(days);

  const [result] = await UsageLogModel.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id:           null,
        avgWatts:      { $avg: '$totalSystemPower' },
        peakWatts:     { $max: '$totalSystemPower' },
        minWatts:      { $min: '$totalSystemPower' },
        totalIntervalMs: { $sum: '$intervalMs' },   // total time covered by snapshots
        snapshotCount: { $sum: 1 },
        avgOnCount:    { $avg: '$totalOnCount' },
      },
    },
    {
      $project: {
        _id:          0,
        avgWatts:     { $round: ['$avgWatts', 2] },
        peakWatts:    1,
        minWatts:     1,
        snapshotCount: 1,
        avgOnCount:   { $round: ['$avgOnCount', 1] },
        // kWh = avgWatts × hours_covered / 1000
        estimatedKwh: {
          $round: [
            { $divide: [
              { $multiply: ['$avgWatts', { $divide: ['$totalIntervalMs', 3_600_000] }] },
              1000,
            ]},
            3,
          ],
        },
      },
    },
  ]);

  return result ?? {
    period: `${days} days`, avgWatts: 0, peakWatts: 0, minWatts: 0,
    estimatedKwh: 0, snapshotCount: 0, avgOnCount: 0,
  };
}

// ─── 2. Room-wise power consumption ──────────────────────────────────────────

export interface RoomPowerResult {
  room:           string;
  avgWatts:       number;
  peakWatts:      number;
  estimatedKwh:   number;
  avgOnCount:     number;
  avgDeviceCount: number;
  shareOfTotal:   number;   // percentage (0–100)
}

export async function roomWisePowerConsumption(days = 7): Promise<RoomPowerResult[]> {
  const since = sinceDate(days);

  const rows = await UsageLogModel.aggregate([
    { $match: { timestamp: { $gte: since } } },
    { $unwind: '$rooms' },
    {
      $group: {
        _id:             '$rooms.room',
        avgWatts:        { $avg: '$rooms.totalPowerDraw' },
        peakWatts:       { $max: '$rooms.totalPowerDraw' },
        totalIntervalMs: { $sum: '$intervalMs' },
        avgOnCount:      { $avg: '$rooms.onCount' },
        avgDeviceCount:  { $avg: '$rooms.deviceCount' },
      },
    },
    {
      $project: {
        _id:            0,
        room:           '$_id',
        avgWatts:       { $round: ['$avgWatts', 2] },
        peakWatts:      1,
        avgOnCount:     { $round: ['$avgOnCount', 1] },
        avgDeviceCount: { $round: ['$avgDeviceCount', 1] },
        estimatedKwh:   {
          $round: [
            { $divide: [
              { $multiply: ['$avgWatts', { $divide: ['$totalIntervalMs', 3_600_000] }] },
              1000,
            ]},
            3,
          ],
        },
      },
    },
    { $sort: { avgWatts: -1 } },
  ]);

  // Compute share of total after the aggregate is done
  const grandTotal = rows.reduce((s, r) => s + r.avgWatts, 0);
  return rows.map((r) => ({
    ...r,
    shareOfTotal: grandTotal > 0
      ? parseFloat(((r.avgWatts / grandTotal) * 100).toFixed(1))
      : 0,
  }));
}

// ─── 3. Daily energy usage ────────────────────────────────────────────────────

export interface DailyEnergyResult {
  date:         string;   // "YYYY-MM-DD"
  avgWatts:     number;
  peakWatts:    number;
  estimatedKwh: number;
  snapshotCount: number;
  avgOnCount:   number;
}

export async function dailyEnergyUsage(days = 30): Promise<DailyEnergyResult[]> {
  const since = sinceDate(days);

  return UsageLogModel.aggregate([
    { $match: { timestamp: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
        },
        avgWatts:        { $avg: '$totalSystemPower' },
        peakWatts:       { $max: '$totalSystemPower' },
        totalIntervalMs: { $sum: '$intervalMs' },
        snapshotCount:   { $sum: 1 },
        avgOnCount:      { $avg: '$totalOnCount' },
      },
    },
    {
      $project: {
        _id:           0,
        date:          '$_id',
        avgWatts:      { $round: ['$avgWatts', 2] },
        peakWatts:     1,
        snapshotCount: 1,
        avgOnCount:    { $round: ['$avgOnCount', 1] },
        estimatedKwh:  {
          $round: [
            { $divide: [
              { $multiply: ['$avgWatts', { $divide: ['$totalIntervalMs', 3_600_000] }] },
              1000,
            ]},
            3,
          ],
        },
      },
    },
    { $sort: { date: -1 } },
  ]);
}

// ─── 4. Device-level breakdown (bonus) ───────────────────────────────────────

export interface DevicePowerResult {
  deviceId:     string;
  name:         string;
  room:         string;
  type:         string;
  avgWatts:     number;
  onRatePct:    number;   // percentage of time the device was ON
  estimatedKwh: number;
}

export async function deviceLevelBreakdown(days = 7): Promise<DevicePowerResult[]> {
  const since = sinceDate(days);

  return UsageLogModel.aggregate([
    { $match: { timestamp: { $gte: since } } },
    { $unwind: '$devices' },
    {
      $group: {
        _id:             '$devices.deviceId',
        name:            { $first: '$devices.name' },
        room:            { $first: '$devices.room' },
        type:            { $first: '$devices.type' },
        avgWatts:        { $avg: '$devices.powerDraw' },
        onReadings:      { $sum: { $cond: ['$devices.status', 1, 0] } },
        totalReadings:   { $sum: 1 },
        totalIntervalMs: { $sum: '$intervalMs' },
      },
    },
    {
      $project: {
        _id:          0,
        deviceId:     '$_id',
        name:         1,
        room:         1,
        type:         1,
        avgWatts:     { $round: ['$avgWatts', 2] },
        onRatePct:    {
          $round: [
            { $multiply: [{ $divide: ['$onReadings', '$totalReadings'] }, 100] },
            1,
          ],
        },
        estimatedKwh: {
          $round: [
            { $divide: [
              { $multiply: ['$avgWatts', { $divide: ['$totalIntervalMs', 3_600_000] }] },
              1000,
            ]},
            3,
          ],
        },
      },
    },
    { $sort: { estimatedKwh: -1 } },
  ]);
}
