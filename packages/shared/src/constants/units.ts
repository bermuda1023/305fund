import type { UnitType } from '../types/portfolio';

/**
 * All unit type configurations for Brickell Town House.
 * Standard units (A-U) repeat on floors 2-20.
 * Special units are specific floor/letter combinations.
 */

// Standard unit types — same ownership % regardless of floor
export const STANDARD_UNIT_TYPES: Record<string, Omit<UnitType, 'id' | 'isSpecial'>> = {
  'A': { unitLetter: 'A', ownershipPct: 0.31222800, sqft: 1305, beds: 2, baseHOA: 1369 },
  'B': { unitLetter: 'B', ownershipPct: 0.27753600, sqft: 1188, beds: 2, baseHOA: 1217 },
  'C': { unitLetter: 'C', ownershipPct: 0.20815200, sqft: 886, beds: 1, baseHOA: 913 },
  'D': { unitLetter: 'D', ownershipPct: 0.39641400, sqft: 1703, beds: 3, baseHOA: 1739 },
  'E': { unitLetter: 'E', ownershipPct: 0.27753600, sqft: 1188, beds: 2, baseHOA: 1217 },
  'F': { unitLetter: 'F', ownershipPct: 0.23474900, sqft: 1012, beds: 1, baseHOA: 1030 },
  'G': { unitLetter: 'G', ownershipPct: 0.30529000, sqft: 1357, beds: 2, baseHOA: 1339 },
  'H': { unitLetter: 'H', ownershipPct: 0.27753600, sqft: 1188, beds: 2, baseHOA: 1217 },
  'J': { unitLetter: 'J', ownershipPct: 0.39641400, sqft: 1703, beds: 3, baseHOA: 1739 },
  'K': { unitLetter: 'K', ownershipPct: 0.20815200, sqft: 886, beds: 1, baseHOA: 913 },
  'L': { unitLetter: 'L', ownershipPct: 0.27753600, sqft: 1188, beds: 2, baseHOA: 1217 },
  'M': { unitLetter: 'M', ownershipPct: 0.30945300, sqft: 1357, beds: 2, baseHOA: 1357 },
  'N': { unitLetter: 'N', ownershipPct: 0.24053100, sqft: 1012, beds: 1, baseHOA: 1055 },
  'P': { unitLetter: 'P', ownershipPct: 0.20583900, sqft: 832, beds: 1, baseHOA: 903 },
  'R': { unitLetter: 'R', ownershipPct: 0.20583900, sqft: 886, beds: 1, baseHOA: 903 },
  'S': { unitLetter: 'S', ownershipPct: 0.27753600, sqft: 1188, beds: 2, baseHOA: 1217 },
  'T': { unitLetter: 'T', ownershipPct: 0.20815200, sqft: 832, beds: 1, baseHOA: 913 },
  'U': { unitLetter: 'U', ownershipPct: 0.24053100, sqft: 1012, beds: 1, baseHOA: 1055 },
};

// Special unit types — specific floor/unit combinations with different configs
export const SPECIAL_UNIT_TYPES: Record<string, Omit<UnitType, 'id' | 'isSpecial'>> = {
  '12E&F': { unitLetter: '12E&F', ownershipPct: 0.51529200, sqft: 2189, beds: 3, baseHOA: 2260 },
  '19E&F': { unitLetter: '19E&F', ownershipPct: 0.51529200, sqft: 2189, beds: 3, baseHOA: 2260 },
  '19G&H': { unitLetter: '19G&H', ownershipPct: 0.58513900, sqft: 2500, beds: 3, baseHOA: 2567 },
  '16D':   { unitLetter: '16D',   ownershipPct: 0.46441100, sqft: 1900, beds: 3, baseHOA: 2037 },
  '16E':   { unitLetter: '16E',   ownershipPct: 0.21002000, sqft: 900,  beds: 1, baseHOA: 921 },
  '21H':   { unitLetter: '21H',   ownershipPct: 0.20445200, sqft: 886,  beds: 1, baseHOA: 897 },
  '21J':   { unitLetter: '21J',   ownershipPct: 0.47019300, sqft: 2000, beds: 3, baseHOA: 2062 },
  '1A':    { unitLetter: '1A',    ownershipPct: 0.37223610, sqft: 1500, beds: 2, baseHOA: 1633 },
  '1B':    { unitLetter: '1B',    ownershipPct: 0.28817500, sqft: 1200, beds: 2, baseHOA: 1264 },
  'A1':    { unitLetter: 'A1',    ownershipPct: 0.36311000, sqft: 1450, beds: 2, baseHOA: 1593 },
  'B1':    { unitLetter: 'B1',    ownershipPct: 0.37152300, sqft: 1500, beds: 2, baseHOA: 1630 },
  'B2':    { unitLetter: 'B2',    ownershipPct: 0.39308900, sqft: 1600, beds: 2, baseHOA: 1724 },
  'C1':    { unitLetter: 'C1',    ownershipPct: 0.14339400, sqft: 600,  beds: 1, baseHOA: 629 },
  'C2':    { unitLetter: 'C2',    ownershipPct: 1.72674800, sqft: 7000, beds: 4, baseHOA: 7574 },
  'C3':    { unitLetter: 'C3',    ownershipPct: 0.17461700, sqft: 750,  beds: 1, baseHOA: 766 },
};

// All unit types combined
export const ALL_UNIT_TYPES: Array<Omit<UnitType, 'id'>> = [
  ...Object.values(STANDARD_UNIT_TYPES).map(u => ({ ...u, isSpecial: false })),
  ...Object.values(SPECIAL_UNIT_TYPES).map(u => ({ ...u, isSpecial: true })),
];

// Standard floor letters in order (no "I" or "O" to avoid confusion with 1 and 0)
export const STANDARD_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'U'] as const;

/**
 * Returns the unit type for a given floor and letter.
 * Handles special combined/modified units.
 */
export function getUnitType(floor: number, letter: string): Omit<UnitType, 'id'> | null {
  // Check special units first
  const specialKey = `${floor}${letter}`;
  if (SPECIAL_UNIT_TYPES[specialKey]) {
    return { ...SPECIAL_UNIT_TYPES[specialKey], isSpecial: true };
  }

  // Ground-level specials (no floor prefix)
  if (SPECIAL_UNIT_TYPES[letter]) {
    return { ...SPECIAL_UNIT_TYPES[letter], isSpecial: true };
  }

  // Standard units
  if (STANDARD_UNIT_TYPES[letter]) {
    return { ...STANDARD_UNIT_TYPES[letter], isSpecial: false };
  }

  return null;
}
