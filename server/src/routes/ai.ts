import { Router } from 'express';
import { askQuestion, getOfficeContext } from '../controllers/aiController';

const router = Router();

router.post('/ask',     askQuestion);      // POST /ai/ask  { question }
router.get('/context',  getOfficeContext); // GET  /ai/context  (debug)

export default router;
