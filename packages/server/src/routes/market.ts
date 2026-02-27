/**
 * Market data routes.
 * FRED API integration and portfolio mark-to-market.
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { markPortfolio } from '@brickell/engine';
import multer from 'multer';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';

const router = Router();
router.use(requireAuth, requireGP);
const usePostgresMarket = () => isPostgresPrimaryMode() || usePostgresReads();

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const MIAMI_INDEX_SERIES = 'MIXRNSA'; // S&P/Case-Shiller Miami Home Price Index

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB is plenty for FRED csv
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.mimetype === 'application/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are accepted'));
    }
  },
});

// GET /api/market/fred - Latest FRED data
router.get('/fred', async (req: Request, res: Response) => {
  const data = usePostgresMarket()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `SELECT * FROM fred_data
         WHERE series_id = $1
         ORDER BY date DESC
         LIMIT 120`,
        [MIAMI_INDEX_SERIES]
      );
      return result.rows;
    })
    : getDb().prepare(`
      SELECT * FROM fred_data
      WHERE series_id = ?
      ORDER BY date DESC
      LIMIT 120
    `).all(MIAMI_INDEX_SERIES);
  res.json(data);
});

// POST /api/market/fred/refresh - Pull latest from FRED
router.post('/fred/refresh', async (req: Request, res: Response) => {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    res.status(400).json({ error: 'FRED_API_KEY not configured in .env' });
    return;
  }

  try {
    const response = await axios.get(FRED_BASE_URL, {
      params: {
        series_id: MIAMI_INDEX_SERIES,
        api_key: apiKey,
        file_type: 'json',
        observation_start: '2020-01-01',
        sort_order: 'desc',
      },
    });

    const observations = response.data.observations || [];
    if (usePostgresMarket()) {
      await withPostgresClient(async (client) => {
        await client.query('BEGIN');
        try {
          for (const o of observations) {
            if (o.value === '.') continue;
            await client.query(
              `INSERT INTO fred_data (series_id, date, value, fetched_at)
               VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
               ON CONFLICT (series_id, date)
               DO UPDATE SET value = EXCLUDED.value, fetched_at = CURRENT_TIMESTAMP`,
              [MIAMI_INDEX_SERIES, o.date, parseFloat(o.value)]
            );
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    } else {
      const db = getDb();
      const insert = db.prepare(`
        INSERT OR REPLACE INTO fred_data (series_id, date, value, fetched_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const insertMany = db.transaction((obs: any[]) => {
        for (const o of obs) {
          if (o.value !== '.') {
            insert.run(MIAMI_INDEX_SERIES, o.date, parseFloat(o.value));
          }
        }
      });
      insertMany(observations);
    }

    res.json({ imported: observations.length, series: MIAMI_INDEX_SERIES });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch FRED data', details: error.message });
  }
});

// POST /api/market/fred/import - Manual import from downloaded FRED CSV (e.g. MIXRNSA.csv)
router.post('/fred/import', csvUpload.single('file'), async (req: Request, res: Response) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: 'Missing CSV file' });

  const csvText = file.buffer.toString('utf8');
  let records: any[] = [];
  try {
    records = parseCsvSync(csvText, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as any[];
  } catch (error: any) {
    return res.status(400).json({ error: 'Failed to parse CSV', details: error?.message || String(error) });
  }

  if (!records.length) {
    return res.status(400).json({ error: 'CSV had no rows' });
  }

  const headerKeys = Object.keys(records[0] || {});
  if (headerKeys.length < 2) {
    return res.status(400).json({ error: 'CSV must have at least 2 columns (date + value)' });
  }

  const norm = (s: string) => String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

  // FRED CSV exports vary:
  // - DATE,MIXRNSA
  // - observation_date,MIXRNSA
  // - DATE,value
  const dateKey =
    headerKeys.find((k) => norm(k) === 'date')
    || headerKeys.find((k) => norm(k).includes('date')) // observation_date, observation date, etc.
    || headerKeys[0];

  const requestedSeries = String((req.body as any).seriesId || '').trim();

  let valueKey: string | undefined;
  if (requestedSeries) {
    valueKey = headerKeys.find((k) => norm(k) === norm(requestedSeries));
  }
  if (!valueKey) {
    valueKey = headerKeys.find((k) => norm(k) === norm(MIAMI_INDEX_SERIES));
  }
  if (!valueKey) {
    valueKey = headerKeys.find((k) => norm(k) === 'value');
  }
  if (!valueKey) {
    valueKey = headerKeys.find((k) => k !== dateKey);
  }
  if (!valueKey || valueKey === dateKey) {
    return res.status(400).json({
      error: 'Could not infer value column from CSV headers',
      headers: headerKeys,
      inferred: { dateKey, valueKey: valueKey || null },
    });
  }

  const seriesId = (requestedSeries || valueKey || MIAMI_INDEX_SERIES).trim() || MIAMI_INDEX_SERIES;

  let imported = 0;
  let skipped = 0;
  if (usePostgresMarket()) {
    await withPostgresClient(async (client) => {
      await client.query('BEGIN');
      try {
        for (const r of records) {
          const date = String(r[dateKey] || '').slice(0, 10);
          const raw = r[valueKey];
          const value = raw === '.' ? null : Number(raw);
          if (!date || value === null || !Number.isFinite(value)) {
            skipped += 1;
            continue;
          }
          await client.query(
            `INSERT INTO fred_data (series_id, date, value, fetched_at)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (series_id, date)
             DO UPDATE SET value = EXCLUDED.value, fetched_at = CURRENT_TIMESTAMP`,
            [seriesId, date, value]
          );
          imported += 1;
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  } else {
    const db = getDb();
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO fred_data (series_id, date, value, fetched_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `);
    const insertMany = db.transaction(() => {
      for (const r of records) {
        const date = String(r[dateKey] || '').slice(0, 10);
        const raw = r[valueKey];
        const value = raw === '.' ? null : Number(raw);
        if (!date || value === null || !Number.isFinite(value)) {
          skipped += 1;
          continue;
        }
        upsert.run(seriesId, date, value);
        imported += 1;
      }
    });
    insertMany();
  }
  res.json({
    success: true,
    series: seriesId,
    imported,
    skipped,
    inferred: { dateKey, valueKey },
  });
});

// GET /api/market/valuation - Portfolio mark-to-market
router.get('/valuation', async (req: Request, res: Response) => {
  const unitsSql = `
    SELECT
      pu.id as unit_id,
      bu.unit_number,
      pu.purchase_date,
      COALESCE(pu.total_acquisition_cost, pu.purchase_price) as acquisition_basis,
      COALESCE((
        SELECT SUM(-cfa.amount)
        FROM cash_flow_actuals cfa
        WHERE cfa.portfolio_unit_id = pu.id
          AND cfa.category = 'repair'
          AND cfa.reconciled = 1
      ), 0) as reconciled_reno_spend
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
  `;

  const fredSql = `
    SELECT series_id as "seriesId", date, value FROM fred_data
    WHERE series_id = ?
    ORDER BY date
  `;
  const { units, fredData } = usePostgresMarket()
    ? await withPostgresClient(async (client) => {
      const [unitsResult, fredResult] = await Promise.all([
        client.query(unitsSql),
        client.query(fredSql.replace('?', '$1'), [MIAMI_INDEX_SERIES]),
      ]);
      return {
        units: unitsResult.rows as any[],
        fredData: fredResult.rows as any[],
      };
    })
    : (() => {
      const db = getDb();
      return {
        units: db.prepare(unitsSql).all() as any[],
        fredData: db.prepare(fredSql).all(MIAMI_INDEX_SERIES) as any[],
      };
    })();

  const currentDate = new Date().toISOString().split('T')[0];
  const valuation = markPortfolio(
    units.map(u => ({
      unitId: u.unit_id,
      unitNumber: u.unit_number,
      purchaseDate: u.purchase_date,
      // NAV v1: mark cost basis (acquisition + reconciled renovations) by FRED index.
      purchasePrice: Number(u.acquisition_basis || 0) + Number(u.reconciled_reno_spend || 0),
    })),
    fredData,
    currentDate
  );

  res.json(valuation);
});

export default router;
