import { Router } from 'express';
import {
  listDevices,
  getDevice,
  setDeviceStatus,
  toggleDevice,
  getHistory,
} from '../controllers/deviceController';

const router = Router();

router.get('/',              listDevices);
router.get('/:id',           getDevice);
router.get('/:id/history',   getHistory);
router.patch('/:id',         setDeviceStatus);
router.post('/:id/toggle',   toggleDevice);

export default router;
