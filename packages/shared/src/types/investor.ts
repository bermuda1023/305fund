// Investor/LP types

export interface LPAccount {
  id?: number;
  userId: number;
  name: string;
  entityName: string | null;
  email: string;
  phone: string | null;
  commitment: number;
  calledCapital: number;
  distributions: number;
  ownershipPct: number;        // Computed: commitment / total_commitment
  onboardedAt: string;
  status: 'pending' | 'active' | 'inactive';
  wireInstructions: string | null;
  notes: string | null;
}

export interface CapitalCall {
  id?: number;
  callNumber: number;
  totalAmount: number;
  callDate: string;
  dueDate: string;
  purpose: string;
  status: 'draft' | 'sent' | 'partially_received' | 'completed';
  letterTemplate: string;
  createdAt: string;
  items?: CapitalCallItem[];
}

export interface CapitalCallItem {
  id?: number;
  capitalCallId: number;
  lpAccountId: number;
  amount: number;
  status: 'pending' | 'sent' | 'received' | 'overdue';
  sentAt: string | null;
  receivedAt: string | null;
  emailSent: boolean;
  smsSent: boolean;

  // Joined
  lpName?: string;
  lpEmail?: string;
  lpPhone?: string;
}

export interface CapitalTransaction {
  id?: number;
  lpAccountId: number;
  capitalCallItemId: number | null;
  type: 'call' | 'distribution';
  amount: number;
  date: string;
  quarter: string;
  notes: string | null;
}

export interface LPPortalData {
  account: LPAccount;
  capitalCalls: CapitalCallItem[];
  transactions: CapitalTransaction[];
  documents: import('./portfolio').DocumentRecord[];
  fundPerformance: {
    fundMOIC: number;
    fundIRR: number;
    totalNAV: number;
    totalDistributed: number;
  };
}

export const DEFAULT_CAPITAL_CALL_TEMPLATE = `Dear {{name}},

This letter serves as a formal capital call notice for {{fund_name}}.

Capital Call Details:
- Call Amount: {{amount}}
- Purpose: {{purpose}}
- Call Date: {{call_date}}
- Due Date: {{due_date}}

Please wire funds to the following account:
{{wire_instructions}}

If you have any questions, please contact us at {{contact_email}}.

Sincerely,
{{gp_name}}
General Partner`;
