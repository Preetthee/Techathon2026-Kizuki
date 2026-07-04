import { Router } from 'express';
import { setDemoTime, clearDemoTime, getDemoTimeStatus } from '../controllers/demoController';

const router = Router();

router.get('/',      getDemoTimeStatus);  // GET    /demo
router.post('/set',  setDemoTime);        // POST   /demo/set  { hour, minute }
router.delete('/',   clearDemoTime);      // DELETE /demo

export default router;
