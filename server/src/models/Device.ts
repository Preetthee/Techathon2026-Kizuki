/**
 * Device Model
 *
 * Persists the canonical device list and their last-known state.
 * The in-memory store (deviceStore.ts) owns real-time state;
 * this collection is the durable source of truth that survives restarts.
 *
 * On startup, deviceStore is seeded from this collection if it contains data,
 * otherwise the store's default state is written here.
 */

import { Schema, model, Document, Model } from 'mongoose';

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IDevice extends Document {
  deviceId:    string;   // stable app-level id (e.g. "drawing_room_fan_1")
  name:        string;
  room:        string;
  type:        'fan' | 'light';
  status:      boolean;
  powerDraw:   number;   // watts (0 when off)
  lastChanged: Date;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const DeviceSchema = new Schema<IDevice>(
  {
    deviceId:    { type: String, required: true, unique: true, index: true },
    name:        { type: String, required: true },
    room:        { type: String, required: true, index: true },
    type:        { type: String, enum: ['fan', 'light'], required: true },
    status:      { type: Boolean, default: false },
    powerDraw:   { type: Number, default: 0, min: 0 },
    lastChanged: { type: Date, default: Date.now },
  },
  {
    timestamps: true,       // adds createdAt + updatedAt
    versionKey: false,
  }
);

// Compound index — queries like "find all devices in room X" hit this directly
DeviceSchema.index({ room: 1, type: 1 });
DeviceSchema.index({ status: 1 });

// ─── Virtual ──────────────────────────────────────────────────────────────────

DeviceSchema.virtual('isOn').get(function (this: IDevice) {
  return this.status;
});

// ─── Model ────────────────────────────────────────────────────────────────────

export const DeviceModel: Model<IDevice> = model<IDevice>('Device', DeviceSchema);
