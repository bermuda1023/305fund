/**
 * Market data routes.
 * FRED API integration and portfolio mark-to-market.
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { markPortfolio } from '@brickell/engine';

const router = Router();
router.use(requireAuth, requireGP);

const FRED_BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const MIAMI_INDEX_SERIES = 'MIXRNSA'; // S&P/Case-Shiller Miami Home Price Index

// GET /api/market/fred - Latest FRED data
router.get('/fred', (req: Request, res: Response) => {
  const db = getDb();
  const data = db.prepare(`
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

    res.json({ imported: observations.length, series: MIAMI_INDEX_SERIES });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch FRED data', details: error.message });
  }
});

// GET /api/market/valuation - Portfolio mark-to-market
router.get('/valuation', (req: Request, res: Response) => {
  const db = getDb();

  // Get portfolio units
  const units = db.prepare(`
    SELECT pu.id as unit_id, bu.unit_number, pu.purchase_date, pu.purchase_price
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
  `).all() as any[];

  // Get FRED data
  const fredData = db.prepare(`
    SELECT series_id as "seriesId", date, value FROM fred_data
    WHERE series_id = ?
    ORDER BY date
  `).all(MIAMI_INDEX_SERIES) as any[];

  const currentDate = new Date().toISOString().split('T')[0];
  const valuation = markPortfolio(
    units.map(u => ({
      unitId: u.unit_id,
      unitNumber: u.unit_number,
      purchaseDate: u.purchase_date,
      purchasePrice: u.purchase_price,
    })),
    fredData,
    currentDate
  );

  res.json(valuation);
});

export default router;
