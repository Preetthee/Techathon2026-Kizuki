import { Router } from 'express';
import {
  listAlerts,
  listAfterHours,
  listSustainedLoad,
  listByRoom,
  listHistory,
  listStats,
  dismissAlert,
} from '../controllers/alertController';

const router = Router();

router.get('/',                listAlerts);
router.get('/after-hours',     listAfterHours);
router.get('/sustained-load',  listSustainedLoad);
router.get('/history',         listHistory);
router.get('/stats',           listStats);
router.get('/room/:name',      listByRoom);
router.delete('/:id',          dismissAlert);

export default router;
