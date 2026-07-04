import { Router } from 'express';
import {
  getLiveUsage,
  getTotalConsumption,
  getRoomBreakdown,
  getDailyEnergy,
  getDeviceBreakdown,
} from '../controllers/usageController';

const router = Router();

router.get('/',         getLiveUsage);           // live snapshot
router.get('/total',    getTotalConsumption);    // aggregated total  ?days=7
router.get('/rooms',    getRoomBreakdown);       // per-room kWh      ?days=7
router.get('/daily',    getDailyEnergy);         // per-day kWh       ?days=30
router.get('/devices',  getDeviceBreakdown);     // per-device kWh    ?days=7

export default router;
