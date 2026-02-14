/**
 * Portfolio management routes.
 * CRUD for fund-owned units, entities, tenants, renovations, documents, communications.
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP } from '../middleware/auth';
import { sendTransactionalEmail } from '../lib/email';

const router = Router();

// All portfolio routes require GP auth
router.use(requireAuth, requireGP);

function syncFundOwnedContractFields(db: ReturnType<typeof getDb>, portfolioUnitId: number) {
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
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const units = db.prepare(`
    SELECT
      pu.*,
      bu.floor, bu.unit_number, bu.unit_letter,
      ut.beds, ut.sqft, ut.ownership_pct,
      e.name as entity_name,
      t.name as tenant_name, t.status as tenant_status, t.monthly_rent as tenant_rent,
      t.lease_start, t.lease_end, t.email as tenant_email, t.phone as tenant_phone
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    JOIN unit_types ut ON bu.unit_type_id = ut.id
    LEFT JOIN entities e ON pu.entity_id = e.id
    LEFT JOIN tenants t ON t.portfolio_unit_id = pu.id AND t.status IN ('active', 'month_to_month')
    ORDER BY bu.floor, bu.unit_letter
  `).all();

  res.json(units);
});

// GET /api/portfolio/summary - Aggregate stats
router.get('/summary', (req: Request, res: Response) => {
  const db = getDb();
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_units_owned,
      SUM(ut.ownership_pct) as total_ownership_pct,
      SUM(pu.total_acquisition_cost) as total_invested,
      SUM(pu.monthly_rent) as total_monthly_rent,
      SUM(pu.monthly_hoa) as total_monthly_hoa,
      SUM(pu.monthly_rent - pu.monthly_hoa - (pu.monthly_insurance / 12.0) - (pu.monthly_tax / 12.0)) as total_monthly_noi,
      SUM(ut.sqft) as total_sqft
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    JOIN unit_types ut ON bu.unit_type_id = ut.id
  `).get() as any;

  const renoSpend = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(actual_cost, estimated_cost)), 0) as total
    FROM unit_renovations
  `).get() as any;

  const tenantStats = db.prepare(`
    SELECT
      COUNT(CASE WHEN t.status IN ('active', 'month_to_month') THEN 1 END) as active_tenants,
      COUNT(DISTINCT pu.id) - COUNT(CASE WHEN t.status IN ('active', 'month_to_month') THEN 1 END) as vacant_units
    FROM portfolio_units pu
    LEFT JOIN tenants t ON t.portfolio_unit_id = pu.id AND t.status IN ('active', 'month_to_month')
  `).get() as any;

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
router.post('/units', (req: Request, res: Response) => {
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
  const unit = db.prepare(`
    SELECT ut.sqft, ut.base_hoa FROM building_units bu
    JOIN unit_types ut ON bu.unit_type_id = ut.id
    WHERE bu.id = ?
  `).get(buildingUnitId) as any;

  if (!unit) {
    res.status(404).json({ error: 'Building unit not found' });
    return;
  }

  const pricePSF = unit.sqft > 0 ? purchasePrice / unit.sqft : 0;
  const totalAcquisitionCost = purchasePrice + closingCosts + transferTax + inspectionCost;

  const result = db.prepare(`
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
  );

  // Mark building unit as fund-owned and force signed investment posture in contracts view
  syncFundOwnedContractFields(db, Number(result.lastInsertRowid));

  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/portfolio/units/:id - Update unit
router.put('/units/:id', (req: Request, res: Response) => {
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
  db.prepare(`UPDATE portfolio_units SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  syncFundOwnedContractFields(db, Number(id));
  res.json({ success: true });
});

// DELETE /api/portfolio/units/:id - Remove unit
router.delete('/units/:id', (req: Request, res: Response) => {
  const db = getDb();
  const unitId = Number(req.params.id);

  const unit = db.prepare(`
    SELECT id, building_unit_id FROM portfolio_units WHERE id = ?
  `).get(unitId) as any;

  if (!unit) {
    res.status(404).json({ error: 'Portfolio unit not found' });
    return;
  }

  const tenantRows = db.prepare('SELECT id FROM tenants WHERE portfolio_unit_id = ?').all(unitId) as Array<{ id: number }>;
  const tenantIds = tenantRows.map((r) => r.id);
  const renoRows = db.prepare('SELECT id FROM unit_renovations WHERE portfolio_unit_id = ?').all(unitId) as Array<{ id: number }>;
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
    delTx();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to delete portfolio unit' });
  }
});

// --- Tenants ---

// GET /api/portfolio/units/:id/tenants
router.get('/units/:id/tenants', (req: Request, res: Response) => {
  const db = getDb();
  const tenants = db.prepare(
    'SELECT * FROM tenants WHERE portfolio_unit_id = ? ORDER BY lease_start DESC'
  ).all(req.params.id);
  res.json(tenants);
});

// POST /api/portfolio/units/:id/tenants
router.post('/units/:id/tenants', (req: Request, res: Response) => {
  const db = getDb();
  const { name, email, phone, leaseStart, leaseEnd, monthlyRent, securityDeposit = 0, notes, rentDueDay = 1 } = req.body;

  const result = db.prepare(`
    INSERT INTO tenants (portfolio_unit_id, name, email, phone, lease_start, lease_end, rent_due_day, monthly_rent, security_deposit, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
  `).run(req.params.id, name, email, phone, leaseStart, leaseEnd, clampDay(Number(rentDueDay || 1)), monthlyRent, securityDeposit, notes);

  syncFundOwnedContractFields(db, Number(req.params.id));
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/portfolio/tenants/:id  (FIXED: was /../tenants/:id)
router.put('/tenants/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const { name, email, phone, leaseStart, leaseEnd, rentDueDay, monthlyRent, securityDeposit, status, notes } = req.body;
  const tenantRow = db.prepare('SELECT portfolio_unit_id FROM tenants WHERE id = ?').get(id) as any;

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

  if (tenantRow?.portfolio_unit_id) {
    syncFundOwnedContractFields(db, Number(tenantRow.portfolio_unit_id));
  }
  res.json({ success: true });
});

// DELETE /api/portfolio/tenants/:id
router.delete('/tenants/:id', (req: Request, res: Response) => {
  const db = getDb();
  const tenantRow = db.prepare('SELECT portfolio_unit_id FROM tenants WHERE id = ?').get(req.params.id) as any;
  db.prepare('DELETE FROM tenants WHERE id = ?').run(req.params.id);
  if (tenantRow?.portfolio_unit_id) {
    syncFundOwnedContractFields(db, Number(tenantRow.portfolio_unit_id));
  }
  res.json({ success: true });
});

// --- Renovations ---

// GET /api/portfolio/units/:id/renovations
router.get('/units/:id/renovations', (req: Request, res: Response) => {
  const db = getDb();
  const renos = db.prepare(
    'SELECT * FROM unit_renovations WHERE portfolio_unit_id = ? ORDER BY start_date DESC'
  ).all(req.params.id);
  res.json(renos);
});

// POST /api/portfolio/units/:id/renovations
router.post('/units/:id/renovations', (req: Request, res: Response) => {
  const db = getDb();
  const {
    description, estimatedCost = 0, contractor, startDate, endDate, notes,
    expenseSource = 'bank', reconcileRef = null, reconciled = 0,
  } = req.body;

  const result = db.prepare(`
    INSERT INTO unit_renovations (
      portfolio_unit_id, description, status, estimated_cost, expense_source, reconcile_ref, reconciled,
      contractor, start_date, end_date, notes
    )
    VALUES (?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, description, estimatedCost, expenseSource, reconcileRef, reconciled ? 1 : 0, contractor, startDate, endDate, notes);

  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/portfolio/renovations/:id
router.put('/renovations/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { id } = req.params;
  const {
    description, status, estimatedCost, actualCost, contractor, startDate, endDate, notes,
    expenseSource, reconcileRef, reconciled,
  } = req.body;

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

  res.json({ success: true });
});

// DELETE /api/portfolio/renovations/:id
router.delete('/renovations/:id', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM unit_renovations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- Documents ---

// GET /api/portfolio/units/:id/documents
router.get('/units/:id/documents', (req: Request, res: Response) => {
  const db = getDb();
  const docs = db.prepare(
    "SELECT * FROM documents WHERE parent_type = 'unit' AND parent_id = ? ORDER BY uploaded_at DESC"
  ).all(req.params.id);
  res.json(docs);
});

// --- Tenant Communications ---

// GET /api/portfolio/tenants/:tenantId/communications
router.get('/tenants/:tenantId/communications', (req: Request, res: Response) => {
  const db = getDb();
  const comms = db.prepare(
    'SELECT * FROM tenant_communications WHERE tenant_id = ? ORDER BY sent_at DESC'
  ).all(req.params.tenantId);
  res.json(comms);
});

// POST /api/portfolio/tenants/:tenantId/communications
router.post('/tenants/:tenantId/communications', (req: Request, res: Response) => {
  const db = getDb();
  const { type = 'email', subject, body, templateName } = req.body;

  const result = db.prepare(`
    INSERT INTO tenant_communications (tenant_id, type, subject, body, status, template_name)
    VALUES (?, ?, ?, ?, 'draft', ?)
  `).run(req.params.tenantId, type, subject, body, templateName);

  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/portfolio/communications/:id/send — mark as sent
router.put('/communications/:id/send', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare(`
    UPDATE tenant_communications SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(req.params.id);
  res.json({ success: true });
});

// GET /api/portfolio/rent-reminder-settings
router.get('/rent-reminder-settings', (req: Request, res: Response) => {
  const db = getDb();
  const settings = db.prepare(`
    SELECT enabled, days_late_threshold, subject_template, body_template, updated_at
    FROM rent_reminder_settings
    WHERE id = 1
  `).get() as any;
  res.json(settings || {
    enabled: 1,
    days_late_threshold: 5,
    subject_template: 'Rent Reminder: {{unit_number}} is {{days_late}} day(s) past due',
    body_template: 'Hi {{tenant_name}},\n\nOur records show rent for {{period_label}} is still outstanding.\n\nAmount due: {{amount_due}}\nAmount received: {{amount_paid}}\nOutstanding: {{amount_outstanding}}\n\nPlease submit payment as soon as possible.\n\nThank you.',
    updated_at: null,
  });
});

// PUT /api/portfolio/rent-reminder-settings
router.put('/rent-reminder-settings', (req: Request, res: Response) => {
  const db = getDb();
  const {
    enabled,
    daysLateThreshold,
    subjectTemplate,
    bodyTemplate,
  } = req.body || {};

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
  `).run(
    enabled === undefined ? null : (enabled ? 1 : 0),
    daysLateThreshold === undefined ? null : Math.max(0, Math.round(Number(daysLateThreshold))),
    subjectTemplate ?? null,
    bodyTemplate ?? null,
  );

  res.json({ success: true });
});

// POST /api/portfolio/rent-reminders/run
router.post('/rent-reminders/run', (req: Request, res: Response) => {
  const db = getDb();
  const result = runRentReminderSweepCore(db);
  res.json(result);
});

// GET /api/portfolio/rent-reminders/runs
router.get('/rent-reminders/runs', (req: Request, res: Response) => {
  const db = getDb();
  const runs = db.prepare(`
    SELECT id, run_at, checked_count, alert_count, skipped_count, notes
    FROM rent_reminder_runs
    ORDER BY run_at DESC
    LIMIT 25
  `).all();
  res.json(runs);
});

export default router;
export { runRentReminderSweepCore };
