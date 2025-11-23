export type LeadStage = "New" | "Contacted" | "Qualified" | "Proposal" | "Won" | "Lost";

export interface Lead {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  state: string | null;
  occupancy: string | null;
  property_value: number | null;
  credit_band: string | null;
  liquid_assets: number | null;
  notes: string | null;
  score: number | null;
  stage: LeadStage;
}
