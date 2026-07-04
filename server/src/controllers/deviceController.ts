import { Request, Response, NextFunction } from 'express';
import * as deviceService from '../services/deviceService';
import { persistDeviceChange, getDeviceHistory } from '../services/deviceDbService';
import { evaluateNow } from '../services/alertEngine';
import { saveDevice } from '../storage/StorageService';

function makeError(msg: string, code: number) {
  return Object.assign(new Error(msg), { statusCode: code });
}

// GET /devices
export async function listDevices(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(deviceService.listDevices());
  } catch (e) { next(e); }
}

// GET /devices/:id
export async function getDevice(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(deviceService.getDevice(req.params.id));
  } catch (e) { next(e); }
}

// PATCH /devices/:id  — { status: boolean }
export async function setDeviceStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { status } = req.body as { status: boolean };
    if (typeof status !== 'boolean') return next(makeError('status must be boolean', 400));
    const updated = deviceService.setDeviceStatus(req.params.id, status);
    saveDevice(updated);              // persist to disk immediately
    persistDeviceChange(updated);     // async MongoDB write-through
    evaluateNow();
    res.json(updated);
  } catch (e) { next(e); }
}

// POST /devices/:id/toggle
export async function toggleDevice(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = deviceService.toggleDevice(req.params.id);
    saveDevice(updated);              // persist to disk immediately
    persistDeviceChange(updated);     // async MongoDB write-through
    evaluateNow();
    res.json(updated);
  } catch (e) { next(e); }
}

// GET /devices/:id/history?days=7
export async function getHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const days = Math.min(parseInt(req.query.days as string ?? '7', 10), 90);
    const history = await getDeviceHistory(req.params.id, days);
    res.json({ deviceId: req.params.id, days, history });
  } catch (e) { next(e); }
}
