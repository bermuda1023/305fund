// Contract and consensus tracking types

export interface Resident {
  id?: number;
  buildingUnitId: number;
  name: string;
  company: string | null;
  unit: string;
  telephone: string | null;
  mobile: string | null;
  email: string | null;
  residential: boolean;
  investment: boolean;
  consensusSigned: boolean;
  sentNotice: boolean;
  listingAgreementSigned: boolean;
  notes: string | null;
}

export interface VoteProgress {
  totalUnits: number;
  signedConsensus: number;
  signedListing: number;
  unsigned: number;
  unknown: number;
  consensusPct: number;
  listingPct: number;
  neededFor80Pct: number;
  remainingToReach80: number;
  fundOwnedUnits: number;
  fundOwnershipPct: number;
}

export interface ContractFlag {
  unitNumber: string;
  residentName: string;
  issue: 'unsigned_consensus' | 'unsigned_listing' | 'consensus_not_listing' | 'bad_email';
  details: string;
}
