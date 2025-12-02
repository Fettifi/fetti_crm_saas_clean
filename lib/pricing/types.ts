export interface PricingRequest {
  dealId: string;
  amount: number;
  term: number; // in months
  creditScore: number;
  revenue: number; // annual revenue
  industry: string;
  state: string;
}

export interface EligibilityCriteria {
  minCreditScore: number;
  minRevenue: number;
  restrictedIndustries: string[];
  restrictedStates: string[];
  maxAmount: number;
}

export interface Investor {
  id: string;
  name: string;
  criteria: EligibilityCriteria;
}

export interface Quote {
  investorId: string;
  investorName: string;
  amount: number;
  term: number;
  rate: number;
  payment: number;
  status: 'approved' | 'rejected' | 'referral';
  reason?: string;
}
