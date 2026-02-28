/**
 * Postgres baseline schema for production cutover.
 * Keeps table names and columns aligned with the SQLite app schema.
 */
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('gp', 'lp')),
  name TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  reset_password_token_hash TEXT,
  reset_password_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fund_assumptions (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  fund_size DOUBLE PRECISION NOT NULL,
  fund_term_years INTEGER NOT NULL,
  investment_period_years INTEGER NOT NULL,
  gp_coinvest_pct DOUBLE PRECISION NOT NULL,
  mgmt_fee_invest_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  mgmt_fee_post_pct DOUBLE PRECISION NOT NULL DEFAULT 0.005,
  mgmt_fee_waiver INTEGER NOT NULL DEFAULT 1,
  pref_return_pct DOUBLE PRECISION NOT NULL DEFAULT 0.06,
  catchup_pct DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  tier1_split_lp DOUBLE PRECISION NOT NULL DEFAULT 0.80,
  tier1_split_gp DOUBLE PRECISION NOT NULL DEFAULT 0.20,
  tier2_hurdle_irr DOUBLE PRECISION NOT NULL DEFAULT 0.15,
  tier2_split_lp DOUBLE PRECISION NOT NULL DEFAULT 0.70,
  tier2_split_gp DOUBLE PRECISION NOT NULL DEFAULT 0.30,
  tier3_hurdle_irr DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  tier3_split_lp DOUBLE PRECISION NOT NULL DEFAULT 0.65,
  tier3_split_gp DOUBLE PRECISION NOT NULL DEFAULT 0.35,
  refi_enabled INTEGER NOT NULL DEFAULT 1,
  refi_year INTEGER NOT NULL DEFAULT 6,
  refi_ltv DOUBLE PRECISION NOT NULL DEFAULT 0.55,
  refi_rate DOUBLE PRECISION NOT NULL DEFAULT 0.06,
  refi_term_years INTEGER NOT NULL DEFAULT 30,
  refi_cost_pct DOUBLE PRECISION NOT NULL DEFAULT 0.02,
  rent_growth_pct DOUBLE PRECISION NOT NULL DEFAULT 0.03,
  hoa_growth_pct DOUBLE PRECISION NOT NULL DEFAULT 0.02,
  tax_growth_pct DOUBLE PRECISION NOT NULL DEFAULT 0.02,
  vacancy_pct DOUBLE PRECISION NOT NULL DEFAULT 0.05,
  annual_fund_opex_mode TEXT NOT NULL DEFAULT 'fixed'
    CHECK (annual_fund_opex_mode IN ('fixed', 'threshold_pct')),
  annual_fund_opex_fixed DOUBLE PRECISION NOT NULL DEFAULT 75000,
  annual_fund_opex_threshold_pct DOUBLE PRECISION NOT NULL DEFAULT 0.02,
  annual_fund_opex_adjust_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  present_day_land_value DOUBLE PRECISION NOT NULL DEFAULT 650000000,
  land_value_total DOUBLE PRECISION NOT NULL DEFAULT 800000000,
  land_growth_pct DOUBLE PRECISION NOT NULL DEFAULT 0.03,
  land_psf DOUBLE PRECISION NOT NULL DEFAULT 1700,
  mm_rate DOUBLE PRECISION NOT NULL DEFAULT 0.045,
  excess_cash_mode TEXT NOT NULL DEFAULT 'mm_sweep'
    CHECK (excess_cash_mode IN ('reinvest', 'mm_sweep', 'distribute')),
  building_valuation DOUBLE PRECISION NOT NULL DEFAULT 215000000,
  bonus_irr_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  bonus_max_years INTEGER NOT NULL DEFAULT 12,
  bonus_yield_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.04,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unit_types (
  id BIGSERIAL PRIMARY KEY,
  unit_letter TEXT NOT NULL UNIQUE,
  ownership_pct DOUBLE PRECISION NOT NULL,
  sqft INTEGER NOT NULL,
  beds INTEGER NOT NULL,
  base_hoa DOUBLE PRECISION NOT NULL,
  is_special INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entities (
  id BIGSERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS building_units (
  id BIGSERIAL PRIMARY KEY,
  floor INTEGER NOT NULL,
  unit_letter TEXT NOT NULL,
  unit_number TEXT NOT NULL UNIQUE,
  unit_type_id BIGINT REFERENCES unit_types(id),
  is_fund_owned INTEGER NOT NULL DEFAULT 0,
  consensus_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (consensus_status IN ('signed', 'unsigned', 'unknown')),
  listing_agreement TEXT NOT NULL DEFAULT 'unknown'
    CHECK (listing_agreement IN ('signed', 'unsigned', 'unknown')),
  resident_name TEXT,
  resident_type TEXT CHECK (resident_type IN ('residential', 'investment')),
  notes TEXT,
  owner_name TEXT,
  owner_email TEXT,
  owner_phone TEXT,
  owner_company TEXT
);

CREATE TABLE IF NOT EXISTS portfolio_units (
  id BIGSERIAL PRIMARY KEY,
  building_unit_id BIGINT NOT NULL REFERENCES building_units(id),
  entity_id BIGINT REFERENCES entities(id),
  purchase_date DATE NOT NULL,
  purchase_price DOUBLE PRECISION NOT NULL,
  purchase_price_psf DOUBLE PRECISION NOT NULL,
  closing_costs DOUBLE PRECISION NOT NULL DEFAULT 0,
  transfer_tax DOUBLE PRECISION NOT NULL DEFAULT 0,
  inspection_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_acquisition_cost DOUBLE PRECISION NOT NULL,
  monthly_rent DOUBLE PRECISION NOT NULL DEFAULT 0,
  monthly_hoa DOUBLE PRECISION NOT NULL,
  hoa_is_recurring INTEGER NOT NULL DEFAULT 1,
  hoa_reconcile_ref TEXT,
  monthly_insurance DOUBLE PRECISION NOT NULL DEFAULT 0,
  insurance_payment_month INTEGER NOT NULL DEFAULT 1,
  insurance_payment_day INTEGER NOT NULL DEFAULT 1,
  insurance_is_recurring INTEGER NOT NULL DEFAULT 0,
  insurance_reconcile_ref TEXT,
  monthly_tax DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_payment_month INTEGER NOT NULL DEFAULT 1,
  tax_payment_day INTEGER NOT NULL DEFAULT 1,
  tax_is_recurring INTEGER NOT NULL DEFAULT 0,
  tax_reconcile_ref TEXT,
  scenario_id BIGINT REFERENCES fund_assumptions(id)
);

CREATE TABLE IF NOT EXISTS tenants (
  id BIGSERIAL PRIMARY KEY,
  portfolio_unit_id BIGINT NOT NULL REFERENCES portfolio_units(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  lease_start DATE,
  lease_end DATE,
  rent_due_day INTEGER NOT NULL DEFAULT 1,
  monthly_rent DOUBLE PRECISION NOT NULL,
  security_deposit DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'month_to_month', 'vacated')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS unit_renovations (
  id BIGSERIAL PRIMARY KEY,
  portfolio_unit_id BIGINT NOT NULL REFERENCES portfolio_units(id),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed')),
  estimated_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  actual_cost DOUBLE PRECISION,
  expense_source TEXT NOT NULL DEFAULT 'bank'
    CHECK (expense_source IN ('bank', 'credit_card', 'wire', 'cash', 'other')),
  reconcile_ref TEXT,
  reconciled INTEGER NOT NULL DEFAULT 0,
  contractor TEXT,
  start_date DATE,
  end_date DATE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS lp_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  entity_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  commitment DOUBLE PRECISION NOT NULL,
  called_capital DOUBLE PRECISION NOT NULL DEFAULT 0,
  distributions DOUBLE PRECISION NOT NULL DEFAULT 0,
  ownership_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  onboarded_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'inactive')),
  wire_instructions TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS capital_calls (
  id BIGSERIAL PRIMARY KEY,
  call_number INTEGER NOT NULL,
  total_amount DOUBLE PRECISION NOT NULL,
  call_date DATE NOT NULL,
  due_date DATE NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partially_received', 'completed')),
  letter_template TEXT,
  custom_email_subject TEXT,
  custom_email_body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capital_call_items (
  id BIGSERIAL PRIMARY KEY,
  capital_call_id BIGINT NOT NULL REFERENCES capital_calls(id),
  lp_account_id BIGINT NOT NULL REFERENCES lp_accounts(id),
  amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'received', 'overdue')),
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  received_amount DOUBLE PRECISION,
  receipt_reference TEXT,
  bank_txn_id TEXT,
  email_sent INTEGER NOT NULL DEFAULT 0,
  sms_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  parent_id BIGINT NOT NULL,
  parent_type TEXT NOT NULL
    CHECK (parent_type IN ('entity', 'unit', 'tenant', 'renovation', 'lp', 'fund')),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  requires_signature INTEGER NOT NULL DEFAULT 0,
  signed_at TIMESTAMPTZ,
  uploaded_by TEXT
);


CREATE TABLE IF NOT EXISTS bank_uploads (
  id BIGSERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  upload_date TIMESTAMPTZ DEFAULT NOW(),
  file_type TEXT NOT NULL CHECK (file_type IN ('csv', 'ofx', 'pdf', 'manual', 'xls', 'xlsx')),
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'parsed'
    CHECK (status IN ('parsed', 'reconciled', 'error', 'pending_review')),
  file_path TEXT,
  file_type_check TEXT,
  file_sha256 TEXT,
  uploaded_by TEXT
);

-- If the table already exists, ensure new columns are present.
ALTER TABLE bank_uploads ADD COLUMN IF NOT EXISTS file_sha256 TEXT;
ALTER TABLE bank_uploads ADD COLUMN IF NOT EXISTS uploaded_by TEXT;

CREATE TABLE IF NOT EXISTS bank_transactions (
  id BIGSERIAL PRIMARY KEY,
  bank_upload_id BIGINT REFERENCES bank_uploads(id),
  bank_account_id BIGINT,
  date DATE NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  description TEXT,
  source_file TEXT,
  statement_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS bank_account_id BIGINT;
ALTER TABLE bank_uploads ADD COLUMN IF NOT EXISTS bank_account_id BIGINT;

CREATE TABLE IF NOT EXISTS accounting_periods (
  month TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  closed_by TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ DEFAULT NOW(),
  actor_email TEXT,
  actor_user_id BIGINT,
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT,
  request_id TEXT,
  ip TEXT,
  before_json TEXT,
  after_json TEXT
);
CREATE TABLE IF NOT EXISTS document_signing_links (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id),
  token_hash TEXT NOT NULL UNIQUE,
  is_single_use INTEGER NOT NULL DEFAULT 1,
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS document_signatures (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id),
  signing_link_id BIGINT REFERENCES document_signing_links(id),
  signer_name TEXT NOT NULL,
  signer_email TEXT,
  signer_company TEXT,
  signer_title TEXT,
  signature_text TEXT NOT NULL,
  investor_gate_password_hash TEXT,
  investor_gate_password_expires_at TIMESTAMPTZ,
  investor_gate_password_used_at TIMESTAMPTZ,
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  signed_ip TEXT,
  signed_user_agent TEXT,
  original_pdf_sha256 TEXT NOT NULL,
  executed_file_path TEXT,
  executed_pdf_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS cash_flow_actuals (
  id BIGSERIAL PRIMARY KEY,
  bank_transaction_id BIGINT REFERENCES bank_transactions(id),
  portfolio_unit_id BIGINT REFERENCES portfolio_units(id),
  entity_id BIGINT REFERENCES entities(id),
  unit_renovation_id BIGINT REFERENCES unit_renovations(id),
  lp_account_id BIGINT REFERENCES lp_accounts(id),
  capital_call_item_id BIGINT REFERENCES capital_call_items(id),
  date DATE NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  category TEXT NOT NULL
    CHECK (category IN ('rent', 'hoa', 'insurance', 'tax', 'repair', 'capital_call', 'distribution', 'management_fee', 'fund_expense', 'other')),
  description TEXT,
  source_file TEXT,
  statement_ref TEXT,
  receipt_document_id BIGINT REFERENCES documents(id),
  reconciled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS learned_mappings (
  id BIGSERIAL PRIMARY KEY,
  description_pattern TEXT NOT NULL,
  portfolio_unit_id BIGINT NOT NULL REFERENCES portfolio_units(id),
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id BIGSERIAL PRIMARY KEY,
  building_unit_id BIGINT REFERENCES building_units(id),
  unit_number TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('zillow', 'realtor', 'redfin', 'mls', 'manual')),
  source_url TEXT,
  asking_price DOUBLE PRECISION NOT NULL,
  price_psf DOUBLE PRECISION NOT NULL,
  listed_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'sold', 'removed')),
  implied_building_value DOUBLE PRECISION,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fred_data (
  id BIGSERIAL PRIMARY KEY,
  series_id TEXT NOT NULL,
  date DATE NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(series_id, date)
);

CREATE TABLE IF NOT EXISTS capital_transactions (
  id BIGSERIAL PRIMARY KEY,
  lp_account_id BIGINT NOT NULL REFERENCES lp_accounts(id),
  capital_call_item_id BIGINT REFERENCES capital_call_items(id),
  type TEXT NOT NULL CHECK (type IN ('call', 'distribution')),
  amount DOUBLE PRECISION NOT NULL,
  date DATE NOT NULL,
  quarter TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS tenant_communications (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK (type IN ('email', 'sms')),
  subject TEXT,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('draft', 'sent', 'failed', 'delivered')),
  template_name TEXT
);

CREATE TABLE IF NOT EXISTS rent_reminder_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  days_late_threshold INTEGER NOT NULL DEFAULT 5,
  subject_template TEXT NOT NULL DEFAULT 'Rent Reminder: {{unit_number}} is {{days_late}} day(s) past due',
  body_template TEXT NOT NULL DEFAULT 'Hi {{tenant_name}},\n\nOur records show rent for {{period_label}} is still outstanding.\n\nAmount due: {{amount_due}}\nAmount received: {{amount_paid}}\nOutstanding: {{amount_outstanding}}\n\nPlease submit payment as soon as possible.\n\nThank you.',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rent_reminder_runs (
  id BIGSERIAL PRIMARY KEY,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  checked_count INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_building_units_floor ON building_units(floor);
CREATE INDEX IF NOT EXISTS idx_building_units_fund_owned ON building_units(is_fund_owned);
CREATE INDEX IF NOT EXISTS idx_portfolio_units_building ON portfolio_units(building_unit_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_upload ON bank_transactions(bank_upload_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_portfolio_units_entity ON portfolio_units(entity_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_unit ON cash_flow_actuals(portfolio_unit_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_entity ON cash_flow_actuals(entity_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_bank_txn ON cash_flow_actuals(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_lp ON cash_flow_actuals(lp_account_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_call_item ON cash_flow_actuals(capital_call_item_id);
CREATE INDEX IF NOT EXISTS idx_cash_flow_actuals_date ON cash_flow_actuals(date);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_fred_data_series ON fred_data(series_id, date);
CREATE INDEX IF NOT EXISTS idx_capital_call_items_call ON capital_call_items(capital_call_id);
CREATE INDEX IF NOT EXISTS idx_capital_call_items_lp ON capital_call_items(lp_account_id);
CREATE INDEX IF NOT EXISTS idx_capital_transactions_lp ON capital_transactions(lp_account_id);
CREATE INDEX IF NOT EXISTS idx_capital_transactions_date ON capital_transactions(date);
CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_document_signing_links_document ON document_signing_links(document_id);
CREATE INDEX IF NOT EXISTS idx_document_signatures_document ON document_signatures(document_id);
CREATE INDEX IF NOT EXISTS idx_tenants_unit ON tenants(portfolio_unit_id);
CREATE INDEX IF NOT EXISTS idx_tenant_comms_tenant ON tenant_communications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_learned_mappings_pattern ON learned_mappings(description_pattern);
`;
