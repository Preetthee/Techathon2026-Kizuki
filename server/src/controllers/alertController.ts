import { Request, Response, NextFunction } from 'express';
import { getAlerts, getAlertsByType, getAlertsByRoom, resolveAlert } from '../services/alertEngine';
import { getAlertHistory, getAlertStats } from '../services/alertDbService';

// GET /alerts
export async function listAlerts(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(getAlerts());
  } catch (e) { next(e); }
}

// GET /alerts/after-hours
export async function listAfterHours(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(getAlertsByType('AFTER_HOURS'));
  } catch (e) { next(e); }
}

// GET /alerts/sustained-load
export async function listSustainedLoad(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(getAlertsByType('SUSTAINED_LOAD'));
  } catch (e) { next(e); }
}

// GET /alerts/room/:name
export async function listByRoom(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(getAlertsByRoom(decodeURIComponent(req.params.name)));
  } catch (e) { next(e); }
}

// GET /alerts/history?type=&severity=&room=&resolved=&days=&limit=
export async function listHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const { type, severity, room, resolved, days, limit } = req.query as Record<string, string>;
    const history = await getAlertHistory({
      type:      type as any,
      severity:  severity as any,
      room,
      resolved:  resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      limitDays: days   ? parseInt(days, 10)  : 30,
      limit:     limit  ? parseInt(limit, 10) : 100,
    });
    res.json(history);
  } catch (e) { next(e); }
}

// GET /alerts/stats?days=30
export async function listStats(req: Request, res: Response, next: NextFunction) {
  try {
    const days = parseInt(req.query.days as string ?? '30', 10);
    res.json(await getAlertStats(days));
  } catch (e) { next(e); }
}

// DELETE /alerts/:id
export async function dismissAlert(req: Request, res: Response, next: NextFunction) {
  try {
    const ok = resolveAlert(decodeURIComponent(req.params.id));
    if (!ok) {
      const err = Object.assign(new Error('Alert not found'), { statusCode: 404 });
      return next(err);
    }
    res.json({ ok: true, id: req.params.id });
  } catch (e) { next(e); }
}
