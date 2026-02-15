/**
 * Express server entry point.
 * 305 opportunites fund management API.
 */

import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initDb, getDb } from './db/database';
import {
  configurePostgresBridge,
  hydrateSqliteFromPostgres,
  isPostgresBridgeEnabled,
  schedulePostgresPush,
} from './db/pg-bridge';
import { requireAuth } from './middleware/auth';
import { getStorageBackend, readStoredFile } from './lib/storage';
import { validateRuntimeEnv } from './lib/env';

// Route imports
import authRoutes from './routes/auth';
import portfolioRoutes from './routes/portfolio';
import { runRentReminderSweepCore } from './routes/portfolio';
import modelRoutes from './routes/model';
import contractsRoutes from './routes/contracts';
import listingsRoutes from './routes/listings';
import marketRoutes from './routes/market';
import entitiesRoutes from './routes/entities';
import lpRoutes from './routes/lp';
import actualsRoutes from './routes/actuals';
import documentsRoutes from './routes/documents';

const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = (process.env.NODE_ENV || 'development') === 'production';

validateRuntimeEnv();

// Middleware
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(cors({
  origin: (origin, callback) => {
    const allowed = String(process.env.CLIENT_URL || 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Allow non-browser requests (health checks, server-to-server).
    if (!origin) return callback(null, true);
    if (allowed.includes(origin)) return callback(null, true);
    return callback(new Error('CORS blocked for origin'), false);
  },
  credentials: true,
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 800,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}));
app.use(express.json({ limit: '10mb' }));

// Runtime bridge: keep SQLite runtime in sync with managed Postgres.
app.use((req, res, next) => {
  const isMutation = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
  const shouldSkip = req.path === '/api/auth/login';
  if (isMutation && !shouldSkip) {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        schedulePostgresPush(`${req.method} ${req.path}`);
      }
    });
  }
  next();
});

// Serve uploaded files (local backend only)
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (getStorageBackend() === 'local') {
  app.use('/uploads', express.static(uploadDir));
}

// Serve stored files when using cloud object storage.
app.get('/api/files/:key(*)', requireAuth, async (req, res) => {
  try {
    const key = String(req.params.key || '');
    if (!key) {
      res.status(400).json({ error: 'Missing file key' });
      return;
    }
    const decodedKey = decodeURIComponent(key);
    const file = await readStoredFile(decodedKey);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', isProduction ? 'private, max-age=300' : 'no-store');
    file.body.pipe(res);
  } catch (error) {
    res.status(404).json({ error: 'File not found' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/model', modelRoutes);
app.use('/api/contracts', contractsRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/entities', entitiesRoutes);
app.use('/api/lp', lpRoutes);
app.use('/api/actuals', actualsRoutes);
app.use('/api/documents', documentsRoutes);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  // Initialize DB runtime
  initDb();
  configurePostgresBridge(getDb);
  if (isPostgresBridgeEnabled()) {
    try {
      await hydrateSqliteFromPostgres();
    } catch (error) {
      console.error('[pg-bridge] Startup pull failed. Continuing with local SQLite state.', error);
    }
  }

  // Background rent reminder sweep (monthly deduped per tenant)
  const sweepMinutes = Math.max(5, Number(process.env.RENT_REMINDER_SWEEP_MINUTES || 60));
  setInterval(() => {
    try {
      const result = runRentReminderSweepCore(getDb());
      if (result.alerts > 0) {
        console.log(`[rent-reminders] month=${result.month} alerts=${result.alerts} checked=${result.checked}`);
      }
    } catch (err) {
      console.error('[rent-reminders] sweep failed:', err);
    }
  }, sweepMinutes * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`\n🏗️  305 opportunites fund API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    if (isPostgresBridgeEnabled()) {
      console.log('   Postgres bridge: enabled');
    }
    console.log('');
  });
}

start().catch((error) => {
  console.error('Server startup failed:', error);
  process.exit(1);
});

export default app;
