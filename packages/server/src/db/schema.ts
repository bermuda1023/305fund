/**
 * SQLite database schema.
 * All table definitions for the fund management platform.
 */

export const SCHEMA = `
-- Users (GP and LP accounts)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('gp', 'lp')),
  name TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  reset_password_token_hash TEXT,
  reset_password_expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fund Assumptions (saveable model scenarios)
CREATE TABLE IF NOT EXISTS fund_assumptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  fund_size REAL NOT NULL,
  fund_term_years INTEGER NOT NULL,
  investment_period_years INTEGER NOT NULL,
  gp_coinvest_pct REAL NOT NULL,
  mgmt_fee_invest_pct REAL NOT NULL DEFAULT 0,
  mgmt_fee_post_pct REAL NOT NULL DEFAULT 0.005,
  mgmt_fee_waiver INTEGER NOT NULL DEFAULT 1,
  pref_return_pct REAL NOT NULL DEFAULT 0.06,
  catchup_pct REAL NOT NULL DEFAULT 1.0,
  tier1_split_lp REAL NOT NULL DEFAULT 0.80,
  tier1_split_gp REAL NOT NULL DEFAULT 0.20,
  tier2_hurdle_irr REAL NOT NULL DEFAULT 0.15,
  tier2_split_lp REAL NOT NULL DEFAULT 0.70,
  tier2_split_gp REAL NOT NULL DEFAULT 0.30,
  tier3_hurdle_irr REAL NOT NULL DEFAULT 0.25,
  tier3_split_lp REAL NOT NULL DEFAULT 0.65,
  tier3_split_gp REAL NOT NULL DEFAULT 0.35,
  refi_enabled INTEGER NOT NULL DEFAULT 1,
  refi_year INTEGER NOT NULL DEFAULT 6,
  refi_ltv REAL NOT NULL DEFAULT 0.55,
  refi_rate REAL NOT NULL DEFAULT 0.06,
  refi_term_years INTEGER NOT NULL DEFAULT 30,
  refi_cost_pct REAL NOT NULL DEFAULT 0.02,
  rent_growth_pct REAL NOT NULL DEFAULT 0.03,
  hoa_growth_pct REAL NOT NULL DEFAULT 0.02,
  tax_growth_pct REAL NOT NULL DEFAULT 0.02,
  vacancy_pct REAL NOT NULL DEFAULT 0.05,
  annual_fund_opex_mode TEXT NOT NULL DEFAULT 'fixed'
    CHECK (annual_fund_opex_mode IN ('fixed', 'threshold_pct')),
  annual_fund_opex_fixed REAL NOT NULL DEFAULT 75000,
  annual_fund_opex_threshold_pct REAL NOT NULL DEFAULT 0.02,
  annual_fund_opex_adjust_pct REAL NOT NULL DEFAULT 0,
  present_day_land_value REAL NOT NULL DEFAULT 650000000,
  land_value_total REAL NOT NULL DEFAULT 800000000,
  land_growth_pct REAL NOT NULL DEFAULT 0.03,
  land_psf REAL NOT NULL DEFAULT 1700,
  mm_rate REAL NOT NULL DEFAULT 0.045,
  excess_cash_mode TEXT NOT NULL DEFAULT 'mm_sweep'
    CHECK (excess_cash_mode IN ('reinvest', 'mm_sweep', 'distribute')),
  building_valuation REAL NOT NULL DEFAULT 215000000,
  bonus_irr_threshold REAL NOT NULL DEFAULT 0.25,
  bonus_max_years INTEGER NOT NULL DEFAULT 12,
  bonus_yield_threshold REAL NOT NULL DEFAULT 0.04,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Unit Types (51 configurations)
CREATE TABLE IF NOT EXISTS unit_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_letter TEXT NOT NULL UNIQUE,
  ownership_pct REAL NOT NULL,
  sqft INTEGER NOT NULL,
  beds INTEGER NOT NULL,
  base_hoa REAL NOT NULL,
  is_special INTEGER NOT NULL DEFAULT 0
);

-- Building Units (all 359 units)
CREATE TABLE IF NOT EXISTS building_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  floor INTEGER NOT NULL,
  unit_letter TEXT NOT NULL,
  unit_number TEXT NOT NULL UNIQUE,
  unit_type_id INTEGER NOT NULL REFERENCES unit_types(id),
  is_fund_owned INTEGER NOT NULL DEFAULT 0,
  consensus_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (consensus_status IN ('signed', 'unsigned', 'unknown')),
  listing_agreement TEXT NOT NULL DEFAULT 'unknown'
    CHECK (listing_agreement IN ('signed', 'unsigned', 'unknown')),
  resident_name TEXT,
  resident_type TEXT CHECK (resident_type IN ('residential', 'investment')),
  notes TEXT
);

-- Entities / LLCs
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'llc'
    CHECK (type IN ('llc', 'trust', 'corp', 'individual')),
  state_of_formation TEXT,
  ein TEXT,
  registered_agent TEXT,
  formation_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'dissolved')),
  notes TEXT
);

-- Portfolio Units (fund-owned)
CREATE TABLE IF NOT EXISTS portfolio_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_unit_id INTEGER NOT NULL REFERENCES building_units(id),
  entity_id INTEGER REFERENCES entities(id),
  purchase_date DATE NOT NULL,
  purchase_price REAL NOT NULL,
  purchase_price_psf REAL NOT NULL,
  closing_costs REAL NOT NULL DEFAULT 0,
  transfer_tax REAL NOT NULL DEFAULT 0,
  inspection_cost REAL NOT NULL DEFAULT 0,
  total_acquisition_cost REAL NOT NULL,
  monthly_rent REAL NOT NULL DEFAULT 0,
  monthly_hoa REAL NOT NULL,
  hoa_is_recurring INTEGER NOT NULL DEFAULT 1,
  hoa_reconcile_ref TEXT,
  monthly_insurance REAL NOT NULL DEFAULT 0, -- annual amount
  insurance_payment_month INTEGER NOT NULL DEFAULT 1,
  insurance_payment_day INTEGER NOT NULL DEFAULT 1,
  insurance_is_recurring INTEGER NOT NULL DEFAULT 0,
  insurance_reconcile_ref TEXT,
  monthly_tax REAL NOT NULL DEFAULT 0, -- annual amount
  tax_payment_month INTEGER NOT NULL DEFAULT 1,
  tax_payment_day INTEGER NOT NULL DEFAULT 1,
  tax_is_recurring INTEGER NOT NULL DEFAULT 0,
  tax_reconcile_ref TEXT,
  scenario_id INTEGER REFERENCES fund_assumptions(id)
);

-- Tenants
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_unit_id INTEGER NOT NULL REFERENCES portfolio_units(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  lease_start DATE NOT NULL,
  lease_end DATE NOT NULL,
  rent_due_day INTEGER NOT NULL DEFAULT 1,
  monthly_rent REAL NOT NULL,
  security_deposit REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'month_to_month', 'vacated')),
  notes TEXT
);

-- Unit Renovations
CREATE TABLE IF NOT EXISTS unit_renovations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_unit_id INTEGER NOT NULL REFERENCES portfolio_units(id),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed')),
  estimated_cost REAL NOT NULL DEFAULT 0,
  actual_cost REAL,
  expense_source TEXT NOT NULL DEFAULT 'bank'
    CHECK (expense_source IN ('bank', 'credit_card', 'wire', 'cash', 'other')),
  reconcile_ref TEXT,
  reconciled INTEGER NOT NULL DEFAULT 0,
  contractor TEXT,
  start_date DATE,
  end_date DATE,
  notes TEXT
);

-- Documents (polymorphic — stores docs for entities, units, tenants, renovations, LPs)
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL,
  parent_type TEXT NOT NULL
    CHECK (parent_type IN ('entity', 'unit', 'tenant', 'renovation', 'lp', 'fund')),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  requires_signature INTEGER NOT NULL DEFAULT 0,
  signed_at DATETIME,
  uploaded_by TEXT
);

<<<<<<< HEAD
-- Bank Uploads
CREATE TABLE IF NOT EXISTS bank_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  file_type TEXT NOT NULL CHECK (file_type IN ('csv', 'ofx', 'pdf', 'manual', 'xls', 'xlsx')),
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'parsed'
    CHECK (status IN ('parsed', 'reconciled', 'error', 'pending_review')),
  file_path TEXT,
  file_sha256 TEXT,
  uploaded_by TEXT
);

-- Bank Transactions (immutable raw statement rows)
CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_upload_id INTEGER REFERENCES bank_uploads(id),
  date DATE NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  source_file TEXT,
  statement_ref TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Accounting periods (month close controls)
CREATE TABLE IF NOT EXISTS accounting_periods (
  month TEXT PRIMARY KEY, -- 'YYYY-MM'
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at DATETIME,
  closed_by TEXT
);

-- Audit log (append-only)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at DATETIME DEFAULT CURRENT_TIMESTAMP,
  actor_email TEXT,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  request_id TEXT,
  ip TEXT,
  before_json TEXT,
  after_json TEXT
);

-- Cash Flow Actuals (allocations applied to bank transactions)
=======
-- Public signing links (hashed token, can be single-use or reusable)
CREATE TABLE IF NOT EXISTS document_signing_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  token_hash TEXT NOT NULL UNIQUE,
  is_single_use INTEGER NOT NULL DEFAULT 1,
  expires_at DATETIME,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT
);

-- Signature audit + executed PDF reference
CREATE TABLE IF NOT EXISTS document_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  signing_link_id INTEGER REFERENCES document_signing_links(id),
  signer_name TEXT NOT NULL,
  signer_email TEXT,
  signer_company TEXT,
  signer_title TEXT,
  signature_text TEXT NOT NULL,
  signed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  signed_ip TEXT,
  signed_user_agent TEXT,
  original_pdf_sha256 TEXT NOT NULL,
  executed_file_path TEXT,
  executed_pdf_sha256 TEXT
);

-- Cash Flow Actuals (from bank statements)
>>>>>>> bc25b8e (add NDA signing and investor unlock flow)
CREATE TABLE IF NOT EXISTS cash_flow_actuals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id INTEGER REFERENCES bank_transactions(id),
  portfolio_unit_id INTEGER REFERENCES portfolio_units(id),
  entity_id INTEGER REFERENCES entities(id),
  unit_renovation_id INTEGER REFERENCES unit_renovations(id),
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

-- Learned Mappings (description pattern → unit auto-assignment)
CREATE TABLE IF NOT EXISTS learned_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description_pattern TEXT NOT NULL,
  portfolio_unit_id INTEGER NOT NULL REFERENCES portfolio_units(id),
  category TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Listings (units for sale)
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  building_unit_id INTEGER REFERENCES building_units(id),
  unit_number TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('zillow', 'realtor', 'redfin', 'mls', 'manual')),
  source_url TEXT,
  asking_price REAL NOT NULL,
  price_psf REAL NOT NULL,
  listed_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'sold', 'removed')),
  implied_building_value REAL,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- FRED Data (cached index values)
CREATE TABLE IF NOT EXISTS fred_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id TEXT NOT NULL,
  date DATE NOT NULL,
  value REAL NOT NULL,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(series_id, date)
);

-- LP Accounts (onboarded investors)
CREATE TABLE IF NOT EXISTS lp_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  entity_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  commitment REAL NOT NULL,
  called_capital REAL NOT NULL DEFAULT 0,
  distributions REAL NOT NULL DEFAULT 0,
  ownership_pct REAL NOT NULL DEFAULT 0,
  onboarded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'inactive')),
  wire_instructions TEXT,
  notes TEXT
);

-- Capital Calls
CREATE TABLE IF NOT EXISTS capital_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_number INTEGER NOT NULL,
  total_amount REAL NOT NULL,
  call_date DATE NOT NULL,
  due_date DATE NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partially_received', 'completed')),
  letter_template TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Capital Call Items (per-LP breakdown)
CREATE TABLE IF NOT EXISTS capital_call_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  capital_call_id INTEGER NOT NULL REFERENCES capital_calls(id),
  lp_account_id INTEGER NOT NULL REFERENCES lp_accounts(id),
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'received', 'overdue')),
  sent_at DATETIME,
  received_at DATETIME,
  email_sent INTEGER NOT NULL DEFAULT 0,
  sms_sent INTEGER NOT NULL DEFAULT 0
);

-- Capital Transactions (all capital movements)
CREATE TABLE IF NOT EXISTS capital_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lp_account_id INTEGER NOT NULL REFERENCES lp_accounts(id),
  capital_call_item_id INTEGER REFERENCES capital_call_items(id),
  type TEXT NOT NULL CHECK (type IN ('call', 'distribution')),
  amount REAL NOT NULL,
  date DATE NOT NULL,
  quarter TEXT,
  notes TEXT
);

-- Tenant Communications
CREATE TABLE IF NOT EXISTS tenant_communications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK (type IN ('email', 'sms')),
  subject TEXT,
  body TEXT NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('draft', 'sent', 'failed', 'delivered')),
  template_name TEXT
);

-- Rent reminder settings + run audit
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

-- Owner contact info (from master list import)
-- These are added via ALTER TABLE if not present, see migrations below

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_building_units_floor ON building_units(floor);
CREATE INDEX IF NOT EXISTS idx_building_units_fund_owned ON building_units(is_fund_owned);
CREATE INDEX IF NOT EXISTS idx_portfolio_units_building ON portfolio_units(building_unit_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_unit ON cash_flow_actuals(portfolio_unit_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_entity ON cash_flow_actuals(entity_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_reno ON cash_flow_actuals(unit_renovation_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_bank_txn ON cash_flow_actuals(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_lp ON cash_flow_actuals(lp_account_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_call_item ON cash_flow_actuals(capital_call_item_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_date ON cash_flow_actuals(date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_upload ON bank_transactions(bank_upload_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_status ON accounting_periods(status);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_fred_data_series ON fred_data(series_id, date);
CREATE INDEX IF NOT EXISTS idx_capital_call_items_call ON capital_call_items(capital_call_id);
CREATE INDEX IF NOT EXISTS idx_capital_transactions_lp ON capital_transactions(lp_account_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_document_signing_links_document ON document_signing_links(document_id);
CREATE INDEX IF NOT EXISTS idx_document_signatures_document ON document_signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_tenants_unit ON tenants(portfolio_unit_id);
CREATE INDEX IF NOT EXISTS idx_tenant_comms_tenant ON tenant_communications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_learned_mappings_pattern ON learned_mappings(description_pattern);
`;
