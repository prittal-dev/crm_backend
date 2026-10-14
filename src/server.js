import dotenv from 'dotenv';
import v8 from 'v8';
v8.setFlagsFromString('--max-old-space-size=256');
dotenv.config();

import app from './app.js';
import { connectDB } from './config/db.js';
import { initRenewalCronJob } from './services/renewalService.js';
import { syncProjectsWithSalesContracts } from './utils/sync_contracts_to_projects.js';

const PORT = process.env.PORT || 5000;

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason);
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`🚀 CRM Backend server running on port ${PORT}`);
  console.log(`📡 API Base: http://127.0.0.1:${PORT}/api`);
  console.log(`=========================================`);
  
  // Connect to MongoDB
  connectDB();
  
  // Start Automated Cron Jobs
  initRenewalCronJob();

  // Auto-sync projects with all sales contracts on startup (runs 3 seconds after DB connect)
  setTimeout(() => {
    syncProjectsWithSalesContracts().catch(err => {
      console.warn('[AutoSync] Initial sync notice:', err.message);
    });
  }, 3000);

  // Periodic auto-sync every 1 hour (3600000ms)
  setInterval(() => {
    syncProjectsWithSalesContracts().catch(err => {
      console.warn('[AutoSync] Periodic sync notice:', err.message);
    });
  }, 3600000);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`⚠️ Port ${PORT} is already in use by another process.`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

const gracefulShutdown = (signal) => {
  console.log(`\n🛑 [${signal}] Received. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  // Force exit after 1.5s if keep-alive connections keep socket open
  setTimeout(() => {
    process.exit(0);
  }, 1500).unref();
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

