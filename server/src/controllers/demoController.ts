import { Request, Response, NextFunction } from 'express';
import {
  enableDemoMode,
  disableDemoMode,
  getDemoStatus,
} from '../services/demoModeService';
import { evaluateNow } from '../services/alertEngine';

// POST /demo/set  — body: { hour: number, minute: number }
export function setDemoTime(req: Request, res: Response, next: NextFunction): void {
  try {
    const { hour, minute = 0 } = req.body as { hour?: number; minute?: number };

    if (hour === undefined || typeof hour !== 'number') {
      res.status(400).json({ error: { message: 'hour (0–23) is required', status: 400 } });
      return;
    }

    enableDemoMode(hour, minute);
    evaluateNow();   // trigger immediate alert re-evaluation at demo time
    res.json({ ok: true, status: getDemoStatus() });
  } catch (e: any) {
    next(Object.assign(e, { statusCode: 400 }));
  }
}

// DELETE /demo  — exit demo mode, restore real state
export function clearDemoTime(_req: Request, res: Response, next: NextFunction): void {
  try {
    disableDemoMode();
    evaluateNow();   // re-evaluate alerts at real time
    res.json({ ok: true, status: getDemoStatus() });
  } catch (e) { next(e); }
}

// GET /demo  — current demo status
export function getDemoTimeStatus(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.json(getDemoStatus());
  } catch (e) { next(e); }
}
