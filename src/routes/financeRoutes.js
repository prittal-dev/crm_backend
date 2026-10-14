import express from 'express';
import {
  getInvoices,
  createInvoice,
  updateInvoiceStatus,
  deleteInvoice,
  getFinanceSummary
} from '../controllers/financeController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.get('/invoices', getInvoices);
router.post('/invoices', authenticate, createInvoice);
router.put('/invoices/:id/status', authenticate, updateInvoiceStatus);
router.delete('/invoices/:id', authenticate, deleteInvoice);
router.get('/summary', getFinanceSummary);

export default router;
