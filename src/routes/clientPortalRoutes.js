import express from 'express';
import {
  clientLogin,
  getClientDashboard,
  getClientDeliverables,
  submitDeliverableReview,
  adminSetPortalAccess,
  adminGetPortalAccess
} from '../controllers/clientPortalController.js';
import { authenticateClient } from '../middleware/clientAuth.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Public Client Portal Auth
router.post('/login', clientLogin);

// Protected Client Portal Routes (Requires Client Token)
router.get('/dashboard', authenticateClient, getClientDashboard);
router.get('/deliverables', authenticateClient, getClientDeliverables);
router.post('/deliverables/:taskId/review', authenticateClient, submitDeliverableReview);

// Internal CRM Admin / Account Manager Routes (Requires CRM User Token)
router.post('/admin/set-credentials', authenticate, adminSetPortalAccess);
router.get('/admin/credentials/:targetId', authenticate, adminGetPortalAccess);

export default router;
