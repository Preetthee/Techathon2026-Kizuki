import { Request, Response, NextFunction } from 'express';
import * as deviceService from '../services/deviceService';
import {
  totalPowerConsumption,
  roomWisePowerConsumption,
  dailyEnergyUsage,
  deviceLevelBreakdown,
} from '../services/aggregationService';

// GET /usage  — live snapshot (in-memory, instant)
export async function getLiveUsage(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(deviceService.getUsageSummary());
  } catch (e) { next(e); }
}

// GET /usage/total?days=7
export async function getTotalConsumption(req: Request, res: Response, next: NextFunction) {
  try {
    const days = Math.min(parseInt(req.query.days as string ?? '7', 10), 90);
    const data  = await totalPowerConsumption(days);
    res.json({ days, ...data });
  } catch (e) { next(e); }
}

// GET /usage/rooms?days=7
export async function getRoomBreakdown(req: Request, res: Response, next: NextFunction) {
  try {
    const days = Math.min(parseInt(req.query.days as string ?? '7', 10), 90);
    const data  = await roomWisePowerConsumption(days);
    res.json({ days, rooms: data });
  } catch (e) { next(e); }
}

// GET /usage/daily?days=30
export async function getDailyEnergy(req: Request, res: Response, next: NextFunction) {
  try {
    const days = Math.min(parseInt(req.query.days as string ?? '30', 10), 90);
    const data  = await dailyEnergyUsage(days);
    res.json({ days, daily: data });
  } catch (e) { next(e); }
}

// GET /usage/devices?days=7
export async function getDeviceBreakdown(req: Request, res: Response, next: NextFunction) {
  try {
    const days = Math.min(parseInt(req.query.days as string ?? '7', 10), 90);
    const data  = await deviceLevelBreakdown(days);
    res.json({ days, devices: data });
  } catch (e) { next(e); }
}
