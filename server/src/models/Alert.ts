/**
 * Alert Model
 *
 * Persists the full alert history — both active and resolved.
 * The in-memory alertEngine.ts owns the active-alert set;
 * this collection provides historical query capability.
 *
 * Design notes:
 *   • alertId is the deterministic app-level key (e.g. "after_hours:drawing_room_fan_1")
 *   • resolvedAt = null  →  alert is still active
 *   • resolvedAt = Date  →  alert has been resolved/dismissed
 *   • TTL index auto-deletes resolved alerts after 30 days to bound collection growth
 */

import { Schema, model, Document, Model } from 'mongoose';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IAlert extends Document {
  alertId:     string;
  room:        string | null;
  type:        'AFTER_HOURS' | 'SUSTAINED_LOAD';
  message:     string;
  severity:    'WARNING' | 'CRITICAL';
  deviceId:    string | null;
  triggeredAt: Date;
  resolvedAt:  Date | null;
  meta:        Record<string, unknown>;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const AlertSchema = new Schema<IAlert>(
  {
    alertId:     { type: String, required: true, unique: true, index: true },
    room:        { type: String, default: null },
    type:        { type: String, enum: ['AFTER_HOURS', 'SUSTAINED_LOAD'], required: true, index: true },
    message:     { type: String, required: true },
    severity:    { type: String, enum: ['WARNING', 'CRITICAL'], required: true, index: true },
    deviceId:    { type: String, default: null },
    triggeredAt: { type: Date, required: true, index: true },
    resolvedAt:  { type: Date, default: null },
    meta:        { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound indexes for common query patterns
AlertSchema.index({ type: 1, severity: 1 });
AlertSchema.index({ room: 1, triggeredAt: -1 });
AlertSchema.index({ resolvedAt: 1, triggeredAt: -1 });

// TTL: auto-delete resolved alerts after 30 days (resolvedAt must be non-null)
AlertSchema.index(
  { resolvedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { resolvedAt: { $ne: null } } }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────────

AlertSchema.virtual('isActive').get(function (this: IAlert) {
  return this.resolvedAt === null;
});

AlertSchema.virtual('durationMs').get(function (this: IAlert) {
  const end = this.resolvedAt ?? new Date();
  return end.getTime() - this.triggeredAt.getTime();
});

// ─── Model ────────────────────────────────────────────────────────────────────

export const AlertModel: Model<IAlert> = model<IAlert>('Alert', AlertSchema);
