/**
 * Database seed script.
 * Seeds unit types, building units, default assumptions, and initial GP user.
 * Run: pnpm --filter @brickell/server db:seed
 */

import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { getDb, initDb, closeDb } from './database';
import { ALL_UNIT_TYPES, generateBuildingUnits, DEFAULT_ASSUMPTIONS } from '@brickell/shared';

function seed() {
  const db = getDb();
  initDb();

  console.log('Seeding database...');

  // Wrap in transaction for atomicity
  const seedAll = db.transaction(() => {
    // 1. Seed unit types
    console.log(`Seeding ${ALL_UNIT_TYPES.length} unit types...`);
    const insertUnitType = db.prepare(`
      INSERT OR IGNORE INTO unit_types (unit_letter, ownership_pct, sqft, beds, base_hoa, is_special)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const ut of ALL_UNIT_TYPES) {
      insertUnitType.run(ut.unitLetter, ut.ownershipPct, ut.sqft, ut.beds, ut.baseHOA, ut.isSpecial ? 1 : 0);
    }

    // 2. Seed building units
    const buildingUnits = generateBuildingUnits();
    console.log(`Seeding ${buildingUnits.length} building units...`);

    const insertBuildingUnit = db.prepare(`
      INSERT OR IGNORE INTO building_units (floor, unit_letter, unit_number, unit_type_id)
      VALUES (?, ?, ?, ?)
    `);

    // Build unit_type lookup
    const unitTypeRows = db.prepare('SELECT id, unit_letter FROM unit_types').all() as Array<{ id: number; unit_letter: string }>;
    const unitTypeMap = new Map<string, number>();
    for (const row of unitTypeRows) {
      unitTypeMap.set(row.unit_letter, row.id);
    }

    for (const bu of buildingUnits) {
      // Find matching unit type
      let typeId = unitTypeMap.get(bu.unitLetter);
      if (!typeId) {
        // For standard floors, strip the floor number to get the letter
        const letter = bu.unitLetter.replace(/^\d+/, '');
        typeId = unitTypeMap.get(letter);
      }
      if (!typeId) {
        console.warn(`No unit type found for ${bu.unitNumber} (letter: ${bu.unitLetter}), skipping`);
        continue;
      }
      insertBuildingUnit.run(bu.floor, bu.unitLetter, bu.unitNumber, typeId);
    }

    // 3. Seed default fund assumptions
    console.log('Seeding default fund assumptions...');
    const a = DEFAULT_ASSUMPTIONS;
    db.prepare(`
      INSERT OR IGNORE INTO fund_assumptions (
        name, is_active, fund_size, fund_term_years, investment_period_years,
        gp_coinvest_pct, mgmt_fee_invest_pct, mgmt_fee_post_pct, mgmt_fee_waiver,
        pref_return_pct, catchup_pct,
        tier1_split_lp, tier1_split_gp, tier2_hurdle_irr, tier2_split_lp, tier2_split_gp,
        tier3_hurdle_irr, tier3_split_lp, tier3_split_gp,
        refi_enabled, refi_year, refi_ltv, refi_rate, refi_term_years, refi_cost_pct,
        rent_growth_pct, hoa_growth_pct, tax_growth_pct, vacancy_pct,
        present_day_land_value,
        land_value_total, land_growth_pct, land_psf,
        mm_rate, excess_cash_mode, building_valuation,
        bonus_irr_threshold, bonus_max_years, bonus_yield_threshold
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      a.name, a.isActive ? 1 : 0, a.fundSize, a.fundTermYears, a.investmentPeriodYears,
      a.gpCoinvestPct, a.mgmtFeeInvestPct, a.mgmtFeePostPct, a.mgmtFeeWaiver ? 1 : 0,
      a.prefReturnPct, a.catchupPct,
      a.tier1SplitLP, a.tier1SplitGP, a.tier2HurdleIRR, a.tier2SplitLP, a.tier2SplitGP,
      a.tier3HurdleIRR, a.tier3SplitLP, a.tier3SplitGP,
      a.refiEnabled ? 1 : 0, a.refiYear, a.refiLTV, a.refiRate, a.refiTermYears, a.refiCostPct,
      a.rentGrowthPct, a.hoaGrowthPct, a.taxGrowthPct, a.vacancyPct,
      a.presentDayLandValue,
      a.landValueTotal, a.landGrowthPct, a.landPSF,
      a.mmRate, a.excessCashMode, a.buildingValuation,
      a.bonusIRRThreshold, a.bonusMaxYears, a.bonusYieldThreshold
    );

    // 4. Seed default GP user
    console.log('Seeding default GP user...');
    const gpHash = bcrypt.hashSync('admin', 10);
    db.prepare(`
      INSERT OR IGNORE INTO users (email, password_hash, role, name)
      VALUES (?, ?, 'gp', ?)
    `).run('admin+gp@local', gpHash, 'Admin GP');

    // 5. Count results
    const unitTypeCount = (db.prepare('SELECT COUNT(*) as c FROM unit_types').get() as any).c;
    const buildingUnitCount = (db.prepare('SELECT COUNT(*) as c FROM building_units').get() as any).c;
    const assumptionCount = (db.prepare('SELECT COUNT(*) as c FROM fund_assumptions').get() as any).c;
    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;

    console.log(`\nSeed complete:`);
    console.log(`  Unit types: ${unitTypeCount}`);
    console.log(`  Building units: ${buildingUnitCount}`);
    console.log(`  Fund assumptions: ${assumptionCount}`);
    console.log(`  Users: ${userCount}`);
  });

  seedAll();
  closeDb();
}

seed();
