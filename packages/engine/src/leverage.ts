/**
 * Leverage / refinancing modeling.
 * Handles debt facility activation, amortization, and refi proceeds.
 */

export interface DebtFacility {
  principal: number;
  rate: number;            // Annual interest rate
  termYears: number;       // Amortization period
  monthlyPayment: number;
  totalInterest: number;
}

export interface QuarterlyDebtPayment {
  quarter: number;
  beginningBalance: number;
  principalPayment: number;
  interestPayment: number;
  totalPayment: number;
  endingBalance: number;
}

/**
 * Calculate monthly payment for a fixed-rate mortgage.
 */
export function calcMonthlyPayment(
  principal: number,
  annualRate: number,
  termYears: number
): number {
  const monthlyRate = annualRate / 12;
  const numPayments = termYears * 12;

  if (monthlyRate === 0) return principal / numPayments;

  return principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);
}

/**
 * Create a debt facility with calculated payment schedule.
 */
export function createDebtFacility(
  portfolioValue: number,
  ltv: number,
  rate: number,
  termYears: number,
  refiCostPct: number
): DebtFacility & { refiCosts: number; netProceeds: number } {
  const grossProceeds = portfolioValue * ltv;
  const refiCosts = grossProceeds * refiCostPct;
  const principal = grossProceeds;
  const monthlyPayment = calcMonthlyPayment(principal, rate, termYears);
  const totalInterest = (monthlyPayment * termYears * 12) - principal;

  return {
    principal,
    rate,
    termYears,
    monthlyPayment,
    totalInterest,
    refiCosts,
    netProceeds: grossProceeds - refiCosts,
  };
}

/**
 * Generate quarterly amortization schedule.
 */
export function generateAmortizationSchedule(
  principal: number,
  annualRate: number,
  termYears: number,
  numQuarters: number // How many quarters to project
): QuarterlyDebtPayment[] {
  const monthlyRate = annualRate / 12;
  const monthlyPayment = calcMonthlyPayment(principal, annualRate, termYears);

  const schedule: QuarterlyDebtPayment[] = [];
  let balance = principal;

  for (let q = 0; q < numQuarters; q++) {
    let quarterPrincipal = 0;
    let quarterInterest = 0;
    const beginBalance = balance;

    // 3 monthly payments per quarter
    for (let m = 0; m < 3; m++) {
      if (balance <= 0) break;

      const interest = balance * monthlyRate;
      const principalPmt = Math.min(monthlyPayment - interest, balance);
      balance -= principalPmt;

      quarterPrincipal += principalPmt;
      quarterInterest += interest;
    }

    schedule.push({
      quarter: q,
      beginningBalance: beginBalance,
      principalPayment: quarterPrincipal,
      interestPayment: quarterInterest,
      totalPayment: quarterPrincipal + quarterInterest,
      endingBalance: Math.max(0, balance),
    });

    if (balance <= 0) break;
  }

  return schedule;
}

/**
 * Calculate remaining debt balance at a specific quarter.
 */
export function debtBalanceAtQuarter(
  principal: number,
  annualRate: number,
  termYears: number,
  quarter: number
): number {
  const schedule = generateAmortizationSchedule(principal, annualRate, termYears, quarter + 1);
  return schedule.length > 0 ? schedule[schedule.length - 1].endingBalance : principal;
}
