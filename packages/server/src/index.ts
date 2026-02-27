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
import { requireAuth, requireGP } from './middleware/auth';
import { Client } from 'pg';
import { getStorageBackend, readStoredFile } from './lib/storage';
import { validateRuntimeEnv } from './lib/env';
import { checkPostgresConnectivity } from './db/postgres-client';
import { getDbRuntimeMode, isPostgresPrimaryMode } from './db/runtime-mode';
import { reconcileCriticalTables } from './db/reconciliation';

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

validateRuntimeEnv();

function mustHavePersistentStoreReady(): boolean {
  const raw = String(process.env.POSTGRES_REQUIRE_READY || process.env.PG_BRIDGE_REQUIRE_READY || '').toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return isProduction;
}

async function verifyPostgresBridgeConnectivity(): Promise<void> {
  await checkPostgresConnectivity();
}

function mustEnforceCutoverGates(): boolean {
  const raw = String(process.env.CUTOVER_REQUIRE_GATES || '').toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return isPostgresPrimaryMode();
}

async function evaluateCutoverGates() {
  const threshold = Math.max(0, Number(process.env.CUTOVER_DIVERGENCE_THRESHOLD || 0));
  const requiredParityRate = Number(process.env.CUTOVER_PARITY_PASS_RATE || 1);
  const parityPassRate = Number(process.env.CUTOVER_PARITY_PASS_RATE_CURRENT || 0);
  const smokeFailures = Number(process.env.CUTOVER_SMOKE_FAILURES || 0);
  const reconcile = await reconcileCriticalTables(threshold);
  const gates = {
    parity: parityPassRate >= requiredParityRate,
    divergence: reconcile.pass,
    smoke: smokeFailures === 0,
  };
  return {
    pass: gates.parity && gates.divergence && gates.smoke,
    threshold,
    requiredParityRate,
    parityPassRate,
    smokeFailures,
    reconcile,
    gates,
  };
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
  const dbRuntimeMode = getDbRuntimeMode();
  res.json({
    status: 'ok',
    version: '0.1.0',
    dbRuntimeMode,
    readSource: isPostgresPrimaryMode() ? 'postgres-primary' : 'sqlite-runtime',
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
  if (rawUrl) {
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
  });
});

// Cutover safety gates: parity, divergence, and smoke checks.
app.get('/api/diag/cutover-gates', requireAuth, requireGP, async (req, res) => {
  try {
    const gateStatus = await evaluateCutoverGates();
    const allPass = gateStatus.pass;
    const gates = {
      parity: {
        requiredRate: gateStatus.requiredParityRate,
        currentRate: gateStatus.parityPassRate,
        pass: gateStatus.gates.parity,
      },
      divergence: {
        threshold: gateStatus.threshold,
        pass: gateStatus.gates.divergence,
        reconcile: gateStatus.reconcile,
      },
      smoke: {
        failures: gateStatus.smokeFailures,
        pass: gateStatus.gates.smoke,
      },
    };
    res.json({
      pass: allPass,
      dbRuntimeMode: getDbRuntimeMode(),
      postgresPrimary: isPostgresPrimaryMode(),
      gates,
    });
  } catch (error: any) {
    res.status(500).json({
      pass: false,
      dbRuntimeMode: getDbRuntimeMode(),
      postgresPrimary: isPostgresPrimaryMode(),
      error: error?.message || 'Failed to evaluate cutover gates',
    });
  }
});

app.post('/api/diag/reconcile', requireAuth, requireGP, async (req, res) => {
  try {
    const threshold = Math.max(0, Number(req.body?.threshold ?? process.env.CUTOVER_DIVERGENCE_THRESHOLD ?? 0));
    const result = await reconcileCriticalTables(threshold);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to reconcile tables' });
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
  if (mustHavePersistentStoreReady()) {
    await verifyPostgresBridgeConnectivity();
  }

  // Optional promotion blocker: fail startup if cutover safety gates are not satisfied.
  if (isPostgresPrimaryMode() && mustEnforceCutoverGates()) {
    const gateStatus = await evaluateCutoverGates();
    if (!gateStatus.pass) {
      throw new Error(
        `Cutover gates failed (parity=${gateStatus.gates.parity}, divergence=${gateStatus.gates.divergence}, smoke=${gateStatus.gates.smoke})`
      );
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
    console.log(`\n🏗️  305 Opportunities Fund API running on http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   DB runtime mode: ${dbRuntimeMode}`);
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
