/**
 * GP Economics calculator.
 * Management fees, carried interest, co-invest returns, bonus triggers.
 */

import type { FundAssumptions, GPEconomics, QuarterlyCashFlow, WaterfallResult } from '@brickell/shared';

export interface GPEconomicsInput {
  assumptions: FundAssumptions;
  waterfall: WaterfallResult;
  totalNOI: number;
  actualHoldYears: number;
  actualYield: number;      // Cash yield in exit year
  fundIRR: number;
  capitalDeployed: number;
  numQuartersInvesting: number;
  numQuartersPost: number;
  cashFlows?: QuarterlyCashFlow[];
}

/**
 * Calculate management fees over the fund life.
 */
export function calcManagementFees(
  assumptions: FundAssumptions,
  numQuartersInvesting: number,
  numQuartersPost: number,
  capitalDeployed: number,
  cashFlows?: QuarterlyCashFlow[]
): { total: number; byYear: number[] } {
  if (cashFlows && cashFlows.length > 0) {
    const byYearMap = new Map<number, number>();
    for (const row of cashFlows) {
      const year = Number(row.date.slice(0, 4));
      byYearMap.set(year, (byYearMap.get(year) ?? 0) + (row.mgmtFee ?? 0));
    }
    const years = Array.from(byYearMap.keys()).sort((a, b) => a - b);
    const byYear = years.map((y) => byYearMap.get(y) ?? 0);
    return { total: byYear.reduce((sum, f) => sum + f, 0), byYear };
  }

  const totalYears = Math.ceil((numQuartersInvesting + numQuartersPost) / 4);
  const byYear: number[] = [];

  for (let year = 0; year < totalYears; year++) {
    const quartersThisYear = 4;
    let fee = 0;

    if (year < assumptions.investmentPeriodYears) {
      // During investment period: fee on committed capital
      fee = assumptions.fundSize * assumptions.mgmtFeeInvestPct;
    } else {
      // Post-deployment: fee on invested (deployed) capital
      fee = capitalDeployed * assumptions.mgmtFeePostPct;
    }

    if (assumptions.mgmtFeeWaiver) {
      fee = 0; // Waived — offset against carry
    }

    byYear.push(fee);
  }

  return {
    total: byYear.reduce((sum, f) => sum + f, 0),
    byYear,
  };
}

/**
 * Calculate full GP economics.
 */
export function calcGPEconomics(input: GPEconomicsInput): GPEconomics {
  const { assumptions, waterfall, totalNOI, actualHoldYears, actualYield, fundIRR } = input;

  // Management fees
  const fees = calcManagementFees(
    assumptions,
    input.numQuartersInvesting,
    input.numQuartersPost,
    input.capitalDeployed,
    input.cashFlows
  );

  // GP co-invest
  const gpCoinvest = assumptions.fundSize * assumptions.gpCoinvestPct;
  const lpCapital = assumptions.fundSize - gpCoinvest;

  // Extract carry from waterfall tiers
  let carryCatchup = 0;
  let carryTier1 = 0;
  let carryTier2 = 0;
  let carryTier3 = 0;

  for (const tier of waterfall.tiers) {
    if (tier.tierIndex === 4) {
      carryCatchup = tier.gpAmount;
    } else if (tier.tierIndex === 5) {
      carryTier1 = tier.gpAmount;
    } else if (tier.tierIndex === 6) {
      carryTier2 = tier.gpAmount;
    } else if (tier.tierIndex >= 7) {
      carryTier3 = tier.gpAmount;
    }
  }

  const carryTotal = carryCatchup + carryTier1 + carryTier2 + carryTier3;

  // GP co-invest return: pro-rata share of return of capital + pref + splits
  const gpCoinvestPctOfTotal = gpCoinvest / (lpCapital + gpCoinvest);
  // GP gets co-invest back from Return of Capital tier
  const gpROC = waterfall.tiers.find(t => t.name === 'Return of Capital')?.gpAmount ?? 0;
  // Plus pro-rata share of NOI
  const gpNOIShare = totalNOI * gpCoinvestPctOfTotal;
  const coinvestReturn = gpROC + gpNOIShare;

  const totalGPComp = fees.total + carryTotal + coinvestReturn;

  // GP MOIC on co-invest
  const gpMOIC = gpCoinvest > 0 ? coinvestReturn / gpCoinvest : 0;

  // Bonus triggers
  const bonusTriggers = {
    irrMet: fundIRR >= assumptions.bonusIRRThreshold,
    holdMet: actualHoldYears <= assumptions.bonusMaxYears,
    yieldMet: actualYield >= assumptions.bonusYieldThreshold,
    actualIRR: fundIRR,
    actualHoldYears,
    actualYield,
  };

  return {
    mgmtFeesTotal: fees.total,
    mgmtFeesByYear: fees.byYear,
    carryTotal,
    carryCatchup,
    carryTier1,
    carryTier2,
    carryTier3,
    coinvestReturn,
    coinvestCapital: gpCoinvest,
    totalGPComp,
    gpIRR: 0, // Will be calculated separately with GP-specific cash flows
    gpMOIC,
    bonusTriggers,
  };
}
