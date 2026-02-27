/**
 * Express server entry point.
 * 305 Opportunities Fund management API.
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
  flushPostgresPush,
  getPostgresBridgeStatus,
  hydrateSqliteFromPostgres,
  hydrateSqliteFromPostgresIfStale,
  isPostgresBridgeEnabled,
  schedulePostgresPush,
} from './db/pg-bridge';
import { requireAuth, requireGP } from './middleware/auth';
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

import investorRoutes from './routes/investor';

import publicSignRoutes from './routes/public-sign';
import investorGateRoutes from './routes/investor-gate';
import publicInvestorHiddenRoutes from './routes/public-investor-hidden';
import publicInvestorNdaRoutes from './routes/public-investor-nda';


const app = express();
const PORT = process.env.PORT || 3001;
const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const pgBridgeReadPullEnabled = String(process.env.PG_BRIDGE_READ_PULL || '').toLowerCase() === '1';
const pgBridgePeriodicPullEnabled = String(process.env.PG_BRIDGE_PERIODIC_PULL || '').toLowerCase() === '1';

validateRuntimeEnv();

function getDbRuntimeMode(): 'sqlite-bridge' | 'postgres-primary' {
  const raw = String(process.env.DB_RUNTIME_MODE || '').trim().toLowerCase();
  return raw === 'postgres-primary' ? 'postgres-primary' : 'sqlite-bridge';
}

function mustHavePersistentBridgeReady(): boolean {
  const raw = String(process.env.PG_BRIDGE_REQUIRE_READY || '').toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return isProduction;
}

async function verifyPostgresBridgeConnectivity(): Promise<void> {
  const rawUrl = String(process.env.DATABASE_URL || '').trim();
  if (!rawUrl) throw new Error('DATABASE_URL missing while Postgres bridge is enabled');
  const client = new Client({ connectionString: rawUrl });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

// Middleware
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [
      process.env.CLIENT_URL || 'http://localhost:5173',
      process.env.PUBLIC_CORS_ORIGINS || '',
    ]
      .join(',')
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
// Needed for third-party webhooks (e.g., Jotform) which often POST form-encoded bodies.
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
  if (isMutation && !shouldSkip && req.path.startsWith('/api')) {
    const originalEnd = res.end.bind(res);
    let finalized = false;
    res.end = ((chunk?: any, encoding?: any, cb?: any) => {
      if (finalized) return originalEnd(chunk, encoding, cb);
      finalized = true;

      let bodyChunk = chunk;
      let bodyEncoding = encoding;
      let callback = cb;
      if (typeof bodyEncoding === 'function') {
        callback = bodyEncoding;
        bodyEncoding = undefined;
      }

      const finish = async () => {
        if (res.statusCode < 400 && isPostgresBridgeEnabled()) {
          try {
            await flushPostgresPush(`${req.method} ${req.path}`);
            if (!res.headersSent) res.setHeader('x-data-sync', 'ok');
          } catch (error) {
            console.error('[pg-bridge] Mutation sync barrier failed:', error);
            if (!res.headersSent) {
              const payload = JSON.stringify({
                error: 'Write succeeded locally but failed to sync to persistent storage. Please retry.',
              });
              res.statusCode = 503;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Content-Length', Buffer.byteLength(payload).toString());
              res.setHeader('x-data-sync', 'failed');
              bodyChunk = payload;
              bodyEncoding = 'utf8';
            }
          }
        } else if (res.statusCode < 400) {
          schedulePostgresPush(`${req.method} ${req.path}`);
        }
        return originalEnd(bodyChunk, bodyEncoding as any, callback as any);
      };
      void finish();
      return res as any;
    }) as any;
  }
  next();
});

// Serve uploaded files (local backend only)
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (getStorageBackend() === 'local') {
  // Keep local uploads behind auth; avoid exposing PII in dev/staging.
  app.use('/uploads', requireAuth, express.static(uploadDir));
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

    // Authorization: allow GP to fetch anything; LP can only fetch documents
    // that belong to them or are fund-level docs.
    if (req.user?.role === 'lp') {
      const db = getDb();
      const lp = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user.userId) as any;
      if (!lp) {
        res.status(403).json({ error: 'LP account not found' });
        return;
      }

      // Map allowed documents -> allowed storage keys.
      const docs = db.prepare(`
        SELECT file_path
        FROM documents
        WHERE parent_type = 'fund'
           OR (parent_type = 'lp' AND parent_id = ?)
      `).all(lp.id) as Array<{ file_path: string }>;
      const allowedKeys = new Set<string>();
      for (const d of docs) {
        const fp = String(d.file_path || '');
        if (fp.startsWith('/api/files/')) allowedKeys.add(decodeURIComponent(fp.replace('/api/files/', '')));
        else if (fp.startsWith('/uploads/')) allowedKeys.add(fp.replace('/uploads/', ''));
      }

      if (!allowedKeys.has(decodedKey)) {
        res.status(403).json({ error: 'Not authorized to access this file' });
        return;
      }
    }

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
  const bridgeStatus = getPostgresBridgeStatus();
  const dbRuntimeMode = getDbRuntimeMode();
  res.json({
    status: 'ok',
    version: '0.1.0',
    dbRuntimeMode,
    postgresBridge: {
      enabled: isPostgresBridgeEnabled(),
      readPullEnabled: pgBridgeReadPullEnabled,
      periodicPullEnabled: pgBridgePeriodicPullEnabled,
      status: bridgeStatus,
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
    dbRuntimeMode: getDbRuntimeMode(),
    bridge: {
      enabled: isPostgresBridgeEnabled(),
      readPullEnabled: pgBridgeReadPullEnabled,
      periodicPullEnabled: pgBridgePeriodicPullEnabled,
      status: getPostgresBridgeStatus(),
    },
  });
});

// Manually trigger a Postgres -> SQLite pull (GP only).
// Useful when read-pull is disabled and you don't want to restart the server.
app.post('/api/diag/pull', requireAuth, requireGP, async (req, res) => {
  try {
    await hydrateSqliteFromPostgres();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String((error as any)?.message || error) });
  }
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

app.use('/api/investor', investorRoutes);

app.use('/api/public/sign', publicSignRoutes);
app.use('/api/public/investor-gate', investorGateRoutes);
app.use('/api/public/investor-hidden', publicInvestorHiddenRoutes);
app.use('/api/public/investor-nda', publicInvestorNdaRoutes);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  const dbRuntimeMode = getDbRuntimeMode();
  // Initialize DB runtime
  initDb();
  configurePostgresBridge(getDb);
  if (isPostgresBridgeEnabled()) {
    if (mustHavePersistentBridgeReady()) {
      await verifyPostgresBridgeConnectivity();
    }
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
    console.log(`\n🏗️  305 Opportunities Fund API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   DB runtime mode: ${dbRuntimeMode}`);
    if (isPostgresBridgeEnabled()) {
      console.log('   Postgres bridge: enabled');
      console.log(`   Postgres read-pull: ${pgBridgeReadPullEnabled ? 'enabled' : 'disabled'}`);
      console.log(`   Postgres periodic pull: ${pgBridgePeriodicPullEnabled ? 'enabled' : 'disabled'}`);
    }
    console.log('');
  });
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
  });
}

export default app;
