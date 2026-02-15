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
  hydrateSqliteFromPostgresIfStale,
  isPostgresBridgeEnabled,
  schedulePostgresPush,
} from './db/pg-bridge';
import { requireAuth } from './middleware/auth';
import { Client } from 'pg';
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
const pgBridgeReadPullEnabled = String(process.env.PG_BRIDGE_READ_PULL || '').toLowerCase() === '1';
const pgBridgePeriodicPullEnabled = String(process.env.PG_BRIDGE_PERIODIC_PULL || '').toLowerCase() === '1';

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

// Optional read-refresh from Postgres. Disabled by default to avoid clobbering
// runtime state when upstream data quality/mapping issues exist.
app.use(async (req, res, next) => {
  if (!pgBridgeReadPullEnabled) {
    next();
    return;
  }
  const isFreshReadPath = req.method === 'GET'
    && (req.path.startsWith('/api/portfolio') || req.path.startsWith('/api/contracts'));
  if (!isFreshReadPath || !isPostgresBridgeEnabled()) {
    next();
    return;
  }
  try {
    await hydrateSqliteFromPostgresIfStale(Math.max(5_000, Number(process.env.PG_BRIDGE_READ_PULL_MS || 20_000)));
  } catch (error) {
    console.error('[pg-bridge] Read-refresh pull failed:', error);
  }
  next();
});

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
  res.json({
    status: 'ok',
    version: '0.1.0',
    postgresBridge: {
      enabled: isPostgresBridgeEnabled(),
      readPullEnabled: pgBridgeReadPullEnabled,
      periodicPullEnabled: pgBridgePeriodicPullEnabled,
    },
  });
});

// Diagnostic endpoint: helps confirm runtime SQLite vs Postgres connectivity.
// Requires auth so we don't leak data publicly.
app.get('/api/diag/db', requireAuth, async (req, res) => {
  const db = getDb();
  const sqliteCounts: Record<string, number> = {};
  const tables = ['building_units', 'portfolio_units', 'contracts', 'unit_types', 'users'] as const;
  for (const t of tables) {
    try {
      sqliteCounts[t] = Number((db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get() as any)?.c || 0);
    } catch {
      sqliteCounts[t] = -1; // table missing or query failed
    }
  }

  let postgresCounts: Record<string, number> | null = null;
  const rawUrl = String(process.env.DATABASE_URL || '').trim();
  if (isPostgresBridgeEnabled() && rawUrl) {
    postgresCounts = {};
    const client = new Client({ connectionString: rawUrl });
    try {
      await client.connect();
      for (const t of tables) {
        try {
          const r = await client.query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
          postgresCounts[t] = Number(r.rows[0]?.c || 0);
        } catch {
          postgresCounts[t] = -1;
        }
      }
    } catch {
      postgresCounts = null;
    } finally {
      try { await client.end(); } catch { /* ignore */ }
    }
  }

  res.json({
    sqlite: sqliteCounts,
    postgres: postgresCounts,
    bridge: {
      enabled: isPostgresBridgeEnabled(),
      readPullEnabled: pgBridgeReadPullEnabled,
      periodicPullEnabled: pgBridgePeriodicPullEnabled,
    },
  });
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
      console.log('[pg-bridge] Startup pull complete');
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

  if (isPostgresBridgeEnabled() && pgBridgePeriodicPullEnabled) {
    const pullMinutes = Math.max(1, Number(process.env.PG_BRIDGE_PULL_MINUTES || 5));
    setInterval(() => {
      void hydrateSqliteFromPostgres().catch((error) => {
        console.error('[pg-bridge] Periodic pull failed:', error);
      });
    }, pullMinutes * 60 * 1000);
  }

  app.listen(PORT, () => {
    console.log(`\n🏗️  305 opportunites fund API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    if (isPostgresBridgeEnabled()) {
      console.log('   Postgres bridge: enabled');
      console.log(`   Postgres read-pull: ${pgBridgeReadPullEnabled ? 'enabled' : 'disabled'}`);
      console.log(`   Postgres periodic pull: ${pgBridgePeriodicPullEnabled ? 'enabled' : 'disabled'}`);
    }
    console.log('');
  });
}

start().catch((error) => {
  console.error('Server startup failed:', error);
  process.exit(1);
});

export default app;
