import { STANDARD_LETTERS, SPECIAL_UNIT_TYPES } from './units';

/**
 * Brickell Town House (2451 Brickell Ave) building configuration.
 */
export const BUILDING = {
  address: '2451 Brickell Ave, Miami, FL 33129',
  name: 'Brickell Town House',
  yearBuilt: 1963,
  stories: 21,
  totalUnits: 361,
  acreage: 8.3,
  totalSqftLand: 361_548, // 8.3 acres in sqft
  coordinates: { lat: 25.7486, lng: -80.1897 },
} as const;

/**
 * Floor configuration for the building.
 * Floors 2-20: Standard A-U layout (18 units per floor)
 * Floor 1: Special ground-level units
 * Floor 21: Special penthouse-level units
 *
 * Special overrides:
 * - Floor 12: E&F combined into one unit (12E&F) → 17 units instead of 18
 * - Floor 16: D and E are modified (16D=1900sqft, 16E=900sqft) → still 18 units
 * - Floor 19: E&F combined (19E&F), G&H combined (19G&H) → 16 units instead of 18
 * - Floor 21: H modified (21H), J modified (21J) → still 18 units
 */

export interface FloorConfig {
  floor: number;
  units: string[];  // Unit letters/identifiers on this floor
}

/**
 * Generate the full building unit list.
 * Returns array of { floor, unitLetter, unitNumber } for all 361 units.
 */
export function generateBuildingUnits(): Array<{ floor: number; unitLetter: string; unitNumber: string }> {
  const units: Array<{ floor: number; unitLetter: string; unitNumber: string }> = [];

  // Floor 1: Ground-level special units
  const floor1Units = ['1A', '1B', 'A1', 'B1', 'B2', 'C1', 'C2', 'C3'];
  for (const u of floor1Units) {
    units.push({ floor: 1, unitLetter: u, unitNumber: u });
  }

  // Floors 2-20: Standard layout with special overrides
  for (let floor = 2; floor <= 20; floor++) {
    if (floor === 12) {
      // Floor 12: E&F combined
      for (const letter of STANDARD_LETTERS) {
        if (letter === 'E' || letter === 'F') continue; // Skip E and F individually
        units.push({
          floor,
          unitLetter: letter,
          unitNumber: `${floor}${letter}`,
        });
      }
      // Add the combined unit
      units.push({
        floor: 12,
        unitLetter: '12E&F',
        unitNumber: '12E&F',
      });
    } else if (floor === 16) {
      // Floor 16: D and E have special configs but are still separate units
      for (const letter of STANDARD_LETTERS) {
        const specialKey = `${floor}${letter}`;
        if (SPECIAL_UNIT_TYPES[specialKey]) {
          units.push({
            floor,
            unitLetter: specialKey,
            unitNumber: specialKey,
          });
        } else {
          units.push({
            floor,
            unitLetter: letter,
            unitNumber: `${floor}${letter}`,
          });
        }
      }
    } else if (floor === 19) {
      // Floor 19: E&F combined, G&H combined
      for (const letter of STANDARD_LETTERS) {
        if (letter === 'E' || letter === 'F' || letter === 'G' || letter === 'H') continue;
        units.push({
          floor,
          unitLetter: letter,
          unitNumber: `${floor}${letter}`,
        });
      }
      units.push({ floor: 19, unitLetter: '19E&F', unitNumber: '19E&F' });
      units.push({ floor: 19, unitLetter: '19G&H', unitNumber: '19G&H' });
    } else {
      // Standard floor
      for (const letter of STANDARD_LETTERS) {
        units.push({
          floor,
          unitLetter: letter,
          unitNumber: `${floor}${letter}`,
        });
      }
    }
  }

  // Floor 21: Special configs for H and J; L, M, N, P do NOT exist on this floor
  const floor21Excluded = new Set(['L', 'M', 'N', 'P']);
  for (const letter of STANDARD_LETTERS) {
    if (floor21Excluded.has(letter)) continue;
    const specialKey = `21${letter}`;
    if (SPECIAL_UNIT_TYPES[specialKey]) {
      units.push({
        floor: 21,
        unitLetter: specialKey,
        unitNumber: specialKey,
      });
    } else {
      units.push({
        floor: 21,
        unitLetter: letter,
        unitNumber: `21${letter}`,
      });
    }
  }

  return units;
}

/**
 * Supermajority threshold for building termination under FL Statute 718.117
 */
export const TERMINATION_THRESHOLD_PCT = 80;

/**
 * Minimum percentage of owners that can file objections to block termination
 */
export const OBJECTION_THRESHOLD_PCT = 5;
