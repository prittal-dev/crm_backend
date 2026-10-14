import express from 'express';
import {
  getPlans,
  createPlan,
  updatePlan,
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  getDeals,
  getDealById,
  createDeal,
  updateDeal,
  updateDealStatus,
  getPayments,
  recordPayment,
  convertDealToProject,
  getNewProjectsInbox,
  assignAccountManager,
  assignProjectTeam,
  startProduction,
  generateDealDocument,
  deleteDealDocument,
  sendDocumentEmail,
  downloadDocumentPdf,
  getLeads,
  createLead,
  batchImportLeads,
  scrapeGoogleLeads,
  scrapeGoogleLeadsStream,
  autoEnrichLeads,
  analyzeWebsiteController,
  analyzeLeadWebsiteController,
  updateLead,
  updateLeadStatus,
  deleteLead,
  getProposals,
  createProposal,
  updateProposalStatus,
  deleteProposal,
  getFollowUps,
  createFollowUp,
  toggleFollowUp,
  deleteFollowUp,
  onboardClient,
  getCallers,
  createCaller,
  updateCaller,
  deleteCaller,
  getSalesContracts,
  getSalesContractsByClient,
  updateSalesContract,
  deleteSalesContract,
  syncSalesSheetFromExcel,
  createSalesContract,
  settleSalesContractBalance,
  createRenewalContractAndInvoice,
  syncAllContractsToProjectsController,
  handlePublicPackageOrder,
  handlePublicInquiry,
  handlePublicGetClients
} from '../controllers/salesController.js';
import { authenticate, authorizeRole } from '../middleware/auth.js';

const router = express.Router();

// ==========================================
// 0. SALES CALLERS & SALES REPS ROUTES
// ==========================================
router.get('/callers', authenticate, getCallers);
router.post('/callers', authenticate, createCaller);
router.put('/callers/:id', authenticate, updateCaller);
router.delete('/callers/:id', authenticate, deleteCaller);

// ==========================================
// 0.1 SALES ONBOARDING ENDPOINT
// ==========================================
router.post('/onboard-client', authenticate, onboardClient);

// ==========================================
// 1. PLANS ROUTES
// ==========================================
router.get('/plans', authenticate, getPlans);
router.post('/plans', authenticate, authorizeRole('superadmin', 'administrator'), createPlan);
router.put('/plans/:id', authenticate, authorizeRole('superadmin', 'administrator'), updatePlan);

// ==========================================
// 2. CLIENTS ROUTES
// ==========================================
router.get('/clients', authenticate, getClients);
router.get('/clients/:id', authenticate, getClientById);
router.post('/clients', authenticate, createClient);
router.put('/clients/:id', authenticate, updateClient);
router.delete('/clients/:id', authenticate, deleteClient);

// ==========================================
// 3. DEALS ROUTES
// ==========================================
router.get('/deals', authenticate, getDeals);
router.get('/deals/:id', authenticate, getDealById);
router.post('/deals', authenticate, createDeal);
router.put('/deals/:id', authenticate, updateDeal);
router.put('/deals/:id/status', authenticate, updateDealStatus);

// ==========================================
// 4. PAYMENTS ROUTES
// ==========================================
router.get('/payments', authenticate, getPayments);
router.post('/deals/:dealId/payments', authenticate, recordPayment);

// ==========================================
// 5. CONVERT TO PRODUCTION PROJECT
// ==========================================
router.post('/deals/:dealId/convert-to-project', authenticate, convertDealToProject);

// ==========================================
// 6. ADMIN INBOX & AM ASSIGNMENT
// ==========================================
router.get('/admin/new-projects', authenticate, getNewProjectsInbox);
router.put('/projects/:projectId/assign-am', authenticate, authorizeRole('superadmin', 'administrator', 'admin', 'sales_admin', 'sales_manager', 'sales', 'sales_executive', 'production_admin', 'production_manager', 'account_manager_head', 'manager', 'general'), assignAccountManager);

// ==========================================
// 7. AM TEAM STAFFING & START PRODUCTION
// ==========================================
router.put('/projects/:projectId/assign-team', authenticate, assignProjectTeam);
router.post('/projects/:projectId/start-production', authenticate, startProduction);

// ==========================================
// 8. DOCUMENT GENERATION (PDF / PI) & EMAIL
// ==========================================
router.post('/deals/:dealId/documents/generate', authenticate, generateDealDocument);
router.delete('/deals/:dealId/documents/:docId', authenticate, deleteDealDocument);
router.post('/deals/:dealId/send-email', authenticate, sendDocumentEmail);
router.post('/documents/send-email', authenticate, sendDocumentEmail);
router.get('/documents/:id/pdf', downloadDocumentPdf);
router.get('/deals/:dealId/pdf', downloadDocumentPdf);


// ==========================================
// 9. LEGACY COMPATIBILITY ROUTES
// ==========================================
router.get('/leads', authenticate, getLeads);
router.post('/leads/batch', authenticate, batchImportLeads);
router.post('/leads/scrape', authenticate, scrapeGoogleLeads);
router.post('/leads/scrape-stream', authenticate, scrapeGoogleLeadsStream);
router.post('/leads/auto-enrich', authenticate, autoEnrichLeads);
router.post('/analyze-website', authenticate, analyzeWebsiteController);
router.post('/leads/:id/analyze-website', authenticate, analyzeLeadWebsiteController);
router.post('/leads', authenticate, createLead);
router.put('/leads/:id', authenticate, updateLead);
router.put('/leads/:id/status', authenticate, updateLeadStatus);
router.delete('/leads/:id', authenticate, deleteLead);

router.get('/proposals', authenticate, getProposals);
router.post('/proposals', authenticate, createProposal);
router.put('/proposals/:id/status', authenticate, updateProposalStatus);
router.delete('/proposals/:id', authenticate, deleteProposal);

router.get('/followups', authenticate, getFollowUps);
router.post('/followups', authenticate, createFollowUp);
router.patch('/followups/:id/toggle', authenticate, toggleFollowUp);
router.delete('/followups/:id', authenticate, deleteFollowUp);

// ==========================================
// 10. SALES CONTRACTS & EXCEL SALES SHEET
// ==========================================
router.get('/contracts', authenticate, getSalesContracts);
router.get('/contracts/client/:clientId', authenticate, getSalesContractsByClient);
router.post('/contracts', authenticate, createSalesContract);
router.post('/contracts/sync-projects', authenticate, syncAllContractsToProjectsController);
router.put('/contracts/:id', authenticate, updateSalesContract);
router.post('/contracts/:id/settle-balance', authenticate, settleSalesContractBalance);
router.post('/contracts/:id/create-renewal', authenticate, createRenewalContractAndInvoice);
router.delete('/contracts/:id', authenticate, deleteSalesContract);
router.post('/contracts/sync-excel', authenticate, syncSalesSheetFromExcel);

// ==========================================
// 11. PUBLIC INTEGRATIONS (WEBSITE / PRITTAL2)
// ==========================================
// Unauthenticated endpoints for public website forms & PI generator
router.post('/public/package-order', handlePublicPackageOrder);
router.post('/public/proforma-invoice', handlePublicPackageOrder); // Alias
router.post('/public/inquiry', handlePublicInquiry);
router.get('/public/clients', handlePublicGetClients);

export default router;
