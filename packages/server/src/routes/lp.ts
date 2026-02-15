/**
 * LP Portal routes (read-only for LP users).
 * Also investor onboarding and capital call management (GP only).
 */

import { Router, Request, Response } from 'express';
import { getDb } from '../db/database';
import { requireAuth, requireGP, requireAnyRole } from '../middleware/auth';
import {
  projectCashFlows,
  generateDefaultAcquisitionSchedule,
  calcMOIC,
  xirr,
} from '@brickell/engine';
import type { FundAssumptions } from '@brickell/shared';
import type { AcquisitionSchedule } from '@brickell/engine';
import { sendTransactionalEmail } from '../lib/email';

const router = Router();

function recalcCalledCapitalForLp(db: ReturnType<typeof getDb>, lpAccountId: number) {
  db.prepare(`
    UPDATE lp_accounts
    SET called_capital = COALESCE((
      SELECT SUM(cci.amount)
      FROM capital_call_items cci
      JOIN capital_calls cc ON cc.id = cci.capital_call_id
      WHERE cci.lp_account_id = lp_accounts.id
        AND cc.status IN ('draft', 'sent', 'partially_received', 'completed')
    ), 0)
    WHERE id = ?
  `).run(lpAccountId);
}

function rowToAssumptions(row: any): FundAssumptions {
  return {
    id: row.id,
    name: row.name,
    isActive: !!row.is_active,
    fundSize: row.fund_size,
    fundTermYears: row.fund_term_years,
    investmentPeriodYears: row.investment_period_years,
    gpCoinvestPct: row.gp_coinvest_pct,
    mgmtFeeInvestPct: row.mgmt_fee_invest_pct,
    mgmtFeePostPct: row.mgmt_fee_post_pct,
    mgmtFeeWaiver: !!row.mgmt_fee_waiver,
    prefReturnPct: row.pref_return_pct,
    catchupPct: row.catchup_pct,
    tier1SplitLP: row.tier1_split_lp,
    tier1SplitGP: row.tier1_split_gp,
    tier2HurdleIRR: row.tier2_hurdle_irr,
    tier2SplitLP: row.tier2_split_lp,
    tier2SplitGP: row.tier2_split_gp,
    tier3HurdleIRR: row.tier3_hurdle_irr,
    tier3SplitLP: row.tier3_split_lp,
    tier3SplitGP: row.tier3_split_gp,
    refiEnabled: !!row.refi_enabled,
    refiYear: row.refi_year,
    refiLTV: row.refi_ltv,
    refiRate: row.refi_rate,
    refiTermYears: row.refi_term_years,
    refiCostPct: row.refi_cost_pct,
    rentGrowthPct: row.rent_growth_pct,
    hoaGrowthPct: row.hoa_growth_pct,
    taxGrowthPct: row.tax_growth_pct ?? row.hoa_growth_pct,
    vacancyPct: row.vacancy_pct,
    annualFundOpexMode: row.annual_fund_opex_mode === 'threshold_pct' ? 'threshold_pct' : 'fixed',
    annualFundOpexFixed: Number(row.annual_fund_opex_fixed ?? 75_000),
    annualFundOpexThresholdPct: Number(row.annual_fund_opex_threshold_pct ?? 0.02),
    annualFundOpexAdjustPct: Number(row.annual_fund_opex_adjust_pct ?? 0),
    presentDayLandValue: row.present_day_land_value ?? row.land_value_total,
    landValueTotal: row.land_value_total,
    landGrowthPct: row.land_growth_pct,
    landPSF: row.land_psf,
    mmRate: row.mm_rate,
    excessCashMode: row.excess_cash_mode,
    buildingValuation: row.building_valuation,
    bonusIRRThreshold: row.bonus_irr_threshold,
    bonusMaxYears: row.bonus_max_years,
    bonusYieldThreshold: row.bonus_yield_threshold,
    createdAt: row.created_at,
  };
}

function getPortfolioData(db: ReturnType<typeof getDb>) {
  const units = db.prepare(`
    SELECT
      pu.purchase_date,
      pu.purchase_price,
      pu.total_acquisition_cost,
      COALESCE(pu.monthly_rent, 0) as monthly_rent,
      COALESCE(pu.monthly_hoa, 0) as monthly_hoa,
      COALESCE(pu.monthly_insurance, 0) as annual_insurance,
      COALESCE(pu.monthly_tax, 0) as annual_tax
    FROM portfolio_units pu
    ORDER BY pu.purchase_date
  `).all() as any[];

  const ownershipRow = db.prepare(`
    SELECT COALESCE(SUM(ut.ownership_pct), 0) as total_ownership_pct
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    JOIN unit_types ut ON bu.unit_type_id = ut.id
  `).get() as any;

  if (units.length === 0) return null;

  const totalRent = units.reduce((s: number, u: any) => s + u.monthly_rent, 0);
  const totalHOA = units.reduce((s: number, u: any) => s + u.monthly_hoa, 0);
  const totalAnnualInsurance = units.reduce((s: number, u: any) => s + u.annual_insurance, 0);
  const totalAnnualTax = units.reduce((s: number, u: any) => s + u.annual_tax, 0);
  const count = units.length;

  const acqMap = new Map<number, { units: number; totalCost: number }>();
  for (const u of units) {
    const d = new Date(u.purchase_date);
    const yearOff = d.getFullYear() - 2026;
    const qIdx = yearOff * 4 + Math.floor(d.getMonth() / 3);
    const quarter = Math.max(0, qIdx);
    const existing = acqMap.get(quarter) || { units: 0, totalCost: 0 };
    existing.units += 1;
    existing.totalCost += u.total_acquisition_cost || u.purchase_price || 500_000;
    acqMap.set(quarter, existing);
  }

  const acquisitions: AcquisitionSchedule[] = [];
  for (const [quarter, data] of acqMap) {
    acquisitions.push({
      quarter,
      units: data.units,
      costPerUnit: data.totalCost / data.units,
    });
  }

  return {
    acquisitions,
    avgRent: totalRent / count,
    avgHOA: totalHOA / count,
    avgAnnualInsurance: totalAnnualInsurance / count,
    avgAnnualTax: totalAnnualTax / count,
    annualFundOpex: 75_000,
    totalOwnershipPct: ownershipRow.total_ownership_pct > 0 ? ownershipRow.total_ownership_pct / 100 : undefined,
  };
}

function fmtMoney(value: number) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function renderMergeTemplate(tpl: string, vars: Record<string, string>) {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), v);
  }
  return out;
}

// ---- LP Read-Only Routes ----

// GET /api/lp/account - My capital account
router.get('/account', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare(`
    SELECT
      lpa.*,
      COALESCE((
        SELECT SUM(cci.amount)
        FROM capital_call_items cci
        JOIN capital_calls cc ON cc.id = cci.capital_call_id
        WHERE cci.lp_account_id = lpa.id
          AND cc.status IN ('draft', 'sent', 'partially_received', 'completed')
      ), 0) as called_capital
    FROM lp_accounts lpa
    WHERE lpa.user_id = ?
  `).get(req.user!.userId) as any;

  if (!account) {
    res.status(404).json({ error: 'No LP account found for this user' });
    return;
  }

  res.json(account);
});

// GET /api/lp/transactions - My capital calls + distributions
router.get('/transactions', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }

  const transactions = db.prepare(`
    SELECT * FROM capital_transactions
    WHERE lp_account_id = ?
    ORDER BY date DESC
  `).all(account.id);
  res.json(transactions);
});

// GET /api/lp/capital-calls - My pending/historical calls
router.get('/capital-calls', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }

  const calls = db.prepare(`
    SELECT cci.*, cc.call_number, cc.call_date, cc.due_date, cc.purpose, cc.status as call_status
    FROM capital_call_items cci
    JOIN capital_calls cc ON cci.capital_call_id = cc.id
    WHERE cci.lp_account_id = ?
    ORDER BY cc.call_date DESC
  `).all(account.id);
  res.json(calls);
});

// GET /api/lp/documents - My documents
router.get('/documents', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  const db = getDb();
  const account = db.prepare('SELECT id FROM lp_accounts WHERE user_id = ?').get(req.user!.userId) as any;
  if (!account) {
    res.status(404).json({ error: 'No LP account found' });
    return;
  }

  const docs = db.prepare(`
    SELECT * FROM documents
    WHERE (parent_type = 'lp' AND parent_id = ?) OR parent_type = 'fund'
    ORDER BY uploaded_at DESC
  `).all(account.id);
  res.json(docs);
});

// GET /api/lp/performance - Fund performance
router.get('/performance', requireAuth, requireAnyRole, (req: Request, res: Response) => {
  // Return high-level fund metrics (no GP-specific detail)
  const db = getDb();
  const portfolio = db.prepare(`
    SELECT
      COUNT(*) as units,
      COALESCE(SUM(ut.ownership_pct), 0) as ownership_pct,
      COALESCE(SUM(pu.total_acquisition_cost), 0) as total_invested,
      COALESCE(SUM((pu.monthly_rent * 12) - (pu.monthly_hoa * 12) - pu.monthly_insurance - pu.monthly_tax), 0) as annual_noi
    FROM portfolio_units pu
    JOIN building_units bu ON pu.building_unit_id = bu.id
    JOIN unit_types ut ON bu.unit_type_id = ut.id
  `).get() as any;

  let fundMOIC = 0;
  let fundIRR = 0;
  let projectedNetProfit = 0;
  let projectedExitEquity = 0;

  const assumptionRow = db.prepare(`
    SELECT *
    FROM fund_assumptions
    ORDER BY is_active DESC, id ASC
    LIMIT 1
  `).get() as any;

  if (assumptionRow) {
    const assumptions = rowToAssumptions(assumptionRow);
    const portfolioData = getPortfolioData(db);

    const cfInput = portfolioData ? {
      assumptions,
      acquisitions: portfolioData.acquisitions,
      baseMonthlyRent: portfolioData.avgRent,
      baseMonthlyHOA: portfolioData.avgHOA,
      baseAnnualInsurance: portfolioData.avgAnnualInsurance,
      baseAnnualTax: portfolioData.avgAnnualTax,
      annualFundOpex: portfolioData.annualFundOpex,
      totalOwnershipPct: portfolioData.totalOwnershipPct,
    } : {
      assumptions,
      acquisitions: generateDefaultAcquisitionSchedule(assumptions),
      baseMonthlyRent: 2800,
      baseMonthlyHOA: 1400,
      baseAnnualInsurance: 2400,
      baseAnnualTax: 2400,
      annualFundOpex: 75_000,
    };

    const cashFlows = projectCashFlows(cfInput);
    if (cashFlows.length > 0) {
      const totalCapitalDeployed = cashFlows.reduce((s, cf) => s + (cf.capitalCalls || 0), 0);
      const totalNOI = cashFlows.reduce((s, cf) => s + (cf.netOperatingIncome || 0), 0);
      const exitCF = cashFlows[cashFlows.length - 1];
      const totalDistributions = (exitCF.grossSaleProceeds || 0) + (exitCF.mmLiquidation || 0);

      projectedExitEquity = totalDistributions;
      projectedNetProfit = totalDistributions + totalNOI - totalCapitalDeployed;
      fundMOIC = calcMOIC(totalDistributions + totalNOI, totalCapitalDeployed);

      const xirrFlows = cashFlows
        .filter((cf) => Math.abs(cf.netCashFlow || 0) > 0.0001)
        .map((cf) => ({ date: new Date(cf.date), amount: cf.netCashFlow }));

      try {
        fundIRR = xirr(xirrFlows);
      } catch {
        fundIRR = 0;
      }
    }
  }

  res.json({
    unitsOwned: portfolio.units || 0,
    ownershipPct: portfolio.ownership_pct || 0,
    totalInvested: portfolio.total_invested || 0,
    annualNOI: portfolio.annual_noi || 0,
    fundMOIC,
    fundIRR,
    projectedNetProfit,
    projectedExitEquity,
  });
});

// ---- GP-Only: Investor Management ----

// POST /api/lp/investors - Onboard new investor (GP only)
router.post('/investors', requireAuth, requireGP, async (req: Request, res: Response) => {
  const db = getDb();
  const { name, entityName, email, phone, commitment, notes } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();

  // Create user account for LP
  const bcrypt = require('bcryptjs');
  const tempPassword = Math.random().toString(36).slice(2, 10);
  const hash = bcrypt.hashSync(tempPassword, 10);

  const userResult = db.prepare(
    'INSERT INTO users (email, password_hash, role, name, must_change_password) VALUES (?, ?, ?, ?, 1)'
  ).run(normalizedEmail, hash, 'lp', name);

  // Calculate ownership pct
  const totalCommitment = (db.prepare(
    'SELECT COALESCE(SUM(commitment), 0) as total FROM lp_accounts'
  ).get() as any).total + commitment;
  const ownershipPct = commitment / totalCommitment;

  // Create LP account
  const lpResult = db.prepare(`
    INSERT INTO lp_accounts (user_id, name, entity_name, email, phone, commitment, ownership_pct, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(userResult.lastInsertRowid, name, entityName, email, phone, commitment, ownershipPct, notes);

  // Recalculate all LP ownership percentages
  db.prepare(`
    UPDATE lp_accounts SET ownership_pct = commitment / (SELECT SUM(commitment) FROM lp_accounts)
  `).run();

  let emailSent = false;
  if (normalizedEmail) {
    const fundName = String(process.env.FUND_NAME || '305 opportunites fund');
    emailSent = await sendTransactionalEmail({
      to: normalizedEmail,
      subject: `Your ${fundName} investor portal account`,
      text:
        `Hi ${name || 'Investor'},\n\n` +
        `Your investor portal account has been created.\n\n` +
        `Email: ${normalizedEmail}\n` +
        `Temporary password: ${tempPassword}\n\n` +
        `Please log in and change your password immediately. You will be prompted to change it on first login.\n\n` +
        `If you were not expecting this email, please contact support.`,
    });
  }

  res.status(201).json({
    id: lpResult.lastInsertRowid,
    userId: userResult.lastInsertRowid,
    tempPassword, // Return so GP can share with LP
    emailSent,
  });
});

// GET /api/lp/investors - List all investors (GP only)
router.get('/investors', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const investors = db.prepare(`
    SELECT
      lpa.*,
      COALESCE((
        SELECT SUM(cci.amount)
        FROM capital_call_items cci
        JOIN capital_calls cc ON cc.id = cci.capital_call_id
        WHERE cci.lp_account_id = lpa.id
          AND cc.status IN ('draft', 'sent', 'partially_received', 'completed')
      ), 0) as called_capital
    FROM lp_accounts lpa
    ORDER BY
      CASE
        WHEN lpa.status = 'active' THEN 0
        WHEN lpa.status = 'pending' THEN 1
        ELSE 2
      END,
      lpa.name
  `).all();
  res.json(investors);
});

// PATCH /api/lp/investors/:id/status - Toggle LP status between pending/active
router.patch('/investors/:id/status', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const investorId = Number(req.params.id);
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (!Number.isFinite(investorId) || investorId <= 0) {
    res.status(400).json({ error: 'Invalid investor id' });
    return;
  }
  if (!['active', 'pending'].includes(status)) {
    res.status(400).json({ error: 'status must be active or pending' });
    return;
  }

  const investor = db.prepare('SELECT id FROM lp_accounts WHERE id = ?').get(investorId) as any;
  if (!investor) {
    res.status(404).json({ error: 'Investor not found' });
    return;
  }

  db.prepare('UPDATE lp_accounts SET status = ? WHERE id = ?').run(status, investorId);
  res.json({ success: true, id: investorId, status });
});

// POST /api/lp/investors/:id/remove - guarded soft-remove of LP account
router.post('/investors/:id/remove', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const investorId = Number(req.params.id);
  const confirmText = String(req.body?.confirmText || '');
  if (!Number.isFinite(investorId) || investorId <= 0) {
    res.status(400).json({ error: 'Invalid investor id' });
    return;
  }

  const investor = db.prepare(`
    SELECT id, email, status, notes
    FROM lp_accounts
    WHERE id = ?
  `).get(investorId) as any;
  if (!investor) {
    res.status(404).json({ error: 'Investor not found' });
    return;
  }
  const expectedPhrase = `REMOVE ${String(investor.email || '').trim().toLowerCase()}`;
  if (!expectedPhrase || confirmText.trim().toLowerCase() !== expectedPhrase.toLowerCase()) {
    res.status(400).json({ error: `Confirmation text mismatch. Type exactly: ${expectedPhrase}` });
    return;
  }

  const stampedNote = `[${new Date().toISOString()}] LP soft-removed by GP`;
  const nextNotes = investor.notes ? `${investor.notes}\n${stampedNote}` : stampedNote;
  db.prepare(`
    UPDATE lp_accounts
    SET status = 'removed',
        notes = ?
    WHERE id = ?
  `).run(nextNotes, investorId);

  res.json({ success: true, id: investorId, status: 'removed' });
});

// ---- GP-Only: Capital Calls ----

// GET /api/lp/capital-call-items/open - Call items for reconciliation in Actuals (GP)
router.get('/capital-call-items/open', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const lpAccountId = req.query.lpAccountId ? Number(req.query.lpAccountId) : null;

  let sql = `
    SELECT
      cci.id as item_id,
      cci.capital_call_id,
      cci.lp_account_id,
      cci.amount,
      cci.status,
      cci.received_amount,
      cc.call_number,
      cc.call_date,
      cc.due_date,
      cc.purpose,
      cc.status as call_status,
      lpa.name as lp_name
    FROM capital_call_items cci
    JOIN capital_calls cc ON cc.id = cci.capital_call_id
    JOIN lp_accounts lpa ON lpa.id = cci.lp_account_id
    WHERE cc.status IN ('draft', 'sent', 'partially_received', 'completed')
  `;
  const params: any[] = [];
  if (lpAccountId) {
    sql += ' AND cci.lp_account_id = ?';
    params.push(lpAccountId);
  }
  sql += ' ORDER BY cc.call_date DESC, cc.call_number DESC, lpa.name ASC';

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// POST /api/lp/capital-calls/create - Create capital call
router.post('/capital-calls/create', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const { totalAmount, callDate, dueDate, purpose, letterTemplate, customEmailSubject, customEmailBody } = req.body;

  // Get next call number
  const lastCall = db.prepare(
    'SELECT MAX(call_number) as max_num FROM capital_calls'
  ).get() as any;
  const callNumber = (lastCall.max_num || 0) + 1;

  const callResult = db.prepare(`
    INSERT INTO capital_calls (
      call_number, total_amount, call_date, due_date, purpose, status, letter_template, custom_email_subject, custom_email_body
    )
    VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)
  `).run(callNumber, totalAmount, callDate, dueDate, purpose, letterTemplate, customEmailSubject, customEmailBody);

  const callId = callResult.lastInsertRowid;

  // Auto-calculate per-LP amounts
  const lps = db.prepare(`
    SELECT *
    FROM lp_accounts
    WHERE status IN ('active', 'pending')
  `).all() as any[];
  const totalCommitment = lps.reduce((s: number, lp: any) => s + lp.commitment, 0);
  if (lps.length === 0 || totalCommitment <= 0) {
    res.status(400).json({ error: 'No eligible LP accounts found with commitments.' });
    return;
  }

  const insertItem = db.prepare(`
    INSERT INTO capital_call_items (capital_call_id, lp_account_id, amount, status)
    VALUES (?, ?, ?, 'pending')
  `);

  const items = [];
  for (const lp of lps) {
    const amount = totalAmount * (lp.commitment / totalCommitment);
    insertItem.run(callId, lp.id, amount);
    recalcCalledCapitalForLp(db, Number(lp.id));
    items.push({ lpId: lp.id, lpName: lp.name, amount });
  }

  res.status(201).json({ callId, callNumber, items });
});

// GET /api/lp/capital-calls/all - List all capital calls (GP)
router.get('/capital-calls/all', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const calls = db.prepare(`
    SELECT cc.*,
      (SELECT COUNT(*) FROM capital_call_items cci WHERE cci.capital_call_id = cc.id AND cci.status = 'received') as received_count,
      (SELECT COUNT(*) FROM capital_call_items cci WHERE cci.capital_call_id = cc.id) as total_items
    FROM capital_calls cc
    ORDER BY cc.call_date DESC
  `).all();
  res.json(calls);
});

// GET /api/lp/capital-calls/:callId/items - List per-LP items for a call (GP)
router.get('/capital-calls/:callId/items', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const { callId } = req.params;
  const items = db.prepare(`
    SELECT cci.*, lpa.name as investor_name
    FROM capital_call_items cci
    JOIN lp_accounts lpa ON cci.lp_account_id = lpa.id
    WHERE cci.capital_call_id = ?
    ORDER BY lpa.name
  `).all(Number(callId));
  res.json(items);
});

// POST /api/lp/capital-calls/:callId/send - Bulk send call notices (custom email template supported)
router.post('/capital-calls/:callId/send', requireAuth, requireGP, async (req: Request, res: Response) => {
  const db = getDb();
  const { callId } = req.params;
  const bccMode = req.body?.bccMode !== undefined ? !!req.body.bccMode : true;
  const fundName = String(req.body?.fundName || process.env.FUND_NAME || '305 opportunites fund');
  const fromEmail = process.env.FROM_EMAIL || 'fund@brickell2451insights.com';

  const call = db.prepare(`
    SELECT id, call_number, total_amount, due_date, purpose, custom_email_subject, custom_email_body
    FROM capital_calls
    WHERE id = ?
  `).get(callId) as any;
  if (!call) {
    res.status(404).json({ error: 'Capital call not found' });
    return;
  }

  const items = db.prepare(`
    SELECT
      cci.id as item_id,
      cci.amount,
      cci.status,
      lpa.id as lp_account_id,
      lpa.name as investor_name,
      lpa.email as investor_email
    FROM capital_call_items cci
    JOIN lp_accounts lpa ON cci.lp_account_id = lpa.id
    WHERE cci.capital_call_id = ?
  `).all(Number(callId)) as Array<{
    item_id: number;
    amount: number;
    status: string;
    lp_account_id: number;
    investor_name: string;
    investor_email: string | null;
  }>;
  if (items.length === 0) {
    res.status(400).json({ error: 'No LP line items found for this call. Create/allocate the call first.' });
    return;
  }

  const baseSubject = String(
    call.custom_email_subject || 'Capital Call {{call_number}} — {{fund_name}}'
  );
  const baseBody = String(
    call.custom_email_body ||
      'Hi {{lp_name}},\n\nThis is a capital call notice for {{fund_name}}.\n\nCall #{{call_number}}\nTotal call amount: ${{call_amount}}\nYour amount: ${{lp_amount}}\nDue date: {{due_date}}\nPurpose: {{purpose}}\n\nPlease remit funds by the due date.\n\nThank you.'
  );

  const markItemSent = db.prepare(`
    UPDATE capital_call_items
    SET status = CASE WHEN status = 'pending' THEN 'sent' ELSE status END,
        sent_at = CASE WHEN sent_at IS NULL THEN CURRENT_TIMESTAMP ELSE sent_at END,
        email_sent = 1
    WHERE id = ?
  `);

  const markItemSendFailed = db.prepare(`
    UPDATE capital_call_items
    SET email_sent = 0
    WHERE id = ?
  `);

  let sentCount = 0;
  let failedCount = 0;

  for (const item of items) {
    if (!item.investor_email || !item.investor_email.trim()) {
      failedCount += 1;
      markItemSendFailed.run(item.item_id);
      continue;
    }

    const mergeVars = {
      lp_name: item.investor_name,
      investor_name: item.investor_name,
      fund_name: fundName,
      call_number: String(call.call_number),
      call_amount: fmtMoney(Number(call.total_amount)),
      lp_amount: fmtMoney(Number(item.amount)),
      due_date: String(call.due_date || ''),
      purpose: String(call.purpose || ''),
    };
    const subject = renderMergeTemplate(baseSubject, mergeVars);
    const body = renderMergeTemplate(baseBody, mergeVars);

    // Send directly to each LP for reliability. Optional BCC sends a copy to fund inbox.
    const toAddress = item.investor_email.trim();
    const bcc = bccMode ? [fromEmail] : undefined;

    const ok = await sendTransactionalEmail({
      to: toAddress,
      bcc,
      subject,
      text: body,
    });

    if (ok) {
      sentCount += 1;
      markItemSent.run(item.item_id);
    } else {
      failedCount += 1;
      markItemSendFailed.run(item.item_id);
    }
  }

  if (sentCount > 0) {
    db.prepare(`
      UPDATE capital_calls
      SET status = 'sent'
      WHERE id = ? AND status IN ('draft', 'partially_received')
    `).run(callId);
  }

  res.json({
    success: true,
    callId: Number(callId),
    bccMode,
    sentCount,
    failedCount,
    emailTemplate: {
      subject: baseSubject,
      body: baseBody,
    },
    availableMergeTags: [
      '{{lp_name}}',
      '{{investor_name}}',
      '{{fund_name}}',
      '{{call_number}}',
      '{{call_amount}}',
      '{{lp_amount}}',
      '{{due_date}}',
      '{{purpose}}',
    ],
    message: 'Capital call notices processed with mail merge and per-LP delivery.',
  });
});

// PUT /api/lp/capital-calls/:callId/items/:itemId/received - Mark as received
router.put('/capital-calls/:callId/items/:itemId/received', requireAuth, requireGP, (req: Request, res: Response) => {
  const db = getDb();
  const { callId, itemId } = req.params;
  const {
    receivedAmount,
    receiptReference,
    bankTxnId,
  } = req.body as {
    receivedAmount?: number;
    receiptReference?: string;
    bankTxnId?: string;
  };

  // Also create a capital transaction
  const item = db.prepare('SELECT * FROM capital_call_items WHERE id = ?').get(itemId) as any;
  if (item) {
    const amount = Number(receivedAmount ?? item.amount);
    const isPartial = amount < Number(item.amount);
    db.prepare(`
      UPDATE capital_call_items
      SET status = ?,
          received_at = CURRENT_TIMESTAMP,
          received_amount = ?,
          receipt_reference = COALESCE(?, receipt_reference),
          bank_txn_id = COALESCE(?, bank_txn_id)
      WHERE id = ?
    `).run(isPartial ? 'pending' : 'received', amount, receiptReference || null, bankTxnId || null, itemId);

    db.prepare(`
      INSERT INTO capital_transactions (lp_account_id, capital_call_item_id, type, amount, date, notes)
      VALUES (?, ?, 'call', ?, date('now'), 'Capital call received')
    `).run(item.lp_account_id, item.id, amount);

    recalcCalledCapitalForLp(db, Number(item.lp_account_id));
  }

  const agg = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) as received_count,
      COUNT(*) as total_count
    FROM capital_call_items
    WHERE capital_call_id = ?
  `).get(callId) as any;
  if (agg) {
    const nextStatus =
      agg.received_count === 0 ? 'sent' :
      agg.received_count < agg.total_count ? 'partially_received' :
      'completed';
    db.prepare(`UPDATE capital_calls SET status = ? WHERE id = ?`).run(nextStatus, callId);
  }

  res.json({ success: true });
});

export default router;
