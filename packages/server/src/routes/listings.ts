/**
 * Listings management routes.
 * Manual entry for now, API-ready for future integration.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';

const router = Router();
router.use(requireAuth, requireGP);
const usePostgresListings = () => isPostgresPrimaryMode() || usePostgresReads();

// GET /api/listings - Current listings
router.get('/', async (req: Request, res: Response) => {
  const fundEmail = process.env.FROM_EMAIL || 'info@305opportunityfund.com';
  const sql = `
    SELECT
      l.*,
      bu.floor, bu.unit_letter, bu.consensus_status, bu.listing_agreement, bu.is_fund_owned,
      ut.beds, ut.sqft, ut.ownership_pct,
      CASE WHEN bu.is_fund_owned = 1 THEN COALESCE(e.name, bu.owner_name, '305 Opportunities Fund') ELSE bu.owner_name END as owner_name,
      CASE WHEN bu.is_fund_owned = 1 THEN ? ELSE bu.owner_email END as owner_email,
      bu.owner_phone,
      CASE WHEN bu.is_fund_owned = 1 THEN COALESCE(e.name, bu.owner_company) ELSE bu.owner_company END as owner_company
    FROM listings l
    LEFT JOIN building_units bu ON l.building_unit_id = bu.id
    LEFT JOIN unit_types ut ON bu.unit_type_id = ut.id
    LEFT JOIN portfolio_units pu ON pu.building_unit_id = bu.id
    LEFT JOIN entities e ON pu.entity_id = e.id
    ORDER BY l.listed_date DESC
  `;
  const listings = usePostgresListings()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(sql.replace('?', '$1'), [fundEmail]);
      return result.rows;
    })
    : getDb().prepare(sql).all(fundEmail);
  res.json(listings);
});

// POST /api/listings/manual - Manually add listing
router.post('/manual', async (req: Request, res: Response) => {
  const {
    unitNumber, askingPrice, source = 'manual', sourceUrl,
    listedDate, buildingUnitId,
  } = req.body;

  // Try to match to a building unit if not provided
  let matchedUnitId = buildingUnitId;
  let pricePSF = 0;
  let impliedValue = 0;

  if (!matchedUnitId && unitNumber) {
    const bu = usePostgresListings()
      ? await withPostgresClient(async (client) => {
        const result = await client.query('SELECT id FROM building_units WHERE unit_number = $1 LIMIT 1', [unitNumber]);
        return (result.rows[0] || null) as any;
      })
      : (getDb().prepare('SELECT id FROM building_units WHERE unit_number = ?').get(unitNumber) as any);
    if (bu) matchedUnitId = bu.id;
  }

  if (matchedUnitId) {
    const unitInfo = usePostgresListings()
      ? await withPostgresClient(async (client) => {
        const result = await client.query(
          `SELECT ut.sqft, ut.ownership_pct
           FROM building_units bu
           JOIN unit_types ut ON bu.unit_type_id = ut.id
           WHERE bu.id = $1
           LIMIT 1`,
          [matchedUnitId]
        );
        return (result.rows[0] || null) as any;
      })
      : (getDb().prepare(`
        SELECT ut.sqft, ut.ownership_pct
        FROM building_units bu
        JOIN unit_types ut ON bu.unit_type_id = ut.id
        WHERE bu.id = ?
      `).get(matchedUnitId) as any);

    if (unitInfo) {
      pricePSF = unitInfo.sqft > 0 ? askingPrice / unitInfo.sqft : 0;
      impliedValue = unitInfo.ownership_pct > 0 ? askingPrice / (unitInfo.ownership_pct / 100) : 0;
    }
  }

  const insertedId = usePostgresListings()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO listings (building_unit_id, unit_number, source, source_url, asking_price, price_psf, listed_date, status, implied_building_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
         RETURNING id`,
        [matchedUnitId, unitNumber, source, sourceUrl, askingPrice, pricePSF, listedDate, impliedValue]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(`
        INSERT INTO listings (building_unit_id, unit_number, source, source_url, asking_price, price_psf, listed_date, status, implied_building_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(matchedUnitId, unitNumber, source, sourceUrl, askingPrice, pricePSF, listedDate, impliedValue).lastInsertRowid
    );

  res.status(201).json({ id: insertedId, pricePSF, impliedBuildingValue: impliedValue });
});

// GET /api/listings/:id/what-if - Model adding this unit
router.get('/:id/what-if', async (req: Request, res: Response) => {
  const listingSql = `
    SELECT l.*, ut.ownership_pct, ut.sqft, ut.beds
    FROM listings l
    LEFT JOIN building_units bu ON l.building_unit_id = bu.id
    LEFT JOIN unit_types ut ON bu.unit_type_id = ut.id
    WHERE l.id = ?
  `;
  const listing = usePostgresListings()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(listingSql.replace('?', '$1'), [req.params.id]);
      return (result.rows[0] || null) as any;
    })
    : (getDb().prepare(listingSql).get(req.params.id) as any);

  if (!listing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  // Get current portfolio summary
  const portfolioSql = `
    SELECT
      COUNT(*) as units,
      COALESCE(SUM(ut.ownership_pct), 0) as ownership_pct,
      COALESCE(SUM(pu.total_acquisition_cost), 0) as total_invested
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    JOIN unit_types ut ON bu.unit_type_id = ut.id
  `;
  const portfolio = usePostgresListings()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(portfolioSql);
      return (result.rows[0] || {}) as any;
    })
    : (getDb().prepare(portfolioSql).get() as any);

  // What-if: add this unit
  const newOwnershipPct = (portfolio.ownership_pct || 0) + (listing.ownership_pct || 0);
  const newTotalInvested = (portfolio.total_invested || 0) + listing.asking_price;
  const newUnitCount = (portfolio.units || 0) + 1;

  // Check if unit is flagged as unsigned
  const unsignedSql = `
    SELECT consensus_status, listing_agreement
    FROM building_units WHERE id = ?
  `;
  const isUnsigned = usePostgresListings()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(unsignedSql.replace('?', '$1'), [listing.building_unit_id]);
      return (result.rows[0] || null) as any;
    })
    : (getDb().prepare(unsignedSql).get(listing.building_unit_id) as any);

  res.json({
    listing,
    currentPortfolio: {
      units: portfolio.units || 0,
      ownershipPct: portfolio.ownership_pct || 0,
      totalInvested: portfolio.total_invested || 0,
    },
    whatIf: {
      units: newUnitCount,
      ownershipPct: newOwnershipPct,
      totalInvested: newTotalInvested,
      additionalOwnershipPct: listing.ownership_pct || 0,
      impliedBuildingValue: listing.implied_building_value,
      pricePSF: listing.price_psf,
    },
    flags: {
      isUnsigned: isUnsigned?.listing_agreement === 'unsigned',
      consensusStatus: isUnsigned?.consensus_status,
      listingAgreementStatus: isUnsigned?.listing_agreement,
    },
  });
});

// PUT /api/listings/:id - Update a listing
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { unitNumber, source, sourceUrl, askingPrice, listedDate, status } = req.body;

  const existing = usePostgresListings()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT * FROM listings WHERE id = $1 LIMIT 1', [Number(id)]);
      return (result.rows[0] || null) as any;
    })
    : (getDb().prepare('SELECT * FROM listings WHERE id = ?').get(Number(id)) as any);
  if (!existing) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  // Recalculate price_psf and implied_building_value if asking price changed
  let pricePSF = existing.price_psf;
  let impliedValue = existing.implied_building_value;
  const price = askingPrice ?? existing.asking_price;

  if (existing.building_unit_id) {
    const unitInfo = usePostgresListings()
      ? await withPostgresClient(async (client) => {
        const result = await client.query(
          `SELECT ut.sqft, ut.ownership_pct
           FROM building_units bu
           JOIN unit_types ut ON bu.unit_type_id = ut.id
           WHERE bu.id = $1
           LIMIT 1`,
          [existing.building_unit_id]
        );
        return (result.rows[0] || null) as any;
      })
      : (getDb().prepare(`
        SELECT ut.sqft, ut.ownership_pct
        FROM building_units bu
        JOIN unit_types ut ON bu.unit_type_id = ut.id
        WHERE bu.id = ?
      `).get(existing.building_unit_id) as any);

    if (unitInfo) {
      pricePSF = unitInfo.sqft > 0 ? price / unitInfo.sqft : 0;
      impliedValue = unitInfo.ownership_pct > 0 ? price / (unitInfo.ownership_pct / 100) : 0;
    }
  }

  if (usePostgresListings()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `UPDATE listings SET
           unit_number = COALESCE($1, unit_number),
           source = COALESCE($2, source),
           source_url = COALESCE($3, source_url),
           asking_price = COALESCE($4, asking_price),
           price_psf = $5,
           listed_date = COALESCE($6, listed_date),
           status = COALESCE($7, status),
           implied_building_value = $8
         WHERE id = $9`,
        [
          unitNumber ?? null,
          source ?? null,
          sourceUrl ?? null,
          askingPrice ?? null,
          pricePSF,
          listedDate ?? null,
          status ?? null,
          impliedValue,
          Number(id),
        ]
      );
    });
  } else {
    const db = getDb();
    db.prepare(`
      UPDATE listings SET
        unit_number = COALESCE(?, unit_number),
        source = COALESCE(?, source),
        source_url = COALESCE(?, source_url),
        asking_price = COALESCE(?, asking_price),
        price_psf = ?,
        listed_date = COALESCE(?, listed_date),
        status = COALESCE(?, status),
        implied_building_value = ?
      WHERE id = ?
    `).run(
      unitNumber ?? null,
      source ?? null,
      sourceUrl ?? null,
      askingPrice ?? null,
      pricePSF,
      listedDate ?? null,
      status ?? null,
      impliedValue,
      Number(id)
    );
  }

  res.json({ success: true });
});

// DELETE /api/listings/:id - Delete a listing
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const deleted = usePostgresListings()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('DELETE FROM listings WHERE id = $1', [Number(id)]);
      return Number(result.rowCount || 0);
    })
    : Number(getDb().prepare('DELETE FROM listings WHERE id = ?').run(Number(id)).changes || 0);
  if (deleted === 0) {
    res.status(404).json({ error: 'Listing not found' });
    return;
  }

  res.json({ success: true });
});

export default router;
