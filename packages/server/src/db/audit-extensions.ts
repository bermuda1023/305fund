export const SQLITE_AUDIT_EXTENSIONS = `
CREATE TABLE IF NOT EXISTS funds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_structure TEXT NOT NULL DEFAULT 'series_llc',
  tax_id TEXT,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entity_ledger_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES entities(id),
  fund_id INTEGER REFERENCES funds(id),
  tax_classification TEXT NOT NULL DEFAULT 'disregarded'
    CHECK (tax_classification IN ('disregarded', 'partnership', 'c_corp', 's_corp', 'trust')),
  entity_role TEXT NOT NULL DEFAULT 'series'
    CHECK (entity_role IN ('series', 'blocker', 'manager', 'other')),
  parent_entity_id INTEGER REFERENCES entities(id),
  is_blocker INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER REFERENCES funds(id),
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(fund_id, account_code)
);

CREATE TABLE IF NOT EXISTS posting_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL UNIQUE,
  debit_account_id INTEGER REFERENCES chart_of_accounts(id),
  credit_account_id INTEGER REFERENCES chart_of_accounts(id),
  memo_template TEXT
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fund_id INTEGER REFERENCES funds(id),
  entry_date DATE NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  entity_id INTEGER REFERENCES entities(id),
  description TEXT,
  posted_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type, source_id)
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  entity_id INTEGER REFERENCES entities(id),
  unit_id INTEGER REFERENCES portfolio_units(id),
  lp_account_id INTEGER REFERENCES lp_accounts(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS side_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lp_account_id INTEGER NOT NULL REFERENCES lp_accounts(id),
  pref_override_pct REAL,
  carry_override_gp_pct REAL,
  mgmt_fee_override_pct REAL,
  notice_days_override INTEGER,
  effective_from DATE,
  effective_to DATE,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS distribution_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_number INTEGER NOT NULL UNIQUE,
  event_date DATE NOT NULL,
  total_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid')),
  purpose TEXT,
  custom_email_subject TEXT,
  custom_email_body TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS distribution_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  distribution_event_id INTEGER NOT NULL REFERENCES distribution_events(id),
  lp_account_id INTEGER NOT NULL REFERENCES lp_accounts(id),
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'paid')),
  sent_at DATETIME,
  paid_at DATETIME,
  email_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tenant_ledger_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  entry_date DATE NOT NULL,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('charge', 'payment', 'credit', 'adjustment', 'fee')),
  amount REAL NOT NULL,
  description TEXT,
  source_type TEXT,
  source_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reserve_fund_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_date DATE NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('contribution', 'draw', 'special_assessment')),
  amount REAL NOT NULL,
  entity_id INTEGER REFERENCES entities(id),
  portfolio_unit_id INTEGER REFERENCES portfolio_units(id),
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS violation_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_unit_id INTEGER REFERENCES portfolio_units(id),
  tenant_id INTEGER REFERENCES tenants(id),
  violation_type TEXT NOT NULL,
  opened_at DATE NOT NULL,
  resolved_at DATE,
  fine_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'waived')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('operating', 'reserve', 'escrow', 'other')),
  institution_name TEXT,
  account_mask TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_unit_id INTEGER REFERENCES portfolio_units(id),
  entity_id INTEGER REFERENCES entities(id),
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  starts_on DATE NOT NULL,
  ends_on DATE,
  memo TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_generated_on DATE
);

CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  replaces_document_id INTEGER REFERENCES documents(id),
  version_label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investor_gate_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signature_id INTEGER,
  ip TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_role_scopes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK (scope IN ('accounting', 'operations', 'auditor')),
  granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, scope)
);

CREATE TABLE IF NOT EXISTS lease_renewal_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  lease_end DATE NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('60_day', '30_day', 'expired')),
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent'))
);
`;

export const POSTGRES_AUDIT_EXTENSIONS = `
CREATE TABLE IF NOT EXISTS funds (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_structure TEXT NOT NULL DEFAULT 'series_llc',
  tax_id TEXT,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS entity_ledger_profiles (
  id BIGSERIAL PRIMARY KEY,
  entity_id BIGINT NOT NULL REFERENCES entities(id),
  fund_id BIGINT REFERENCES funds(id),
  tax_classification TEXT NOT NULL DEFAULT 'disregarded'
    CHECK (tax_classification IN ('disregarded', 'partnership', 'c_corp', 's_corp', 'trust')),
  entity_role TEXT NOT NULL DEFAULT 'series'
    CHECK (entity_role IN ('series', 'blocker', 'manager', 'other')),
  parent_entity_id BIGINT REFERENCES entities(id),
  is_blocker INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id BIGSERIAL PRIMARY KEY,
  fund_id BIGINT REFERENCES funds(id),
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(fund_id, account_code)
);

CREATE TABLE IF NOT EXISTS posting_policies (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL UNIQUE,
  debit_account_id BIGINT REFERENCES chart_of_accounts(id),
  credit_account_id BIGINT REFERENCES chart_of_accounts(id),
  memo_template TEXT
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id BIGSERIAL PRIMARY KEY,
  fund_id BIGINT REFERENCES funds(id),
  entry_date DATE NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  entity_id BIGINT REFERENCES entities(id),
  description TEXT,
  posted_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_type, source_id)
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id BIGSERIAL PRIMARY KEY,
  journal_entry_id BIGINT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES chart_of_accounts(id),
  debit DOUBLE PRECISION NOT NULL DEFAULT 0,
  credit DOUBLE PRECISION NOT NULL DEFAULT 0,
  entity_id BIGINT REFERENCES entities(id),
  unit_id BIGINT REFERENCES portfolio_units(id),
  lp_account_id BIGINT REFERENCES lp_accounts(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS side_letters (
  id BIGSERIAL PRIMARY KEY,
  lp_account_id BIGINT NOT NULL REFERENCES lp_accounts(id),
  pref_override_pct DOUBLE PRECISION,
  carry_override_gp_pct DOUBLE PRECISION,
  mgmt_fee_override_pct DOUBLE PRECISION,
  notice_days_override INTEGER,
  effective_from DATE,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS distribution_events (
  id BIGSERIAL PRIMARY KEY,
  event_number INTEGER NOT NULL UNIQUE,
  event_date DATE NOT NULL,
  total_amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid')),
  purpose TEXT,
  custom_email_subject TEXT,
  custom_email_body TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS distribution_items (
  id BIGSERIAL PRIMARY KEY,
  distribution_event_id BIGINT NOT NULL REFERENCES distribution_events(id),
  lp_account_id BIGINT NOT NULL REFERENCES lp_accounts(id),
  amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'paid')),
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  email_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tenant_ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  entry_date DATE NOT NULL,
  entry_type TEXT NOT NULL
    CHECK (entry_type IN ('charge', 'payment', 'credit', 'adjustment', 'fee')),
  amount DOUBLE PRECISION NOT NULL,
  description TEXT,
  source_type TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reserve_fund_activities (
  id BIGSERIAL PRIMARY KEY,
  activity_date DATE NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('contribution', 'draw', 'special_assessment')),
  amount DOUBLE PRECISION NOT NULL,
  entity_id BIGINT REFERENCES entities(id),
  portfolio_unit_id BIGINT REFERENCES portfolio_units(id),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS violation_entries (
  id BIGSERIAL PRIMARY KEY,
  portfolio_unit_id BIGINT REFERENCES portfolio_units(id),
  tenant_id BIGINT REFERENCES tenants(id),
  violation_type TEXT NOT NULL,
  opened_at DATE NOT NULL,
  resolved_at DATE,
  fine_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'waived')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('operating', 'reserve', 'escrow', 'other')),
  institution_name TEXT,
  account_mask TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id BIGSERIAL PRIMARY KEY,
  portfolio_unit_id BIGINT REFERENCES portfolio_units(id),
  entity_id BIGINT REFERENCES entities(id),
  category TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  starts_on DATE NOT NULL,
  ends_on DATE,
  memo TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_generated_on DATE
);

CREATE TABLE IF NOT EXISTS document_versions (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id),
  replaces_document_id BIGINT REFERENCES documents(id),
  version_label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS investor_gate_attempts (
  id BIGSERIAL PRIMARY KEY,
  signature_id BIGINT,
  ip TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_role_scopes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK (scope IN ('accounting', 'operations', 'auditor')),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, scope)
);

CREATE TABLE IF NOT EXISTS lease_renewal_alerts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL REFERENCES tenants(id),
  lease_end DATE NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('60_day', '30_day', 'expired')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent'))
);
`;
