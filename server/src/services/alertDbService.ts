/**
 * Alert DB Service
 *
 * Persists alerts raised by alertEngine.ts into MongoDB.
 * Provides historical query and analytics on top of the Alert collection.
 *
 * The alertEngine owns the live active-alert set (in-memory Map).
 * This service owns the historical record.
 */

import { AlertModel, IAlert } from '../models/Alert';
import type { Alert } from './alertEngine';

// ─── Write operations ─────────────────────────────────────────────────────────

/**
 * Upsert an alert into MongoDB.
 * Called by the alertEngine's onAlert() subscriber.
 * Fire-and-forget — never throws.
 */
export function persistAlert(alert: Alert): void {
  AlertModel.findOneAndUpdate(
    { alertId: alert.id },
    {
      $setOnInsert: { triggeredAt: new Date(alert.timestamp) },  // only set on first insert
      $set: {
        room:       alert.room,
        type:       alert.type,
        message:    alert.message,
        severity:   alert.severity,
        deviceId:   alert.deviceId,
        meta:       alert.meta,
        resolvedAt: alert.resolvedAt ? new Date(alert.resolvedAt) : null,
      },
    },
    { upsert: true, new: true }
  ).catch((err) => console.error(`[alert-db] Failed to persist ${alert.id}:`, err.message));
}

/**
 * Mark an alert as resolved in MongoDB.
 * Called when alertEngine.resolveAlert() is invoked.
 */
export function persistAlertResolution(alertId: string): void {
  AlertModel.findOneAndUpdate(
    { alertId },
    { $set: { resolvedAt: new Date() } }
  ).catch((err) => console.error(`[alert-db] Failed to resolve ${alertId}:`, err.message));
}

// ─── Read queries ─────────────────────────────────────────────────────────────

export async function getAlertHistory(options: {
  type?:      'AFTER_HOURS' | 'SUSTAINED_LOAD';
  severity?:  'WARNING' | 'CRITICAL';
  room?:      string;
  resolved?:  boolean;           // true = only resolved, false = only active, undefined = all
  limitDays?: number;
  limit?:     number;
}): Promise<IAlert[]> {
  const {
    type, severity, room,
    resolved, limitDays = 30, limit = 100,
  } = options;

  const since = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);
  const filter: Record<string, unknown> = { triggeredAt: { $gte: since } };

  if (type)     filter.type     = type;
  if (severity) filter.severity = severity;
  if (room)     filter.room     = room;
  if (resolved === true)  filter.resolvedAt = { $ne: null };
  if (resolved === false) filter.resolvedAt = null;

  return AlertModel
    .find(filter)
    .sort({ triggeredAt: -1 })
    .limit(limit)
    .lean() as unknown as IAlert[];
}

export async function getAlertStats(limitDays = 30) {
  const since = new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000);

  return AlertModel.aggregate([
    { $match: { triggeredAt: { $gte: since } } },
    {
      $group: {
        _id:              { type: '$type', severity: '$severity' },
        count:            { $sum: 1 },
        avgDurationMs:    {
          $avg: {
            $cond: [
              { $ne: ['$resolvedAt', null] },
              { $subtract: ['$resolvedAt', '$triggeredAt'] },
              null,
            ],
          },
        },
      },
    },
    { $sort: { count: -1 } },
  ]);
}
