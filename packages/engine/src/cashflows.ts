/**
 * Quarterly cash flow projection engine.
 * Generates the full fund-life cash flow table matching the Excel V3 structure.
 */

import type { FundAssumptions, QuarterlyCashFlow } from '@brickell/shared';
import { createDebtFacility, generateAmortizationSchedule } from './leverage';
import { routeExcessCash, calcMMIncome } from './excess-cash';

export interface AcquisitionSchedule {
  quarter: number;         // 0-based quarter index
  units: number;           // Number of units to acquire this quarter
  costPerUnit: number;     // Average cost per unit
}

export interface CashFlowInput {
  assumptions: FundAssumptions;
  acquisitions: AcquisitionSchedule[];
  // Per-unit operating assumptions (overridable per unit)
  baseMonthlyRent: number;       // Default $2,800/month
  baseMonthlyHOA: number;        // Default $1,400/month
  baseAnnualInsurance: number;   // Annual lump-sum insurance per unit
  baseAnnualTax: number;         // Annual lump-sum property tax per unit
  annualFundOpex: number;        // Default $75,000/year
  // Real ownership data from portfolio (sum of ownership_pct for all owned units)
  // e.g., 0.05 means fund owns 5% of the building
  totalOwnershipPct?: number;
}

/**
 * Get the date string for a given quarter index.
 * Q0 = Q1 2026, Q1 = Q2 2026, etc.
 */
function quarterDate(quarterIndex: number, startYear: number = 2026): string {
  const year = startYear + Math.floor(quarterIndex / 4);
  const q = (quarterIndex % 4) + 1;
  const month = (q - 1) * 3 + 1; // 1, 4, 7, 10
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function quarterLabel(quarterIndex: number, startYear: number = 2026): string {
  const year = startYear + Math.floor(quarterIndex / 4);
  const q = (quarterIndex % 4) + 1;
  return `Q${q} ${year}`;
}

/**
 * Apply annual growth rate compounded quarterly.
 */
function applyGrowth(baseAmount: number, annualRate: number, quarterIndex: number): number {
  const years = quarterIndex / 4;
  return baseAmount * Math.pow(1 + annualRate, years);
}

/**
 * Generate the complete quarterly cash flow projection.
 */
export function projectCashFlows(input: CashFlowInput): QuarterlyCashFlow[] {
  const { assumptions, acquisitions, annualFundOpex } = input;
  const totalQuarters = assumptions.fundTermYears * 4;
  const refiQuarter = assumptions.refiEnabled ? (assumptions.refiYear - 1) * 4 : Infinity;

  const cashFlows: QuarterlyCashFlow[] = [];
  let cumulativeUnits = 0;
  let cumulativeCashFlow = 0;
  let mmBalance = 0;
  let debtBalance = 0;
  let debtSchedule: ReturnType<typeof generateAmortizationSchedule> = [];
  let debtQuarterOffset = 0;
  let totalCapitalCalled = 0;

  // Build acquisition lookup (supports multiple events per quarter)
  const acqMap = new Map<number, { units: number; cost: number }>();
  for (const acq of acquisitions) {
    const prev = acqMap.get(acq.quarter) ?? { units: 0, cost: 0 };
    acqMap.set(acq.quarter, {
      units: prev.units + acq.units,
      cost: prev.cost + (acq.units * acq.costPerUnit),
    });
  }
  // Reinvested acquisitions are scheduled into future quarters.
  const reinvestMap = new Map<number, { units: number; cost: number }>();

  for (let q = 0; q < totalQuarters; q++) {
    const isExitQuarter = q === totalQuarters - 1;
    const plannedAcq = acqMap.get(q);
    const reinvestAcq = reinvestMap.get(q);

    // --- Acquisitions ---
    const plannedUnits = plannedAcq?.units ?? 0;
    const reinvestUnits = reinvestAcq?.units ?? 0;
    const unitsThisQ = plannedUnits + reinvestUnits;
    const plannedAcquisitionCost = plannedAcq?.cost ?? 0;
    const reinvestAcquisitionCost = reinvestAcq?.cost ?? 0;
    const acquisitionCost = plannedAcquisitionCost + reinvestAcquisitionCost;
    cumulativeUnits += unitsThisQ;

    // --- Capital Calls (delayed draw) ---
    // Capital is called for scheduled acquisitions only; reinvested purchases are
    // funded from routed excess cash.
    const capitalCall = plannedAcquisitionCost;
    totalCapitalCalled += capitalCall;

    // --- Operating Income (per unit, with growth) ---
    const rentPerUnit = applyGrowth(input.baseMonthlyRent, assumptions.rentGrowthPct, q) * 3; // Quarterly
    const hoaPerUnit = applyGrowth(input.baseMonthlyHOA, assumptions.hoaGrowthPct, q) * 3;
    // Insurance and property tax are paid annually, not monthly cash flow.
    // Model them as an annual lump in Q1 each year.
    const isAnnualExpenseQuarter = (q % 4) === 0;
    const insPerUnit = isAnnualExpenseQuarter
      ? applyGrowth(input.baseAnnualInsurance, assumptions.hoaGrowthPct, q)
      : 0;
    const taxPerUnit = isAnnualExpenseQuarter
      ? applyGrowth(input.baseAnnualTax, assumptions.hoaGrowthPct, q)
      : 0;

    const grossRent = cumulativeUnits * rentPerUnit;
    const vacancy = grossRent * assumptions.vacancyPct;
    const netRent = grossRent - vacancy;
    const hoaExpense = cumulativeUnits * hoaPerUnit;
    const insuranceExpense = cumulativeUnits * insPerUnit;
    const taxExpense = cumulativeUnits * taxPerUnit;
    const operatingExpense = annualFundOpex / 4;
    const noi = netRent - hoaExpense - insuranceExpense - taxExpense - operatingExpense;

    // --- Management Fees ---
    let mgmtFee = 0;
    const yearIndex = Math.floor(q / 4);
    if (yearIndex < assumptions.investmentPeriodYears) {
      mgmtFee = (assumptions.fundSize * assumptions.mgmtFeeInvestPct) / 4;
    } else {
      mgmtFee = (totalCapitalCalled * assumptions.mgmtFeePostPct) / 4;
    }
    if (assumptions.mgmtFeeWaiver) mgmtFee = 0;

    // --- Debt Facility ---
    let debtDrawdown = 0;
    let debtRepayment = 0;
    let interestExpense = 0;

    if (assumptions.refiEnabled && q === refiQuarter) {
      // Activate debt facility
      const avgUnitCost = unitsThisQ > 0 ? (acquisitionCost / unitsThisQ) : 500_000;
      const portfolioValue = cumulativeUnits * avgUnitCost;
      const facility = createDebtFacility(
        portfolioValue,
        assumptions.refiLTV,
        assumptions.refiRate,
        assumptions.refiTermYears,
        assumptions.refiCostPct
      );
      debtDrawdown = facility.netProceeds;
      debtBalance = facility.principal;
      debtQuarterOffset = q;

      // Generate amortization from this point
      debtSchedule = generateAmortizationSchedule(
        facility.principal,
        assumptions.refiRate,
        assumptions.refiTermYears,
        totalQuarters - q
      );
    }

    if (debtBalance > 0 && q > refiQuarter && debtSchedule.length > 0) {
      const schedIdx = q - debtQuarterOffset - 1;
      if (schedIdx >= 0 && schedIdx < debtSchedule.length) {
        debtRepayment = debtSchedule[schedIdx].principalPayment;
        interestExpense = debtSchedule[schedIdx].interestPayment;
        debtBalance = debtSchedule[schedIdx].endingBalance;
      }
    }
    // Guard: ensure we do not skip a final debt service line at exit.
    if (
      isExitQuarter &&
      debtBalance > 0 &&
      debtRepayment === 0 &&
      q >= refiQuarter &&
      debtSchedule.length > 0
    ) {
      const schedIdx = Math.min(
        Math.max(q - debtQuarterOffset - 1, 0),
        debtSchedule.length - 1
      );
      debtRepayment = debtSchedule[schedIdx].principalPayment;
      interestExpense = debtSchedule[schedIdx].interestPayment;
      debtBalance = debtSchedule[schedIdx].endingBalance;
    }

    // --- Money Market ---
    const mmIncome = calcMMIncome(mmBalance, assumptions.mmRate);

    // --- Excess Cash Routing ---
    const cashBeforeRouting = noi - mgmtFee + debtDrawdown - debtRepayment - interestExpense + mmIncome - acquisitionCost;
    let mmDeposit = 0;
    let mmWithdrawal = 0;
    let lpDistributions = 0;

    if (!isExitQuarter && cashBeforeRouting > 0) {
      const routed = routeExcessCash(cashBeforeRouting, assumptions.excessCashMode);
      mmDeposit = routed.mmDepositAmount;
      lpDistributions = routed.distributionAmount;
      if (routed.reinvestAmount > 0 && routed.unitsAcquirable > 0 && q + 1 < totalQuarters) {
        const next = reinvestMap.get(q + 1) ?? { units: 0, cost: 0 };
        reinvestMap.set(q + 1, {
          units: next.units + routed.unitsAcquirable,
          cost: next.cost + routed.reinvestAmount,
        });
      }
    } else if (cashBeforeRouting < 0) {
      // Draw from MM to cover shortfall
      mmWithdrawal = Math.min(mmBalance, Math.abs(cashBeforeRouting));
    }

    mmBalance += mmDeposit - mmWithdrawal + mmIncome;

    // --- Exit (final quarter) ---
    let grossSaleProceeds = 0;
    let mmLiquidation = 0;

    if (isExitQuarter) {
      // Land value at exit = land value (no growth — land IS the exit value)
      const exitLandValue = assumptions.landValueTotal;

      // Fund's share = real ownership % if provided, else estimate from unit count
      let fundOwnershipPct: number;
      if (input.totalOwnershipPct != null && input.totalOwnershipPct > 0) {
        // Use real summed ownership % from portfolio (decimal, e.g. 0.05 = 5%)
        fundOwnershipPct = input.totalOwnershipPct;
      } else {
        // Fallback: estimate from unit count (361 total units in building)
        const avgOwnershipPctPerUnit = 1.0 / 361; // ~0.00277 per unit
        fundOwnershipPct = cumulativeUnits * avgOwnershipPctPerUnit;
      }
      grossSaleProceeds = exitLandValue * fundOwnershipPct;

      // Liquidate money market
      mmLiquidation = mmBalance;
      mmBalance = 0;
    }

    // --- Net Cash Flow ---
    const netCF = -capitalCall + noi - mgmtFee + debtDrawdown - debtRepayment - interestExpense
      + grossSaleProceeds + mmLiquidation - lpDistributions;
    cumulativeCashFlow += netCF;

    cashFlows.push({
      quarter: quarterLabel(q),
      date: quarterDate(q),
      quarterIndex: q,
      capitalCalls: capitalCall,
      capitalReturns: 0,
      unitsAcquired: unitsThisQ,
      acquisitionCost,
      cumulativeUnits,
      grossRent,
      vacancy,
      netRent,
      hoaExpense,
      insuranceExpense,
      taxExpense,
      operatingExpense,
      netOperatingIncome: noi,
      debtDrawdown,
      debtRepayment,
      interestExpense,
      debtBalance,
      excessCash: Math.max(0, cashBeforeRouting),
      mmDeposit,
      mmWithdrawal,
      mmBalance,
      mmIncome,
      lpDistributions,
      mgmtFee,
      grossSaleProceeds,
      mmLiquidation,
      netCashFlow: netCF,
      cumulativeCashFlow,
    });
  }

  return cashFlows;
}

/**
 * Generate a default acquisition schedule based on fund assumptions.
 * Deploys capital evenly over the investment period.
 */
export function generateDefaultAcquisitionSchedule(
  assumptions: FundAssumptions,
  costPerUnit: number = 500_000
): AcquisitionSchedule[] {
  const totalUnits = Math.floor(assumptions.fundSize / costPerUnit);
  const investmentQuarters = assumptions.investmentPeriodYears * 4;
  const unitsPerQuarter = Math.floor(totalUnits / investmentQuarters);
  const remainder = totalUnits % investmentQuarters;

  const schedule: AcquisitionSchedule[] = [];
  for (let q = 0; q < investmentQuarters; q++) {
    const units = unitsPerQuarter + (q < remainder ? 1 : 0);
    if (units > 0) {
      schedule.push({ quarter: q, units, costPerUnit });
    }
  }

  return schedule;
}
