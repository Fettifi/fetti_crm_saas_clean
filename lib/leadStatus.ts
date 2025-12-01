export const leadStatusEnum = [
  'NEW',
  'CONTACTED',
  'ENGAGED',
  'DEAD',
  'NOT_QUALIFIED',
] as const;

export type LeadStatus = (typeof leadStatusEnum)[number];

export const applicationStatusEnum = [
  'STARTED',
  'IN_PROGRESS',
  'SUBMITTED',
  'INCOMPLETE',
  'WITHDRAWN',
] as const;

export type ApplicationStatus = (typeof applicationStatusEnum)[number];
export const leadStatuses = [
  'new',
  'contacted',
  'qualified',
  'lost',
]

export const applicationStatuses = [
  'received',
  'in_review',
  'interview',
  'offered',
  'hired',
  'rejected',
]
