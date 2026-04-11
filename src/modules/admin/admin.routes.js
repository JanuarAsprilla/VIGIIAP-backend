import { Router } from 'express';
import { stats } from './admin.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

router.get('/stats', authenticate, authorize('admin_sig'), stats);

export default router;
