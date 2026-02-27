/**
 * Portfolio management routes.
 * CRUD for fund-owned units, entities, tenants, renovations, documents, communications.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { sendTransactionalEmail } from '../lib/email';
import { withPostgresClient } from '../db/postgres-client';
import { isPostgresPrimaryMode, usePostgresReads } from '../db/runtime-mode';

const router = Router();
const usePostgresPortfolio = () => isPostgresPrimaryMode() || usePostgresReads();

// All portfolio routes require GP auth
router.use(requireAuth, requireGP);

async function syncFundOwnedContractFields(db: ReturnType<typeof getDb>, portfolioUnitId: number) {
  if (usePostgresPortfolio()) {
    await withPostgresClient(async (client) => {
      const rowResult = await client.query(
        `SELECT
           pu.id as portfolio_unit_id,
           pu.building_unit_id,
           e.name as entity_name,
           t.name as tenant_name
         FROM portfolio_units pu
         LEFT JOIN entities e ON pu.entity_id = e.id
         LEFT JOIN tenants t ON t.portfolio_unit_id = pu.id AND t.status IN ('active', 'month_to_month')
         WHERE pu.id = $1
         ORDER BY t.id DESC
         LIMIT 1`,
        [portfolioUnitId]
      );
      const row = rowResult.rows[0] as any;
      if (!row) return;
      await client.query(
        `UPDATE building_units
         SET
           is_fund_owned = 1,
           consensus_status = 'signed',
           listing_agreement = 'signed',
           resident_name = COALESCE($1, resident_name),
           resident_type = 'investment',
           owner_name = COALESCE($2, owner_name),
           owner_company = COALESCE($3, owner_company)
         WHERE id = $4`,
        [row.tenant_name || null, row.entity_name || null, row.entity_name || null, row.building_unit_id]
      );
    });
    return;
  }

  const row = db.prepare(`
    SELECT
      pu.id as portfolio_unit_id,
      pu.building_unit_id,
      e.name as entity_name,
      t.name as tenant_name
    FROM portfolio_units pu
    LEFT JOIN entities e ON pu.entity_id = e.id
    LEFT JOIN tenants t ON t.portfolio_unit_id = pu.id AND t.status IN ('active', 'month_to_month')
    WHERE pu.id = ?
    ORDER BY t.id DESC
    LIMIT 1
  `).get(portfolioUnitId) as any;

  if (!row) return;

  db.prepare(`
    UPDATE building_units
    SET
      is_fund_owned = 1,
      consensus_status = 'signed',
      listing_agreement = 'signed',
      resident_name = COALESCE(?, resident_name),
      resident_type = 'investment',
      owner_name = COALESCE(?, owner_name),
      owner_company = COALESCE(?, owner_company)
    WHERE id = ?
  `).run(row.tenant_name || null, row.entity_name || null, row.entity_name || null, row.building_unit_id);
}

type RentReminderSettings = {
  enabled: number;
  days_late_threshold: number;
  subject_template: string;
  body_template: string;
};

function clampDay(day: number) {
  return Math.max(1, Math.min(28, Math.round(day || 1)));
}

function fmtDollars(n: number) {
  return `$${Math.round((n + Number.EPSILON) * 100) / 100}`;
}

function renderTemplate(tpl: string, vars: Record<string, string>) {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v);
  }
  return out;
}

function monthWindow(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const y = start.getUTCFullYear();
  const m = String(start.getUTCMonth() + 1).padStart(2, '0');
  const key = `${y}-${m}`;
  return {
    key,
    periodLabel: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
  };
}

function runRentReminderSweepCore(db: ReturnType<typeof getDb>) {
  const now = new Date();
  const month = monthWindow(now);
  const settings = db.prepare(
    'SELECT enabled, days_late_threshold, subject_template, body_template FROM rent_reminder_settings WHERE id = 1'
  ).get() as RentReminderSettings | undefined;
  if (!settings || !settings.enabled) {
    return { checked: 0, alerts: 0, skipped: 0, month: month.key };
  }

  const tenants = db.prepare(`
    SELECT
      t.id, t.name, t.email, t.rent_due_day, t.monthly_rent, t.status,
      pu.id as portfolio_unit_id,
      bu.unit_number
    FROM tenants t
    JOIN portfolio_units pu ON t.portfolio_unit_id = pu.id
    JOIN building_units bu ON pu.building_unit_id = bu.id
    WHERE t.status IN ('active', 'month_to_month')
      AND t.email IS NOT NULL
      AND TRIM(t.email) <> ''
      AND t.monthly_rent > 0
  `).all() as Array<{
    id: number;
    name: string;
    email: string;
    rent_due_day: number;
    monthly_rent: number;
    status: string;
    portfolio_unit_id: number;
    unit_number: string;
  }>;

  const paidStmt = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as paid
    FROM cash_flow_actuals
    WHERE portfolio_unit_id = ?
      AND category = 'rent'
      AND amount > 0
      AND date >= ?
      AND date <= ?
  `);
  const dupStmt = db.prepare(`
    SELECT id
    FROM tenant_communications
    WHERE tenant_id = ?
      AND template_name = ?
    LIMIT 1
  `);
  const commInsert = db.prepare(`
    INSERT INTO tenant_communications (tenant_id, type, subject, body, status, template_name, sent_at)
    VALUES (?, 'email', ?, ?, 'draft', ?, CURRENT_TIMESTAMP)
  `);
  const commStatusUpdate = db.prepare(`
    UPDATE tenant_communications
    SET status = ?, sent_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let checked = 0;
  let alerts = 0;
  let skipped = 0;

  const inTx = db.transaction(() => {
    for (const t of tenants) {
      checked += 1;
      const dueDay = clampDay(Number(t.rent_due_day || 1));
      const dueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dueDay));
      const msLate = now.getTime() - dueDate.getTime();
      const daysLate = Math.floor(msLate / (24 * 60 * 60 * 1000));

      if (daysLate < Number(settings.days_late_threshold || 0)) {
        skipped += 1;
        continue;
      }

      const paid = Number((paidStmt.get(t.portfolio_unit_id, month.startIso, month.endIso) as any)?.paid || 0);
      const outstanding = Math.max(0, Number(t.monthly_rent) - paid);
      if (outstanding <= 0.009) {
        skipped += 1;
        continue;
      }

      const templateName = `rent_reminder:${month.key}`;
      const existing = dupStmt.get(t.id, templateName);
      if (existing) {
        skipped += 1;
        continue;
      }

      const subject = renderTemplate(settings.subject_template, {
        tenant_name: t.name,
        unit_number: t.unit_number,
        days_late: String(daysLate),
        period_label: month.periodLabel,
        amount_due: fmtDollars(Number(t.monthly_rent)),
        amount_paid: fmtDollars(paid),
        amount_outstanding: fmtDollars(outstanding),
      });
      const body = renderTemplate(settings.body_template, {
        tenant_name: t.name,
        unit_number: t.unit_number,
        days_late: String(daysLate),
        period_label: month.periodLabel,
        amount_due: fmtDollars(Number(t.monthly_rent)),
        amount_paid: fmtDollars(paid),
        amount_outstanding: fmtDollars(outstanding),
      });

      const commResult = commInsert.run(t.id, subject, body, templateName);
      const commId = Number(commResult.lastInsertRowid);
      void sendTransactionalEmail({
        to: t.email,
        subject,
        text: body,
      })
        .then((sent) => {
          commStatusUpdate.run(sent ? 'sent' : 'failed', commId);
        })
        .catch(() => {
          commStatusUpdate.run('failed', commId);
        });
      alerts += 1;
    }

    db.prepare(`
      INSERT INTO rent_reminder_runs (checked_count, alert_count, skipped_count, notes)
      VALUES (?, ?, ?, ?)
    `).run(checked, alerts, skipped, `period=${month.key}`);
  });

  inTx();
  return { checked, alerts, skipped, month: month.key };
}

// GET /api/portfolio - All fund-owned units with aggregates
router.get('/', async (req: Request, res: Response) => {
  const sql = `
    SELECT
      pu.*,
      bu.floor, bu.unit_number, bu.unit_letter,
      COALESCE(ut.beds, 0) as beds, COALESCE(ut.sqft, 0) as sqft, COALESCE(ut.ownership_pct, 0) as ownership_pct,
      e.name as entity_name,
      t.name as tenant_name, t.status as tenant_status, t.monthly_rent as tenant_rent,
      t.lease_start, t.lease_end, t.email as tenant_email, t.phone as tenant_phone
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    LEFT JOIN unit_types ut ON bu.unit_type_id = ut.id
    LEFT JOIN entities e ON pu.entity_id = e.id
    LEFT JOIN tenants t ON t.portfolio_unit_id = pu.id AND t.status IN ('active', 'month_to_month')
    ORDER BY bu.floor, bu.unit_letter
  `;
  const units = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(sql);
      return result.rows;
    })
    : getDb().prepare(sql).all();

  res.json(units);
});

// GET /api/portfolio/summary - Aggregate stats
router.get('/summary', async (req: Request, res: Response) => {
  const summarySql = `
    SELECT
      COUNT(*) as total_units_owned,
      COALESCE(SUM(ut.ownership_pct), 0) as total_ownership_pct,
      SUM(pu.total_acquisition_cost) as total_invested,
      SUM(pu.monthly_rent) as total_monthly_rent,
      SUM(pu.monthly_hoa) as total_monthly_hoa,
      SUM(pu.monthly_rent - pu.monthly_hoa - (pu.monthly_insurance / 12.0) - (pu.monthly_tax / 12.0)) as total_monthly_noi,
      COALESCE(SUM(ut.sqft), 0) as total_sqft
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    LEFT JOIN unit_types ut ON bu.unit_type_id = ut.id
  `;

  const renoSql = `
    SELECT COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as total
    FROM unit_renovations
  `;

  const tenantSql = `
    SELECT
      COUNT(CASE WHEN t.status IN ('active', 'month_to_month') THEN 1 END) as active_tenants,
      COUNT(DISTINCT pu.id) - COUNT(CASE WHEN t.status IN ('active', 'month_to_month') THEN 1 END) as vacant_units
    FROM portfolio_units pu
    LEFT JOIN tenants t ON t.portfolio_unit_id = pu.id AND t.status IN ('active', 'month_to_month')
  `;
  const { summary, renoSpend, tenantStats } = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const [summaryResult, renoResult, tenantResult] = await Promise.all([
        client.query(summarySql),
        client.query(renoSql),
        client.query(tenantSql),
      ]);
      return {
        summary: (summaryResult.rows[0] || {}) as any,
        renoSpend: (renoResult.rows[0] || {}) as any,
        tenantStats: (tenantResult.rows[0] || {}) as any,
      };
    })
    : (() => {
      const db = getDb();
      return {
        summary: db.prepare(summarySql).get() as any,
        renoSpend: db.prepare(renoSql).get() as any,
        tenantStats: db.prepare(tenantSql).get() as any,
      };
    })();

  const totalInvested = summary.total_invested || 0;
  const annualNOI = (summary.total_monthly_noi || 0) * 12;

  res.json({
    totalUnitsOwned: summary.total_units_owned || 0,
    totalOwnershipPct: summary.total_ownership_pct || 0,
    totalInvested,
    totalMonthlyRent: summary.total_monthly_rent || 0,
    totalMonthlyHOA: summary.total_monthly_hoa || 0,
    totalMonthlyNOI: summary.total_monthly_noi || 0,
    annualizedYield: totalInvested > 0 ? annualNOI / totalInvested : 0,
    totalSqft: summary.total_sqft || 0,
    avgPricePSF: (summary.total_sqft || 0) > 0 ? totalInvested / summary.total_sqft : 0,
    totalRenovationSpend: renoSpend.total || 0,
    unitsWithActiveTenants: tenantStats.active_tenants || 0,
    unitsVacant: tenantStats.vacant_units || 0,
  });
});

// POST /api/portfolio/units - Add acquired unit
router.post('/units', async (req: Request, res: Response) => {
  const db = getDb();
  const {
    buildingUnitId, entityId, purchaseDate, purchasePrice,
    closingCosts = 0, transferTax = 0, inspectionCost = 0,
    monthlyRent = 0, monthlyInsurance = 0, monthlyTax = 0,
    hoaIsRecurring = true, insuranceIsRecurring = false, taxIsRecurring = false,
    hoaReconcileRef = null, insuranceReconcileRef = null, taxReconcileRef = null,
    insurancePaymentMonth = 1, insurancePaymentDay = 1,
    taxPaymentMonth = 1, taxPaymentDay = 1,
    scenarioId,
  } = req.body;

  // Get unit details for PSF and HOA calculation
  const unit = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `SELECT ut.sqft, ut.base_hoa FROM building_units bu
         JOIN unit_types ut ON bu.unit_type_id = ut.id
         WHERE bu.id = $1
         LIMIT 1`,
        [buildingUnitId]
      );
      return (result.rows[0] || null) as any;
    })
    : (db.prepare(`
      SELECT ut.sqft, ut.base_hoa FROM building_units bu
      JOIN unit_types ut ON bu.unit_type_id = ut.id
      WHERE bu.id = ?
    `).get(buildingUnitId) as any);

  if (!unit) {
    res.status(404).json({ error: 'Building unit not found' });
    return;
  }

  const pricePSF = unit.sqft > 0 ? purchasePrice / unit.sqft : 0;
  const totalAcquisitionCost = purchasePrice + closingCosts + transferTax + inspectionCost;

  const insertedId = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO portfolio_units (
          building_unit_id, entity_id, purchase_date, purchase_price, purchase_price_psf,
          closing_costs, transfer_tax, inspection_cost, total_acquisition_cost,
          monthly_rent, monthly_hoa, hoa_is_recurring, hoa_reconcile_ref,
          monthly_insurance, insurance_payment_month, insurance_payment_day, insurance_is_recurring, insurance_reconcile_ref,
          monthly_tax, tax_payment_month, tax_payment_day, tax_is_recurring, tax_reconcile_ref, scenario_id
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23, $24
        )
        RETURNING id`,
        [
          buildingUnitId, entityId, purchaseDate, purchasePrice, pricePSF,
          closingCosts, transferTax, inspectionCost, totalAcquisitionCost,
          monthlyRent, unit.base_hoa, hoaIsRecurring ? 1 : 0, hoaReconcileRef,
          monthlyInsurance, insurancePaymentMonth, insurancePaymentDay, insuranceIsRecurring ? 1 : 0, insuranceReconcileRef,
          monthlyTax, taxPaymentMonth, taxPaymentDay, taxIsRecurring ? 1 : 0, taxReconcileRef, scenarioId,
        ]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      db.prepare(`
        INSERT INTO portfolio_units (
          building_unit_id, entity_id, purchase_date, purchase_price, purchase_price_psf,
          closing_costs, transfer_tax, inspection_cost, total_acquisition_cost,
          monthly_rent, monthly_hoa, hoa_is_recurring, hoa_reconcile_ref,
          monthly_insurance, insurance_payment_month, insurance_payment_day, insurance_is_recurring, insurance_reconcile_ref,
          monthly_tax, tax_payment_month, tax_payment_day, tax_is_recurring, tax_reconcile_ref, scenario_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        buildingUnitId, entityId, purchaseDate, purchasePrice, pricePSF,
        closingCosts, transferTax, inspectionCost, totalAcquisitionCost,
        monthlyRent, unit.base_hoa, hoaIsRecurring ? 1 : 0, hoaReconcileRef,
        monthlyInsurance, insurancePaymentMonth, insurancePaymentDay, insuranceIsRecurring ? 1 : 0, insuranceReconcileRef,
        monthlyTax, taxPaymentMonth, taxPaymentDay, taxIsRecurring ? 1 : 0, taxReconcileRef, scenarioId
      ).lastInsertRowid
    );

  // Mark building unit as fund-owned and force signed investment posture in contracts view
  await syncFundOwnedContractFields(db, insertedId);

  res.status(201).json({ id: insertedId });
});

// PUT /api/portfolio/units/:id - Update unit
router.put('/units/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const fields = req.body;

  const allowedFields = [
    'entity_id', 'monthly_rent', 'monthly_hoa', 'monthly_insurance',
    'monthly_tax', 'scenario_id',
    'hoa_is_recurring', 'hoa_reconcile_ref',
    'insurance_is_recurring', 'insurance_reconcile_ref',
    'tax_is_recurring', 'tax_reconcile_ref',
    'insurance_payment_month', 'insurance_payment_day',
    'tax_payment_month', 'tax_payment_day',
  ];

  const updates: string[] = [];
  const values: any[] = [];

  for (const [key, val] of Object.entries(fields)) {
    const dbKey = key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    if (allowedFields.includes(dbKey)) {
      updates.push(`${dbKey} = ?`);
      values.push(val);
    }
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No valid fields to update' });
    return;
  }

  values.push(id);
  if (usePostgresPortfolio()) {
    await withPostgresClient(async (client) => {
      const setClause = updates.map((u, idx) => u.replace('?', `$${idx + 1}`)).join(', ');
      const result = await client.query(`UPDATE portfolio_units SET ${setClause} WHERE id = $${values.length}`, values);
      void result;
    });
  } else {
    db.prepare(`UPDATE portfolio_units SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }
  await syncFundOwnedContractFields(db, Number(id));
  res.json({ success: true });
});

// DELETE /api/portfolio/units/:id - Remove unit
router.delete('/units/:id', async (req: Request, res: Response) => {
  const db = getDb();
  const unitId = Number(req.params.id);

  const unit = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT id, building_unit_id FROM portfolio_units WHERE id = $1 LIMIT 1', [unitId]);
      return (result.rows[0] || null) as any;
    })
    : (db.prepare(`
      SELECT id, building_unit_id FROM portfolio_units WHERE id = ?
    `).get(unitId) as any);

  if (!unit) {
    res.status(404).json({ error: 'Portfolio unit not found' });
    return;
  }

  const tenantRows = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT id FROM tenants WHERE portfolio_unit_id = $1', [unitId]);
      return result.rows as Array<{ id: number }>;
    })
    : (db.prepare('SELECT id FROM tenants WHERE portfolio_unit_id = ?').all(unitId) as Array<{ id: number }>);
  const tenantIds = tenantRows.map((r) => r.id);
  const renoRows = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT id FROM unit_renovations WHERE portfolio_unit_id = $1', [unitId]);
      return result.rows as Array<{ id: number }>;
    })
    : (db.prepare('SELECT id FROM unit_renovations WHERE portfolio_unit_id = ?').all(unitId) as Array<{ id: number }>);
  const renoIds = renoRows.map((r) => r.id);

  const delTx = db.transaction(() => {
    if (tenantIds.length > 0) {
      const ph = tenantIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM tenant_communications WHERE tenant_id IN (${ph})`).run(...tenantIds);
      db.prepare(`DELETE FROM documents WHERE parent_type = 'tenant' AND parent_id IN (${ph})`).run(...tenantIds);
      db.prepare(`DELETE FROM tenants WHERE id IN (${ph})`).run(...tenantIds);
    }

    if (renoIds.length > 0) {
      const ph = renoIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM documents WHERE parent_type = 'renovation' AND parent_id IN (${ph})`).run(...renoIds);
      db.prepare(`DELETE FROM unit_renovations WHERE id IN (${ph})`).run(...renoIds);
    }

    db.prepare(`DELETE FROM documents WHERE parent_type = 'unit' AND parent_id = ?`).run(unitId);
    db.prepare(`DELETE FROM cash_flow_actuals WHERE portfolio_unit_id = ?`).run(unitId);
    db.prepare(`DELETE FROM portfolio_units WHERE id = ?`).run(unitId);

    db.prepare(`
      UPDATE building_units
      SET
        is_fund_owned = 0,
        consensus_status = 'unknown',
        listing_agreement = 'unknown',
        resident_name = NULL,
        resident_type = NULL,
        owner_name = NULL,
        owner_email = NULL,
        owner_phone = NULL,
        owner_company = NULL,
        notes = NULL
      WHERE id = ?
    `).run(unit.building_unit_id);
  });

  try {
    if (usePostgresPortfolio()) {
      await withPostgresClient(async (client) => {
        await client.query('BEGIN');
        try {
          if (tenantIds.length > 0) {
            await client.query('DELETE FROM tenant_communications WHERE tenant_id = ANY($1::int[])', [tenantIds]);
            await client.query("DELETE FROM documents WHERE parent_type = 'tenant' AND parent_id = ANY($1::int[])", [tenantIds]);
            await client.query('DELETE FROM tenants WHERE id = ANY($1::int[])', [tenantIds]);
          }
          if (renoIds.length > 0) {
            await client.query("DELETE FROM documents WHERE parent_type = 'renovation' AND parent_id = ANY($1::int[])", [renoIds]);
            await client.query('DELETE FROM unit_renovations WHERE id = ANY($1::int[])', [renoIds]);
          }
          await client.query("DELETE FROM documents WHERE parent_type = 'unit' AND parent_id = $1", [unitId]);
          await client.query("DELETE FROM cash_flow_actuals WHERE portfolio_unit_id = $1", [unitId]);
          await client.query("DELETE FROM portfolio_units WHERE id = $1", [unitId]);
          await client.query(
            `UPDATE building_units
             SET
               is_fund_owned = 0,
               consensus_status = 'unknown',
               listing_agreement = 'unknown',
               resident_name = NULL,
               resident_type = NULL,
               owner_name = NULL,
               owner_email = NULL,
               owner_phone = NULL,
               owner_company = NULL,
               notes = NULL
             WHERE id = $1`,
            [unit.building_unit_id]
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    } else {
      delTx();
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to delete portfolio unit' });
  }
});

// --- Tenants ---

// GET /api/portfolio/units/:id/tenants
router.get('/units/:id/tenants', async (req: Request, res: Response) => {
  const tenants = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        'SELECT * FROM tenants WHERE portfolio_unit_id = $1 ORDER BY lease_start DESC',
        [req.params.id]
      );
      return result.rows;
    })
    : getDb().prepare(
      'SELECT * FROM tenants WHERE portfolio_unit_id = ? ORDER BY lease_start DESC'
    ).all(req.params.id);
  res.json(tenants);
});

// POST /api/portfolio/units/:id/tenants
router.post('/units/:id/tenants', async (req: Request, res: Response) => {
  const { name, email, phone, leaseStart, leaseEnd, monthlyRent, securityDeposit = 0, notes, rentDueDay = 1 } = req.body;
  const insertedId = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO tenants (portfolio_unit_id, name, email, phone, lease_start, lease_end, rent_due_day, monthly_rent, security_deposit, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10)
         RETURNING id`,
        [
          req.params.id,
          name,
          email,
          phone,
          leaseStart,
          leaseEnd,
          clampDay(Number(rentDueDay || 1)),
          monthlyRent,
          securityDeposit,
          notes,
        ]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(`
        INSERT INTO tenants (portfolio_unit_id, name, email, phone, lease_start, lease_end, rent_due_day, monthly_rent, security_deposit, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(req.params.id, name, email, phone, leaseStart, leaseEnd, clampDay(Number(rentDueDay || 1)), monthlyRent, securityDeposit, notes).lastInsertRowid
    );

  await syncFundOwnedContractFields(getDb(), Number(req.params.id));
  res.status(201).json({ id: insertedId });
});

// PUT /api/portfolio/tenants/:id  (FIXED: was /../tenants/:id)
router.put('/tenants/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email, phone, leaseStart, leaseEnd, rentDueDay, monthlyRent, securityDeposit, status, notes } = req.body;
  const tenantRow = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT portfolio_unit_id FROM tenants WHERE id = $1 LIMIT 1', [id]);
      return (result.rows[0] || null) as any;
    })
    : (getDb().prepare('SELECT portfolio_unit_id FROM tenants WHERE id = ?').get(id) as any);

  if (usePostgresPortfolio()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `UPDATE tenants SET
           name = COALESCE($1, name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           lease_start = COALESCE($4, lease_start),
           lease_end = COALESCE($5, lease_end),
           rent_due_day = COALESCE($6, rent_due_day),
           monthly_rent = COALESCE($7, monthly_rent),
           security_deposit = COALESCE($8, security_deposit),
           status = COALESCE($9, status),
           notes = COALESCE($10, notes)
         WHERE id = $11`,
        [name, email, phone, leaseStart, leaseEnd, rentDueDay ? clampDay(Number(rentDueDay)) : null, monthlyRent, securityDeposit, status, notes, id]
      );
    });
  } else {
    const db = getDb();
    db.prepare(`
      UPDATE tenants SET
        name = COALESCE(?, name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        lease_start = COALESCE(?, lease_start),
        lease_end = COALESCE(?, lease_end),
        rent_due_day = COALESCE(?, rent_due_day),
        monthly_rent = COALESCE(?, monthly_rent),
        security_deposit = COALESCE(?, security_deposit),
        status = COALESCE(?, status),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(name, email, phone, leaseStart, leaseEnd, rentDueDay ? clampDay(Number(rentDueDay)) : null, monthlyRent, securityDeposit, status, notes, id);
  }

  if (tenantRow?.portfolio_unit_id) {
    await syncFundOwnedContractFields(getDb(), Number(tenantRow.portfolio_unit_id));
  }
  res.json({ success: true });
});

// DELETE /api/portfolio/tenants/:id
router.delete('/tenants/:id', async (req: Request, res: Response) => {
  const tenantRow = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query('SELECT portfolio_unit_id FROM tenants WHERE id = $1 LIMIT 1', [req.params.id]);
      await client.query('DELETE FROM tenants WHERE id = $1', [req.params.id]);
      return (result.rows[0] || null) as any;
    })
    : (() => {
      const db = getDb();
      const row = db.prepare('SELECT portfolio_unit_id FROM tenants WHERE id = ?').get(req.params.id) as any;
      db.prepare('DELETE FROM tenants WHERE id = ?').run(req.params.id);
      return row;
    })();
  if (tenantRow?.portfolio_unit_id) {
    await syncFundOwnedContractFields(getDb(), Number(tenantRow.portfolio_unit_id));
  }
  res.json({ success: true });
});

// --- Renovations ---

// GET /api/portfolio/units/:id/renovations
router.get('/units/:id/renovations', async (req: Request, res: Response) => {
  const renos = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        'SELECT * FROM unit_renovations WHERE portfolio_unit_id = $1 ORDER BY start_date DESC',
        [req.params.id]
      );
      return result.rows;
    })
    : getDb().prepare(
      'SELECT * FROM unit_renovations WHERE portfolio_unit_id = ? ORDER BY start_date DESC'
    ).all(req.params.id);
  res.json(renos);
});

// POST /api/portfolio/units/:id/renovations
router.post('/units/:id/renovations', async (req: Request, res: Response) => {
  const {
    description, estimatedCost = 0, contractor, startDate, endDate, notes,
    expenseSource = 'bank', reconcileRef = null, reconciled = 0,
  } = req.body;

  const insertedId = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO unit_renovations (
           portfolio_unit_id, description, status, estimated_cost, expense_source, reconcile_ref, reconciled,
           contractor, start_date, end_date, notes
         )
         VALUES ($1, $2, 'planned', $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [req.params.id, description, estimatedCost, expenseSource, reconcileRef, reconciled ? 1 : 0, contractor, startDate, endDate, notes]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(`
        INSERT INTO unit_renovations (
          portfolio_unit_id, description, status, estimated_cost, expense_source, reconcile_ref, reconciled,
          contractor, start_date, end_date, notes
        )
        VALUES (?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(req.params.id, description, estimatedCost, expenseSource, reconcileRef, reconciled ? 1 : 0, contractor, startDate, endDate, notes).lastInsertRowid
    );
  res.status(201).json({ id: insertedId });
});

// PUT /api/portfolio/renovations/:id
router.put('/renovations/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    description, status, estimatedCost, actualCost, contractor, startDate, endDate, notes,
    expenseSource, reconcileRef, reconciled,
  } = req.body;

  if (usePostgresPortfolio()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `UPDATE unit_renovations SET
           description = COALESCE($1, description),
           status = COALESCE($2, status),
           estimated_cost = COALESCE($3, estimated_cost),
           actual_cost = COALESCE($4, actual_cost),
           expense_source = COALESCE($5, expense_source),
           reconcile_ref = COALESCE($6, reconcile_ref),
           reconciled = COALESCE($7, reconciled),
           contractor = COALESCE($8, contractor),
           start_date = COALESCE($9, start_date),
           end_date = COALESCE($10, end_date),
           notes = COALESCE($11, notes)
         WHERE id = $12`,
        [description, status, estimatedCost, actualCost, expenseSource, reconcileRef, reconciled, contractor, startDate, endDate, notes, id]
      );
    });
  } else {
    const db = getDb();
    db.prepare(`
      UPDATE unit_renovations SET
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        estimated_cost = COALESCE(?, estimated_cost),
        actual_cost = COALESCE(?, actual_cost),
        expense_source = COALESCE(?, expense_source),
        reconcile_ref = COALESCE(?, reconcile_ref),
        reconciled = COALESCE(?, reconciled),
        contractor = COALESCE(?, contractor),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(description, status, estimatedCost, actualCost, expenseSource, reconcileRef, reconciled, contractor, startDate, endDate, notes, id);
  }

  res.json({ success: true });
});

// DELETE /api/portfolio/renovations/:id
router.delete('/renovations/:id', async (req: Request, res: Response) => {
  if (usePostgresPortfolio()) {
    await withPostgresClient(async (client) => {
      await client.query('DELETE FROM unit_renovations WHERE id = $1', [req.params.id]);
    });
  } else {
    const db = getDb();
    db.prepare('DELETE FROM unit_renovations WHERE id = ?').run(req.params.id);
  }
  res.json({ success: true });
});

// --- Documents ---

// GET /api/portfolio/units/:id/documents
router.get('/units/:id/documents', async (req: Request, res: Response) => {
  const docs = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        "SELECT * FROM documents WHERE parent_type = 'unit' AND parent_id = $1 ORDER BY uploaded_at DESC",
        [req.params.id]
      );
      return result.rows;
    })
    : getDb().prepare(
      "SELECT * FROM documents WHERE parent_type = 'unit' AND parent_id = ? ORDER BY uploaded_at DESC"
    ).all(req.params.id);
  res.json(docs);
});

// GET /api/portfolio/units/:id/costs - rollup of reconciled actuals + basis
router.get('/units/:id/costs', async (req: Request, res: Response) => {
  const unitId = Number(req.params.id);
  if (!unitId) return res.status(400).json({ error: 'Invalid unit id' });
  const baseSql = `
    SELECT
      pu.id,
      pu.total_acquisition_cost,
      bu.unit_number
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    WHERE pu.id = ?
  `;
  const byCatSql = `
    SELECT category, SUM(amount) as total
    FROM cash_flow_actuals
    WHERE portfolio_unit_id = ?
      AND reconciled = 1
    GROUP BY category
  `;
  const renoLinkedSql = `
    SELECT COALESCE(SUM(-amount), 0) as total
    FROM cash_flow_actuals
    WHERE portfolio_unit_id = ?
      AND reconciled = 1
      AND unit_renovation_id IS NOT NULL
      AND category = 'repair'
  `;
  const repairUnlinkedSql = `
    SELECT COALESCE(SUM(-amount), 0) as total
    FROM cash_flow_actuals
    WHERE portfolio_unit_id = ?
      AND reconciled = 1
      AND unit_renovation_id IS NULL
      AND category = 'repair'
  `;
  const { base, byCat, renoLinked, repairUnlinked } = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const [baseResult, byCatResult, renoResult, repairResult] = await Promise.all([
        client.query(baseSql.replace('?', '$1'), [unitId]),
        client.query(byCatSql.replace('?', '$1'), [unitId]),
        client.query(renoLinkedSql.replace('?', '$1'), [unitId]),
        client.query(repairUnlinkedSql.replace('?', '$1'), [unitId]),
      ]);
      return {
        base: (baseResult.rows[0] || null) as any,
        byCat: byCatResult.rows as any[],
        renoLinked: (renoResult.rows[0] || {}) as any,
        repairUnlinked: (repairResult.rows[0] || {}) as any,
      };
    })
    : (() => {
      const db = getDb();
      return {
        base: db.prepare(baseSql).get(unitId) as any,
        byCat: db.prepare(byCatSql).all(unitId) as any[],
        renoLinked: db.prepare(renoLinkedSql).get(unitId) as any,
        repairUnlinked: db.prepare(repairUnlinkedSql).get(unitId) as any,
      };
    })();
  if (!base) return res.status(404).json({ error: 'Unit not found' });
  const totals: Record<string, number> = {};
  for (const r of byCat) totals[String(r.category)] = Number(r.total || 0);

  const acquisition = Number(base.total_acquisition_cost || 0);
  const renoSpend = Number(renoLinked?.total || 0);
  const totalBasis = acquisition + renoSpend;

  res.json({
    unitId,
    unitNumber: String(base.unit_number),
    acquisitionCost: acquisition,
    renovationSpend: renoSpend,
    repairSpendUnlinked: Number(repairUnlinked?.total || 0),
    totalBasis,
    totalsByCategory: totals,
  });
});

// --- Tenant Communications ---

// GET /api/portfolio/tenants/:tenantId/communications
router.get('/tenants/:tenantId/communications', async (req: Request, res: Response) => {
  const comms = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        'SELECT * FROM tenant_communications WHERE tenant_id = $1 ORDER BY sent_at DESC',
        [req.params.tenantId]
      );
      return result.rows;
    })
    : getDb().prepare(
      'SELECT * FROM tenant_communications WHERE tenant_id = ? ORDER BY sent_at DESC'
    ).all(req.params.tenantId);
  res.json(comms);
});

// POST /api/portfolio/tenants/:tenantId/communications
router.post('/tenants/:tenantId/communications', async (req: Request, res: Response) => {
  const { type = 'email', subject, body, templateName } = req.body;
  const insertedId = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO tenant_communications (tenant_id, type, subject, body, status, template_name)
         VALUES ($1, $2, $3, $4, 'draft', $5)
         RETURNING id`,
        [req.params.tenantId, type, subject, body, templateName]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(`
        INSERT INTO tenant_communications (tenant_id, type, subject, body, status, template_name)
        VALUES (?, ?, ?, ?, 'draft', ?)
      `).run(req.params.tenantId, type, subject, body, templateName).lastInsertRowid
    );
  res.status(201).json({ id: insertedId });
});

// PUT /api/portfolio/communications/:id/send — mark as sent
router.put('/communications/:id/send', async (req: Request, res: Response) => {
  if (usePostgresPortfolio()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `UPDATE tenant_communications SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [req.params.id]
      );
    });
  } else {
    const db = getDb();
    db.prepare(`
      UPDATE tenant_communications SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(req.params.id);
  }
  res.json({ success: true });
});

// GET /api/portfolio/rent-reminder-settings
router.get('/rent-reminder-settings', async (req: Request, res: Response) => {
  const settings = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `SELECT enabled, days_late_threshold, subject_template, body_template, updated_at
         FROM rent_reminder_settings
         WHERE id = 1`
      );
      return (result.rows[0] || null) as any;
    })
    : (getDb().prepare(`
      SELECT enabled, days_late_threshold, subject_template, body_template, updated_at
      FROM rent_reminder_settings
      WHERE id = 1
    `).get() as any);
  res.json(settings || {
    enabled: 1,
    days_late_threshold: 5,
    subject_template: 'Rent Reminder: {{unit_number}} is {{days_late}} day(s) past due',
    body_template: 'Hi {{tenant_name}},\n\nOur records show rent for {{period_label}} is still outstanding.\n\nAmount due: {{amount_due}}\nAmount received: {{amount_paid}}\nOutstanding: {{amount_outstanding}}\n\nPlease submit payment as soon as possible.\n\nThank you.',
    updated_at: null,
  });
});

// PUT /api/portfolio/rent-reminder-settings
router.put('/rent-reminder-settings', async (req: Request, res: Response) => {
  const {
    enabled,
    daysLateThreshold,
    subjectTemplate,
    bodyTemplate,
  } = req.body || {};

  const pEnabled = enabled === undefined ? null : (enabled ? 1 : 0);
  const pDays = daysLateThreshold === undefined ? null : Math.max(0, Math.round(Number(daysLateThreshold)));
  if (usePostgresPortfolio()) {
    await withPostgresClient(async (client) => {
      await client.query(
        `INSERT INTO rent_reminder_settings (id, enabled, days_late_threshold, subject_template, body_template, updated_at)
         VALUES (
           1,
           COALESCE($1, 1),
           COALESCE($2, 5),
           COALESCE($3, 'Rent Reminder: {{unit_number}} is {{days_late}} day(s) past due'),
           COALESCE($4, 'Hi {{tenant_name}},\n\nOur records show rent for {{period_label}} is still outstanding.\n\nAmount due: {{amount_due}}\nAmount received: {{amount_paid}}\nOutstanding: {{amount_outstanding}}\n\nPlease submit payment as soon as possible.\n\nThank you.'),
           CURRENT_TIMESTAMP
         )
         ON CONFLICT(id) DO UPDATE SET
           enabled = COALESCE(excluded.enabled, rent_reminder_settings.enabled),
           days_late_threshold = COALESCE(excluded.days_late_threshold, rent_reminder_settings.days_late_threshold),
           subject_template = COALESCE(excluded.subject_template, rent_reminder_settings.subject_template),
           body_template = COALESCE(excluded.body_template, rent_reminder_settings.body_template),
           updated_at = CURRENT_TIMESTAMP`,
        [pEnabled, pDays, subjectTemplate ?? null, bodyTemplate ?? null]
      );
    });
  } else {
    const db = getDb();
    db.prepare(`
      INSERT INTO rent_reminder_settings (id, enabled, days_late_threshold, subject_template, body_template, updated_at)
      VALUES (
        1,
        COALESCE(?, 1),
        COALESCE(?, 5),
        COALESCE(?, 'Rent Reminder: {{unit_number}} is {{days_late}} day(s) past due'),
        COALESCE(?, 'Hi {{tenant_name}},\n\nOur records show rent for {{period_label}} is still outstanding.\n\nAmount due: {{amount_due}}\nAmount received: {{amount_paid}}\nOutstanding: {{amount_outstanding}}\n\nPlease submit payment as soon as possible.\n\nThank you.'),
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO UPDATE SET
        enabled = COALESCE(excluded.enabled, enabled),
        days_late_threshold = COALESCE(excluded.days_late_threshold, days_late_threshold),
        subject_template = COALESCE(excluded.subject_template, subject_template),
        body_template = COALESCE(excluded.body_template, body_template),
        updated_at = CURRENT_TIMESTAMP
    `).run(pEnabled, pDays, subjectTemplate ?? null, bodyTemplate ?? null);
  }

  res.json({ success: true });
});

// POST /api/portfolio/rent-reminders/run
router.post('/rent-reminders/run', (req: Request, res: Response) => {
  const db = getDb();
  const result = runRentReminderSweepCore(db);
  res.json(result);
});

// GET /api/portfolio/rent-reminders/runs
router.get('/rent-reminders/runs', async (req: Request, res: Response) => {
  const runs = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `SELECT id, run_at, checked_count, alert_count, skipped_count, notes
         FROM rent_reminder_runs
         ORDER BY run_at DESC
         LIMIT 25`
      );
      return result.rows;
    })
    : getDb().prepare(`
      SELECT id, run_at, checked_count, alert_count, skipped_count, notes
      FROM rent_reminder_runs
      ORDER BY run_at DESC
      LIMIT 25
    `).all();
  res.json(runs);
});

// GET /api/portfolio/rent-roll/variance?month=YYYY-MM
router.get('/rent-roll/variance', async (req: Request, res: Response) => {
  const month = String(req.query.month || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: 'month must be YYYY-MM' });
    return;
  }
  const from = `${month}-01`;
  const to = `${month}-31`;
  const sql = `
    SELECT
      t.id as tenant_id,
      t.name as tenant_name,
      bu.unit_number,
      t.monthly_rent as expected_rent,
      COALESCE(SUM(CASE WHEN tle.entry_type IN ('payment', 'credit') THEN tle.amount ELSE 0 END), 0) as paid_or_credited,
      COALESCE(SUM(CASE WHEN tle.entry_type IN ('charge', 'fee') THEN tle.amount ELSE 0 END), 0) as charges
    FROM tenants t
    JOIN portfolio_units pu ON pu.id = t.portfolio_unit_id
    JOIN building_units bu ON bu.id = pu.building_unit_id
    LEFT JOIN tenant_ledger_entries tle
      ON tle.tenant_id = t.id
      AND tle.entry_date >= ?
      AND tle.entry_date <= ?
    WHERE t.status IN ('active', 'month_to_month')
    GROUP BY t.id, t.name, bu.unit_number, t.monthly_rent
    ORDER BY bu.unit_number, t.name
  `;
  const pgSql = `
    SELECT
      t.id as tenant_id,
      t.name as tenant_name,
      bu.unit_number,
      t.monthly_rent as expected_rent,
      COALESCE(SUM(CASE WHEN tle.entry_type IN ('payment', 'credit') THEN tle.amount ELSE 0 END), 0) as paid_or_credited,
      COALESCE(SUM(CASE WHEN tle.entry_type IN ('charge', 'fee') THEN tle.amount ELSE 0 END), 0) as charges
    FROM tenants t
    JOIN portfolio_units pu ON pu.id = t.portfolio_unit_id
    JOIN building_units bu ON bu.id = pu.building_unit_id
    LEFT JOIN tenant_ledger_entries tle
      ON tle.tenant_id = t.id
      AND tle.entry_date >= $1
      AND tle.entry_date <= $2
    WHERE t.status IN ('active', 'month_to_month')
    GROUP BY t.id, t.name, bu.unit_number, t.monthly_rent
    ORDER BY bu.unit_number, t.name
  `;
  const rows = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(pgSql, [from, to]);
      return result.rows as any[];
    })
    : (getDb().prepare(sql).all(from, to) as any[]);

  const enriched = rows.map((r) => {
    const expected = Number(r.expected_rent || 0);
    const paid = Number(r.paid_or_credited || 0);
    const due = expected - paid;
    const agingBucket = due <= 0 ? 'current' : due <= expected * 0.5 ? '1-30' : due <= expected ? '31-60' : '60+';
    return { ...r, due, aging_bucket: agingBucket };
  });
  res.json({ month, rows: enriched });
});

// Tenant ledger
router.get('/tenants/:tenantId/ledger', async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  if (!tenantId) {
    res.status(400).json({ error: 'Invalid tenantId' });
    return;
  }
  const rows = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `SELECT *
         FROM tenant_ledger_entries
         WHERE tenant_id = $1
         ORDER BY entry_date DESC, id DESC`,
        [tenantId]
      );
      return result.rows;
    })
    : getDb().prepare(`
      SELECT *
      FROM tenant_ledger_entries
      WHERE tenant_id = ?
      ORDER BY entry_date DESC, id DESC
    `).all(tenantId);
  res.json(rows);
});

router.post('/tenants/:tenantId/ledger', async (req: Request, res: Response) => {
  const tenantId = Number(req.params.tenantId);
  const entryDate = String(req.body?.entryDate || '').trim();
  const entryType = String(req.body?.entryType || '').trim();
  const amount = Number(req.body?.amount);
  const description = String(req.body?.description || '').trim();
  if (!tenantId || !entryDate || !entryType || !Number.isFinite(amount)) {
    res.status(400).json({ error: 'tenantId, entryDate, entryType, amount are required' });
    return;
  }
  const insertedId = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO tenant_ledger_entries (tenant_id, entry_date, entry_type, amount, description, source_type, source_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [tenantId, entryDate, entryType, amount, description || null, req.body?.sourceType || null, req.body?.sourceId || null]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(`
        INSERT INTO tenant_ledger_entries (tenant_id, entry_date, entry_type, amount, description, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(tenantId, entryDate, entryType, amount, description || null, req.body?.sourceType || null, req.body?.sourceId || null).lastInsertRowid
    );
  res.status(201).json({ id: insertedId });
});

// Reserve and special assessments
router.get('/reserve-activities', async (req: Request, res: Response) => {
  const rows = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(`
        SELECT rfa.*, e.name as entity_name, bu.unit_number
        FROM reserve_fund_activities rfa
        LEFT JOIN entities e ON e.id = rfa.entity_id
        LEFT JOIN portfolio_units pu ON pu.id = rfa.portfolio_unit_id
        LEFT JOIN building_units bu ON bu.id = pu.building_unit_id
        ORDER BY rfa.activity_date DESC, rfa.id DESC
      `);
      return result.rows;
    })
    : getDb().prepare(`
      SELECT rfa.*, e.name as entity_name, bu.unit_number
      FROM reserve_fund_activities rfa
      LEFT JOIN entities e ON e.id = rfa.entity_id
      LEFT JOIN portfolio_units pu ON pu.id = rfa.portfolio_unit_id
      LEFT JOIN building_units bu ON bu.id = pu.building_unit_id
      ORDER BY rfa.activity_date DESC, rfa.id DESC
    `).all();
  res.json(rows);
});

router.post('/reserve-activities', async (req: Request, res: Response) => {
  const activityDate = String(req.body?.activityDate || '').trim();
  const activityType = String(req.body?.activityType || '').trim();
  const amount = Number(req.body?.amount);
  if (!activityDate || !activityType || !Number.isFinite(amount)) {
    res.status(400).json({ error: 'activityDate, activityType, amount are required' });
    return;
  }
  const insertedId = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO reserve_fund_activities (activity_date, activity_type, amount, entity_id, portfolio_unit_id, description)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [activityDate, activityType, amount, req.body?.entityId || null, req.body?.portfolioUnitId || null, req.body?.description || null]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(`
        INSERT INTO reserve_fund_activities (activity_date, activity_type, amount, entity_id, portfolio_unit_id, description)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        activityDate,
        activityType,
        amount,
        req.body?.entityId || null,
        req.body?.portfolioUnitId || null,
        req.body?.description || null
      ).lastInsertRowid
    );
  res.status(201).json({ id: insertedId });
});

// Violations + fines ledger
router.get('/violations', async (req: Request, res: Response) => {
  const rows = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(`
        SELECT v.*, bu.unit_number, t.name as tenant_name
        FROM violation_entries v
        LEFT JOIN portfolio_units pu ON pu.id = v.portfolio_unit_id
        LEFT JOIN building_units bu ON bu.id = pu.building_unit_id
        LEFT JOIN tenants t ON t.id = v.tenant_id
        ORDER BY v.opened_at DESC, v.id DESC
      `);
      return result.rows;
    })
    : getDb().prepare(`
      SELECT v.*, bu.unit_number, t.name as tenant_name
      FROM violation_entries v
      LEFT JOIN portfolio_units pu ON pu.id = v.portfolio_unit_id
      LEFT JOIN building_units bu ON bu.id = pu.building_unit_id
      LEFT JOIN tenants t ON t.id = v.tenant_id
      ORDER BY v.opened_at DESC, v.id DESC
    `).all();
  res.json(rows);
});

router.post('/violations', async (req: Request, res: Response) => {
  const violationType = String(req.body?.violationType || '').trim();
  const openedAt = String(req.body?.openedAt || '').trim();
  if (!violationType || !openedAt) {
    res.status(400).json({ error: 'violationType and openedAt are required' });
    return;
  }
  const insertedId = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `INSERT INTO violation_entries (
           portfolio_unit_id, tenant_id, violation_type, opened_at, resolved_at, fine_amount, status, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          req.body?.portfolioUnitId || null,
          req.body?.tenantId || null,
          violationType,
          openedAt,
          req.body?.resolvedAt || null,
          Number(req.body?.fineAmount || 0),
          req.body?.status || 'open',
          req.body?.notes || null,
        ]
      );
      return Number(result.rows[0]?.id || 0);
    })
    : Number(
      getDb().prepare(`
        INSERT INTO violation_entries (
          portfolio_unit_id, tenant_id, violation_type, opened_at, resolved_at, fine_amount, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.body?.portfolioUnitId || null,
        req.body?.tenantId || null,
        violationType,
        openedAt,
        req.body?.resolvedAt || null,
        Number(req.body?.fineAmount || 0),
        req.body?.status || 'open',
        req.body?.notes || null
      ).lastInsertRowid
    );
  res.status(201).json({ id: insertedId });
});

router.get('/leases/expiring', async (req: Request, res: Response) => {
  const withinDays = Math.max(1, Number(req.query.withinDays || 60));
  const rows = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(
        `SELECT
           t.id as tenant_id,
           t.name as tenant_name,
           t.lease_end,
           bu.unit_number,
           CAST((DATE_PART('day', t.lease_end::timestamp - NOW())) AS INTEGER) as days_to_expiry
         FROM tenants t
         JOIN portfolio_units pu ON pu.id = t.portfolio_unit_id
         JOIN building_units bu ON bu.id = pu.building_unit_id
         WHERE t.lease_end IS NOT NULL
           AND t.lease_end::date <= (CURRENT_DATE + ($1::int || ' days')::interval)::date
           AND t.status IN ('active', 'month_to_month')
         ORDER BY t.lease_end ASC`,
        [withinDays]
      );
      return result.rows;
    })
    : getDb().prepare(`
      SELECT
        t.id as tenant_id,
        t.name as tenant_name,
        t.lease_end,
        bu.unit_number,
        CAST((julianday(t.lease_end) - julianday(date('now'))) AS INTEGER) as days_to_expiry
      FROM tenants t
      JOIN portfolio_units pu ON pu.id = t.portfolio_unit_id
      JOIN building_units bu ON bu.id = pu.building_unit_id
      WHERE t.lease_end IS NOT NULL
        AND date(t.lease_end) <= date('now', '+' || ? || ' days')
        AND t.status IN ('active', 'month_to_month')
      ORDER BY t.lease_end ASC
    `).all(withinDays);
  res.json({ withinDays, rows });
});

router.post('/leases/alerts/run', async (req: Request, res: Response) => {
  const today = new Date();
  const rows = usePostgresPortfolio()
    ? await withPostgresClient(async (client) => {
      const result = await client.query(`
        SELECT id, lease_end
        FROM tenants
        WHERE lease_end IS NOT NULL
          AND status IN ('active', 'month_to_month')
      `);
      return result.rows as Array<{ id: number; lease_end: string }>;
    })
    : (getDb().prepare(`
      SELECT id, lease_end
      FROM tenants
      WHERE lease_end IS NOT NULL
        AND status IN ('active', 'month_to_month')
    `).all() as Array<{ id: number; lease_end: string }>);
  let created = 0;
  for (const r of rows) {
    const leaseEnd = new Date(r.lease_end);
    if (Number.isNaN(leaseEnd.getTime())) continue;
    const diffDays = Math.floor((leaseEnd.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    const alertType = diffDays <= 0 ? 'expired' : diffDays <= 30 ? '30_day' : diffDays <= 60 ? '60_day' : null;
    if (!alertType) continue;
    const exists = usePostgresPortfolio()
      ? await withPostgresClient(async (client) => {
        const result = await client.query(
          `SELECT id
           FROM lease_renewal_alerts
           WHERE tenant_id = $1 AND lease_end = $2 AND alert_type = $3
           LIMIT 1`,
          [r.id, r.lease_end, alertType]
        );
        return result.rows[0] || null;
      })
      : getDb().prepare(`
        SELECT id
        FROM lease_renewal_alerts
        WHERE tenant_id = ? AND lease_end = ? AND alert_type = ?
        LIMIT 1
      `).get(r.id, r.lease_end, alertType);
    if (exists) continue;
    if (usePostgresPortfolio()) {
      await withPostgresClient(async (client) => {
        await client.query(
          `INSERT INTO lease_renewal_alerts (tenant_id, lease_end, alert_type, status)
           VALUES ($1, $2, $3, 'draft')`,
          [r.id, r.lease_end, alertType]
        );
      });
    } else {
      getDb().prepare(`
        INSERT INTO lease_renewal_alerts (tenant_id, lease_end, alert_type, status)
        VALUES (?, ?, ?, 'draft')
      `).run(r.id, r.lease_end, alertType);
    }
    created += 1;
  }
  res.json({ success: true, created });
});

export default router;
export { runRentReminderSweepCore };
