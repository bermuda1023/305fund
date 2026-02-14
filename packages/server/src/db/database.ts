/**
 * Database initialization and connection management.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA } from './schema';
import { ALL_UNIT_TYPES, generateBuildingUnits, DEFAULT_ASSUMPTIONS } from '@brickell/shared';

let db: Database.Database | null = null;

function bootstrapReferenceData(database: Database.Database): void {
  const insertUnitType = database.prepare(`
    INSERT OR IGNORE INTO unit_types (unit_letter, ownership_pct, sqft, beds, base_hoa, is_special)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateUnitType = database.prepare(`
    UPDATE unit_types
    SET ownership_pct = ?, sqft = ?, beds = ?, base_hoa = ?, is_special = ?
    WHERE unit_letter = ?
  `);
  for (const ut of ALL_UNIT_TYPES) {
    insertUnitType.run(ut.unitLetter, ut.ownershipPct, ut.sqft, ut.beds, ut.baseHOA, ut.isSpecial ? 1 : 0);
    updateUnitType.run(ut.ownershipPct, ut.sqft, ut.beds, ut.baseHOA, ut.isSpecial ? 1 : 0, ut.unitLetter);
  }

  const unitTypeRows = database.prepare('SELECT id, unit_letter FROM unit_types').all() as Array<{ id: number; unit_letter: string }>;
  const unitTypeMap = new Map<string, number>();
  for (const row of unitTypeRows) {
    unitTypeMap.set(row.unit_letter, row.id);
  }

  const insertBuildingUnit = database.prepare(`
    INSERT OR IGNORE INTO building_units (floor, unit_letter, unit_number, unit_type_id)
    VALUES (?, ?, ?, ?)
  `);
  const updateBuildingUnit = database.prepare(`
    UPDATE building_units
    SET floor = ?, unit_letter = ?, unit_type_id = ?
    WHERE unit_number = ?
  `);
  const buildingUnits = generateBuildingUnits();
  for (const bu of buildingUnits) {
    let typeId = unitTypeMap.get(bu.unitLetter);
    if (!typeId) {
      const letter = bu.unitLetter.replace(/^\d+/, '');
      typeId = unitTypeMap.get(letter);
    }
    if (!typeId) continue;
    insertBuildingUnit.run(bu.floor, bu.unitLetter, bu.unitNumber, typeId);
    updateBuildingUnit.run(bu.floor, bu.unitLetter, typeId, bu.unitNumber);
  }

  const assumptionsCount = Number((database.prepare('SELECT COUNT(*) as c FROM fund_assumptions').get() as any)?.c || 0);
  if (assumptionsCount === 0) {
    const a = DEFAULT_ASSUMPTIONS;
    database.prepare(`
      INSERT INTO fund_assumptions (
        name, is_active, fund_size, fund_term_years, investment_period_years,
        gp_coinvest_pct, mgmt_fee_invest_pct, mgmt_fee_post_pct, mgmt_fee_waiver,
        pref_return_pct, catchup_pct,
        tier1_split_lp, tier1_split_gp, tier2_hurdle_irr, tier2_split_lp, tier2_split_gp,
        tier3_hurdle_irr, tier3_split_lp, tier3_split_gp,
        refi_enabled, refi_year, refi_ltv, refi_rate, refi_term_years, refi_cost_pct,
        rent_growth_pct, hoa_growth_pct, vacancy_pct,
        annual_fund_opex_mode, annual_fund_opex_fixed, annual_fund_opex_threshold_pct, annual_fund_opex_adjust_pct,
        present_day_land_value,
        land_value_total, land_growth_pct, land_psf,
        mm_rate, excess_cash_mode, building_valuation,
        bonus_irr_threshold, bonus_max_years, bonus_yield_threshold
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      a.name, a.isActive ? 1 : 0, a.fundSize, a.fundTermYears, a.investmentPeriodYears,
      a.gpCoinvestPct, a.mgmtFeeInvestPct, a.mgmtFeePostPct, a.mgmtFeeWaiver ? 1 : 0,
      a.prefReturnPct, a.catchupPct,
      a.tier1SplitLP, a.tier1SplitGP, a.tier2HurdleIRR, a.tier2SplitLP, a.tier2SplitGP,
      a.tier3HurdleIRR, a.tier3SplitLP, a.tier3SplitGP,
      a.refiEnabled ? 1 : 0, a.refiYear, a.refiLTV, a.refiRate, a.refiTermYears, a.refiCostPct,
      a.rentGrowthPct, a.hoaGrowthPct, a.vacancyPct,
      a.annualFundOpexMode, a.annualFundOpexFixed, a.annualFundOpexThresholdPct, a.annualFundOpexAdjustPct,
      a.presentDayLandValue,
      a.landValueTotal, a.landGrowthPct, a.landPSF,
      a.mmRate, a.excessCashMode, a.buildingValuation,
      a.bonusIRRThreshold, a.bonusMaxYears, a.bonusYieldThreshold
    );
  }
}

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'brickell-fund.db');
    db = new Database(dbPath);

    // Enable WAL mode for better concurrent access
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDb(): void {
  const database = getDb();
  try {
    database.exec(SCHEMA);
  } catch (error: any) {
    // Older DBs can fail on newly added index columns before migrations run.
    const msg = String(error?.message || '');
    if (!msg.includes('lp_account_id') && !msg.includes('capital_call_item_id')) {
      throw error;
    }
    const schemaWithoutNewIndexes = SCHEMA
      .replace(
      /CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_lp ON cash_flow_actuals\(lp_account_id\);\s*/g,
      ''
      )
      .replace(
        /CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_call_item ON cash_flow_actuals\(capital_call_item_id\);\s*/g,
        ''
      );
    database.exec(schemaWithoutNewIndexes);
  }

  // Run migrations for new columns (safe to re-run)
  const migrations = [
    `ALTER TABLE building_units ADD COLUMN owner_name TEXT`,
    `ALTER TABLE building_units ADD COLUMN owner_email TEXT`,
    `ALTER TABLE building_units ADD COLUMN owner_phone TEXT`,
    `ALTER TABLE building_units ADD COLUMN owner_company TEXT`,
    `ALTER TABLE bank_uploads ADD COLUMN file_type_check TEXT`, // placeholder for file_type constraint relaxation
    `ALTER TABLE bank_uploads ADD COLUMN file_path TEXT`,
    `ALTER TABLE fund_assumptions ADD COLUMN present_day_land_value REAL NOT NULL DEFAULT 650000000`,
    `ALTER TABLE fund_assumptions ADD COLUMN annual_fund_opex_mode TEXT NOT NULL DEFAULT 'fixed'`,
    `ALTER TABLE fund_assumptions ADD COLUMN annual_fund_opex_fixed REAL NOT NULL DEFAULT 75000`,
    `ALTER TABLE fund_assumptions ADD COLUMN annual_fund_opex_threshold_pct REAL NOT NULL DEFAULT 0.02`,
    `ALTER TABLE fund_assumptions ADD COLUMN annual_fund_opex_adjust_pct REAL NOT NULL DEFAULT 0`,
    `ALTER TABLE portfolio_units ADD COLUMN hoa_is_recurring INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE portfolio_units ADD COLUMN hoa_reconcile_ref TEXT`,
    `ALTER TABLE portfolio_units ADD COLUMN insurance_is_recurring INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE portfolio_units ADD COLUMN insurance_reconcile_ref TEXT`,
    `ALTER TABLE portfolio_units ADD COLUMN tax_is_recurring INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE portfolio_units ADD COLUMN tax_reconcile_ref TEXT`,
    `ALTER TABLE portfolio_units ADD COLUMN insurance_payment_month INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE portfolio_units ADD COLUMN insurance_payment_day INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE portfolio_units ADD COLUMN tax_payment_month INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE portfolio_units ADD COLUMN tax_payment_day INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE unit_renovations ADD COLUMN expense_source TEXT NOT NULL DEFAULT 'bank'`,
    `ALTER TABLE unit_renovations ADD COLUMN reconcile_ref TEXT`,
    `ALTER TABLE unit_renovations ADD COLUMN reconciled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE capital_calls ADD COLUMN custom_email_subject TEXT`,
    `ALTER TABLE capital_calls ADD COLUMN custom_email_body TEXT`,
    `ALTER TABLE capital_call_items ADD COLUMN received_amount REAL`,
    `ALTER TABLE capital_call_items ADD COLUMN receipt_reference TEXT`,
    `ALTER TABLE capital_call_items ADD COLUMN bank_txn_id TEXT`,
    `ALTER TABLE cash_flow_actuals ADD COLUMN receipt_document_id INTEGER REFERENCES documents(id)`,
    `ALTER TABLE cash_flow_actuals ADD COLUMN statement_ref TEXT`,
    `ALTER TABLE cash_flow_actuals ADD COLUMN lp_account_id INTEGER REFERENCES lp_accounts(id)`,
    `ALTER TABLE cash_flow_actuals ADD COLUMN capital_call_item_id INTEGER REFERENCES capital_call_items(id)`,
    `ALTER TABLE tenants ADD COLUMN rent_due_day INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN reset_password_token_hash TEXT`,
    `ALTER TABLE users ADD COLUMN reset_password_expires_at DATETIME`,
  ];

  for (const sql of migrations) {
    try {
      database.exec(sql);
    } catch {
      // Column already exists — ignore
    }
  }

  try {
    database.exec(`
      UPDATE fund_assumptions
      SET
        annual_fund_opex_mode = CASE
          WHEN annual_fund_opex_mode IN ('fixed', 'threshold_pct') THEN annual_fund_opex_mode
          ELSE 'fixed'
        END,
        annual_fund_opex_fixed = CASE
          WHEN annual_fund_opex_fixed IS NULL OR annual_fund_opex_fixed < 0 THEN 75000
          ELSE annual_fund_opex_fixed
        END,
        annual_fund_opex_threshold_pct = CASE
          WHEN annual_fund_opex_threshold_pct IS NULL OR annual_fund_opex_threshold_pct < 0 THEN 0.02
          ELSE annual_fund_opex_threshold_pct
        END,
        annual_fund_opex_adjust_pct = CASE
          WHEN annual_fund_opex_adjust_pct IS NULL OR annual_fund_opex_adjust_pct < 0 THEN 0
          ELSE annual_fund_opex_adjust_pct
        END;
    `);
  } catch {
    // ignore normalization failures on legacy bootstrap edge cases
  }

  // Insurance and tax are annual payments (non-monthly recurring)
  try {
    database.exec(`
      UPDATE portfolio_units
      SET insurance_is_recurring = 0
      WHERE insurance_is_recurring IS NULL OR insurance_is_recurring NOT IN (0,1) OR insurance_is_recurring = 1;
      UPDATE portfolio_units
      SET tax_is_recurring = 0
      WHERE tax_is_recurring IS NULL OR tax_is_recurring NOT IN (0,1) OR tax_is_recurring = 1;
      UPDATE portfolio_units
      SET insurance_payment_month = CASE
        WHEN insurance_payment_month IS NULL OR insurance_payment_month < 1 OR insurance_payment_month > 12 THEN 1
        ELSE insurance_payment_month
      END,
      insurance_payment_day = CASE
        WHEN insurance_payment_day IS NULL OR insurance_payment_day < 1 OR insurance_payment_day > 31 THEN 1
        ELSE insurance_payment_day
      END,
      tax_payment_month = CASE
        WHEN tax_payment_month IS NULL OR tax_payment_month < 1 OR tax_payment_month > 12 THEN 1
        ELSE tax_payment_month
      END,
      tax_payment_day = CASE
        WHEN tax_payment_day IS NULL OR tax_payment_day < 1 OR tax_payment_day > 31 THEN 1
        ELSE tax_payment_day
      END;
    `);
  } catch {
    // Columns may not exist yet on first run before migrations
  }

  // Migrate bank_uploads to relax file_type CHECK constraint (old: csv/ofx only, new includes pdf/manual/xls/xlsx)
  // SQLite doesn't support ALTER CHECK, so we recreate the table if the old constraint is in place
  try {
    // Test if the old constraint blocks newer statement file types
    database.exec(`INSERT INTO bank_uploads (filename, file_type, row_count, status) VALUES ('__migration_test__', 'xlsx', 0, 'parsed')`);
    // If that succeeded, clean up the test row
    database.exec(`DELETE FROM bank_uploads WHERE filename = '__migration_test__'`);
  } catch {
    // Old CHECK constraint is blocking — recreate the table
    try {
      database.exec(`
        ALTER TABLE bank_uploads RENAME TO bank_uploads_old;
        CREATE TABLE bank_uploads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
          file_type TEXT NOT NULL CHECK (file_type IN ('csv', 'ofx', 'pdf', 'manual', 'xls', 'xlsx')),
          row_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'parsed'
            CHECK (status IN ('parsed', 'reconciled', 'error', 'pending_review')),
          file_path TEXT,
          file_type_check TEXT
        );
        INSERT INTO bank_uploads (id, filename, upload_date, file_type, row_count, status, file_type_check)
          SELECT id, filename, upload_date, file_type, row_count, status, file_type_check FROM bank_uploads_old;
        DROP TABLE bank_uploads_old;
      `);
    } catch {
      // Migration already done or table doesn't exist yet — ignore
    }
  }

  // Ensure learned_mappings table exists (for existing databases pre-schema update)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS learned_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        description_pattern TEXT NOT NULL,
        portfolio_unit_id INTEGER NOT NULL REFERENCES portfolio_units(id),
        category TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_learned_mappings_pattern ON learned_mappings(description_pattern);
    `);
  } catch {
    // Already exists — ignore
  }

  // Ensure rent reminder tables + single settings row exist
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS rent_reminder_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 1,
        days_late_threshold INTEGER NOT NULL DEFAULT 5,
        subject_template TEXT NOT NULL DEFAULT 'Rent Reminder: {{unit_number}} is {{days_late}} day(s) past due',
        body_template TEXT NOT NULL DEFAULT 'Hi {{tenant_name}},\n\nOur records show rent for {{period_label}} is still outstanding.\n\nAmount due: {{amount_due}}\nAmount received: {{amount_paid}}\nOutstanding: {{amount_outstanding}}\n\nPlease submit payment as soon as possible.\n\nThank you.',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS rent_reminder_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        checked_count INTEGER NOT NULL DEFAULT 0,
        alert_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT
      );
      INSERT OR IGNORE INTO rent_reminder_settings (id) VALUES (1);
    `);
  } catch {
    // ignore bootstrap failures on already-initialized DBs
  }

  // Migrate cash_flow_actuals CHECK constraint to include fund_expense category
  try {
    database.exec(`INSERT INTO cash_flow_actuals (date, amount, category, description, source_file, reconciled) VALUES ('2099-01-01', 0, 'fund_expense', '__migration_test__', '__migration_test__', 0)`);
    database.exec(`DELETE FROM cash_flow_actuals WHERE description = '__migration_test__' AND source_file = '__migration_test__'`);
  } catch {
    try {
      database.exec(`
        ALTER TABLE cash_flow_actuals RENAME TO cash_flow_actuals_old;
        CREATE TABLE cash_flow_actuals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          portfolio_unit_id INTEGER REFERENCES portfolio_units(id),
          lp_account_id INTEGER REFERENCES lp_accounts(id),
          capital_call_item_id INTEGER REFERENCES capital_call_items(id),
          date DATE NOT NULL,
          amount REAL NOT NULL,
          category TEXT NOT NULL
            CHECK (category IN ('rent', 'hoa', 'insurance', 'tax', 'repair', 'capital_call', 'distribution', 'management_fee', 'fund_expense', 'other')),
          description TEXT,
          source_file TEXT,
          statement_ref TEXT,
          receipt_document_id INTEGER REFERENCES documents(id),
          reconciled INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO cash_flow_actuals (id, portfolio_unit_id, lp_account_id, capital_call_item_id, date, amount, category, description, source_file, statement_ref, receipt_document_id, reconciled)
          SELECT id, portfolio_unit_id, NULL, NULL, date, amount, category, description, source_file, NULL, NULL, reconciled
          FROM cash_flow_actuals_old;
        DROP TABLE cash_flow_actuals_old;
        CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_unit ON cash_flow_actuals(portfolio_unit_id);
        CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_lp ON cash_flow_actuals(lp_account_id);
        CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_call_item ON cash_flow_actuals(capital_call_item_id);
        CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_date ON cash_flow_actuals(date);
      `);
    } catch {
      // Migration already done or no legacy table present
    }
  }

  try {
    bootstrapReferenceData(database);
  } catch (error) {
    console.error('Reference data bootstrap failed:', error);
  }

  // Normalize consensus/listing fields for older or partially-migrated DBs.
  // Keeps contracts/dashboard vote metrics stable even when legacy rows contain NULL/invalid values.
  try {
    database.exec(`
      UPDATE building_units
      SET
        is_fund_owned = CASE
          WHEN is_fund_owned IS NULL OR is_fund_owned NOT IN (0, 1) THEN 0
          ELSE is_fund_owned
        END,
        consensus_status = CASE
          WHEN consensus_status IN ('signed', 'unsigned', 'unknown') THEN consensus_status
          ELSE 'unknown'
        END,
        listing_agreement = CASE
          WHEN listing_agreement IN ('signed', 'unsigned', 'unknown') THEN listing_agreement
          ELSE 'unknown'
        END,
        resident_type = CASE
          WHEN resident_type IN ('residential', 'investment') THEN resident_type
          ELSE resident_type
        END;
    `);
  } catch {
    // Ignore normalization failures on first boot race/legacy schema edges.
  }

  console.log('Database schema initialized');
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
