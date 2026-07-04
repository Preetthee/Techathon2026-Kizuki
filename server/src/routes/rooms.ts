import { Router } from 'express';
import * as deviceService from '../services/deviceService';

const router = Router();

router.get('/', (req, res, next) => {
  try { res.json(deviceService.getRoomSummaries()); } catch (e) { next(e); }
});

router.get('/:name', (req, res, next) => {
  try {
    const room = decodeURIComponent(req.params.name);
    const found = deviceService.getRoomSummaries().find((s) => s.room === room);
    if (!found) {
      const err = Object.assign(new Error(`Room not found: ${room}`), { statusCode: 404 });
      return next(err);
    }
    res.json(found);
  } catch (e) { next(e); }
});

export default router;
