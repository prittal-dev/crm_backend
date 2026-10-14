import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

import compression from 'compression';
import authRoutes from './routes/authRoutes.js';
import salesRoutes from './routes/salesRoutes.js';
import productionRoutes from './routes/productionRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import documentsRoutes from './routes/documentsRoutes.js';
import clientPortalRoutes from './routes/clientPortalRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { subscribeSSE } from './services/realtimeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Comprehensive CORS configuration with immediate preflight handling
const corsOptions = {
  origin: true, // Reflect request origin (supports https://crm.prittal.com and localhost)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'Cache-Control',
    'Pragma',
    'X-CSRF-Token'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Fail-safe CORS headers middleware for all requests and preflights
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.header('Access-Control-Allow-Origin', origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With, Cache-Control, Pragma, X-CSRF-Token');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Gzip & Brotli HTTP response compression (shrinks JSON payloads by 75-85%, skipping SSE & streams)
app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept === 'text/event-stream' || 
        (req.path && (req.path.includes('/realtime/stream') || req.path.includes('/scrape-stream')))) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
  
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(morgan('dev'));

// Static uploads serving
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Real-time SSE Stream
app.get('/api/realtime/stream', subscribeSSE);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    service: 'CRM Backend API (Node + Express + MongoDB Mongoose)'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/production', productionRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/client-portal', clientPortalRoutes);

// Global Error Handler
app.use(errorHandler);

export default app;