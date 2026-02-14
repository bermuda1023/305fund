/**
 * Database initialization and connection management.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { SCHEMA } from './schema';

let db: Database.Database | null = null;

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
  ];

  for (const sql of migrations) {
    try {
      database.exec(sql);
    } catch {
      // Column already exists — ignore
    }
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

  console.log('Database schema initialized');
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
