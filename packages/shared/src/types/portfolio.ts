// Portfolio and building unit types

export interface UnitType {
  id?: number;
  unitLetter: string;          // A-U or special (e.g., "12E&F")
  ownershipPct: number;        // e.g., 0.31222800
  sqft: number;
  beds: number;
  baseHOA: number;             // Monthly HOA at baseline
  isSpecial: boolean;
}

export interface BuildingUnit {
  id?: number;
  floor: number;
  unitLetter: string;
  unitNumber: string;          // e.g., "6N", "12E&F"
  unitTypeId: number;
  isFundOwned: boolean;
  consensusStatus: 'signed' | 'unsigned' | 'unknown';
  listingAgreement: 'signed' | 'unsigned' | 'unknown';
  residentName: string | null;
  residentType: 'residential' | 'investment' | null;
  notes: string | null;
}

export interface Entity {
  id?: number;
  name: string;                // e.g., "Brickell 6N LLC"
  type: 'llc' | 'trust' | 'corp' | 'individual';
  stateOfFormation: string | null;
  ein: string | null;
  registeredAgent: string | null;
  formationDate: string | null;
  status: 'active' | 'dissolved';
  notes: string | null;
}

export interface PortfolioUnit {
  id?: number;
  buildingUnitId: number;
  entityId: number | null;
  purchaseDate: string;
  purchasePrice: number;
  purchasePricePSF: number;
  closingCosts: number;
  transferTax: number;
  inspectionCost: number;
  totalAcquisitionCost: number;
  monthlyRent: number;
  monthlyHOA: number;
  monthlyInsurance: number;
  monthlyTax: number;
  scenarioId: number | null;

  // Joined data (populated by queries)
  unitNumber?: string;
  unitLetter?: string;
  floor?: number;
  beds?: number;
  sqft?: number;
  ownershipPct?: number;
  entityName?: string;
  currentTenant?: Tenant | null;
}

export interface Tenant {
  id?: number;
  portfolioUnitId: number;
  name: string;
  email: string | null;
  phone: string | null;
  leaseStart: string;
  leaseEnd: string;
  monthlyRent: number;
  securityDeposit: number;
  status: 'active' | 'expired' | 'month_to_month' | 'vacated';
  notes: string | null;
}

export interface UnitRenovation {
  id?: number;
  portfolioUnitId: number;
  description: string;
  status: 'planned' | 'in_progress' | 'completed';
  estimatedCost: number;
  actualCost: number | null;
  contractor: string | null;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
}

export interface DocumentRecord {
  id?: number;
  parentId: number;            // entity_id, portfolio_unit_id, tenant_id, etc.
  parentType: 'entity' | 'unit' | 'tenant' | 'renovation' | 'lp' | 'fund';
  name: string;
  category: string;
  filePath: string;
  fileType: string;
  uploadedAt: string;
  requiresSignature?: boolean;
  signedAt?: string | null;
  uploadedBy?: string;
}

export interface Listing {
  id?: number;
  buildingUnitId: number | null;
  unitNumber: string;
  source: 'zillow' | 'realtor' | 'redfin' | 'mls' | 'manual';
  sourceUrl: string | null;
  askingPrice: number;
  pricePSF: number;
  listedDate: string;
  status: 'active' | 'pending' | 'sold' | 'removed';
  impliedBuildingValue: number;
  fetchedAt: string;

  // Joined data
  unitLetter?: string;
  floor?: number;
  beds?: number;
  sqft?: number;
  ownershipPct?: number;
  isUnsigned?: boolean;
}

export interface PortfolioSummary {
  totalUnitsOwned: number;
  totalOwnershipPct: number;
  totalInvested: number;
  totalMonthlyRent: number;
  totalMonthlyHOA: number;
  totalMonthlyNOI: number;
  annualizedYield: number;
  totalSqft: number;
  avgPricePSF: number;
  totalRenovationSpend: number;
  unitsWithActiveTenants: number;
  unitsVacant: number;
}
