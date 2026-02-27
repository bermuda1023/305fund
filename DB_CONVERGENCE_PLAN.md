# Postgres-Primary Convergence Plan

This document defines the migration path from the current `sqlite-bridge` runtime to a `postgres-primary` runtime for critical financial flows.

## Current State

- Runtime write/read path is SQLite.
- Persistence bridge syncs SQLite <-> Postgres.
- Mutation barrier (`flushPostgresPush`) reduces, but does not eliminate, dual-database risk.

## Target State

- Postgres is the primary runtime database for writes and reads.
- SQLite is removed from production write paths.
- Bridge is retired after a verification window.

## Runtime Mode Signal

- `DB_RUNTIME_MODE=sqlite-bridge` (default)
- `DB_RUNTIME_MODE=postgres-primary`

Mode is surfaced in:
- `GET /api/health`
- `GET /api/diag/db`

This enables controlled cutover by environment.

## Critical Flow Priority (in order)

1. LP capital calls + receipts
2. Cash actuals and reconciliation updates
3. LP account onboarding/remove/reactivation
4. Documents + signatures metadata

## Milestones

### Milestone 0 - Observability and Safety (completed)

- [x] Bridge health surfaced with queue/error/timestamp details.
- [x] Startup guardrail added for bridge connectivity in persistent environments.
- [x] Runtime mode (`DB_RUNTIME_MODE`) exposed in health diagnostics.

### Milestone 1 - Postgres Repositories for Critical Routes

- [ ] Introduce Postgres repository functions for critical flows while preserving API contract.
- [ ] Add parity tests that compare SQLite-backed and Postgres-backed outcomes for the same fixture data.
- [ ] Add feature flags per route group (read/write).

### Milestone 2 - Dual-Write Verification Window

- [ ] Enable Postgres writes + SQLite shadow writes.
- [ ] Reconciliation job verifies row counts and value checksums per critical table.
- [ ] Block promotion if divergence exceeds thresholds.

### Milestone 3 - Read Cutover

- [ ] Flip critical reads to Postgres-primary in production.
- [ ] Keep SQLite fallback disabled by default and available only behind emergency flag.

### Milestone 4 - Bridge Retirement

- [ ] Remove bridge sync scripts and runtime bridge calls.
- [ ] Remove SQLite production dependency and deployment artifacts.
- [ ] Keep SQLite only for local/dev if still needed.

## Acceptance Criteria

- No critical flow writes depend on bridge synchronization for durability.
- Integration tests cover auth + LP lifecycle + capital-call receipt path against Postgres runtime.
- Health endpoints report stable Postgres primary mode with zero bridge dependency for critical flows.
