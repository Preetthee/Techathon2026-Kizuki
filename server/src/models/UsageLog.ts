/**
 * UsageLog Model
 *
 * A time-series snapshot of all device states, recorded at a configurable
 * interval (default 5 minutes). Each document represents one instant in time
 * and captures the full power picture — per-device and per-room.
 *
 * These documents are the source for all aggregation queries:
 *   • Total power consumption over a period
 *   • Room-wise power consumption
 *   • Daily energy usage (kWh)
 *
 * Growth estimate: 1 doc per interval × 288 intervals/day = 288 docs/day.
 * TTL index purges documents older than 90 days automatically.
 *
 * Schema approach: store flattened device readings (array) + room rollups
 * so aggregations can be done in a single $unwind + $group pass.
 */

import { Schema, model, Document, Model } from 'mongoose';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface IDeviceReading {
  deviceId:  string;
  name:      string;
  room:      string;
  type:      'fan' | 'light';
  status:    boolean;
  powerDraw: number;    // watts at this instant
}

export interface IRoomRollup {
  room:           string;
  totalPowerDraw: number;   // sum of all device powerDraw in this room
  onCount:        number;
  deviceCount:    number;
}

export interface IUsageLog extends Document {
  timestamp:        Date;
  totalSystemPower: number;         // sum across all devices (watts)
  totalOnCount:     number;
  totalDevices:     number;
  intervalMs:       number;         // snapshot interval in ms
  devices:          IDeviceReading[];
  rooms:            IRoomRollup[];
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const DeviceReadingSchema = new Schema<IDeviceReading>(
  {
    deviceId:  { type: String, required: true },
    name:      { type: String, required: true },
    room:      { type: String, required: true },
    type:      { type: String, enum: ['fan', 'light'], required: true },
    status:    { type: Boolean, required: true },
    powerDraw: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const RoomRollupSchema = new Schema<IRoomRollup>(
  {
    room:           { type: String, required: true },
    totalPowerDraw: { type: Number, required: true, min: 0 },
    onCount:        { type: Number, required: true, min: 0 },
    deviceCount:    { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────────

const UsageLogSchema = new Schema<IUsageLog>(
  {
    timestamp:        { type: Date, required: true, index: true },
    totalSystemPower: { type: Number, required: true, min: 0 },
    totalOnCount:     { type: Number, required: true, min: 0 },
    totalDevices:     { type: Number, required: true },
    intervalMs:       { type: Number, required: true },
    devices:          { type: [DeviceReadingSchema], required: true },
    rooms:            { type: [RoomRollupSchema],   required: true },
  },
  {
    timestamps: false,  // timestamp field managed manually for precision
    versionKey: false,
  }
);

// ── Indexes ─────────────────────────────────────────────────────────────────

// Primary time-series index for range queries
UsageLogSchema.index({ timestamp: -1 });

// For room-specific queries without unwinding device arrays
UsageLogSchema.index({ 'rooms.room': 1, timestamp: -1 });

// For power threshold queries (e.g. "when was total > 300W?")
UsageLogSchema.index({ totalSystemPower: 1, timestamp: -1 });

// TTL: auto-delete logs older than 90 days
UsageLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

// ─── Model ────────────────────────────────────────────────────────────────────

export const UsageLogModel: Model<IUsageLog> = model<IUsageLog>('UsageLog', UsageLogSchema);
