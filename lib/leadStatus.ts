// LeadStatus & ApplicationStatus are canonical enums.
// Only IMPORT and USE these types. Do not change or append to this file.

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
