- [x] Lead + Application status enums (DONE – do NOT modify lib/leadStatus.ts)
  - NOTE: LeadStatus and ApplicationStatus are already defined in lib/leadStatus.ts.
    Future work should only IMPORT and USE these types; do not change that file. 

- [ ] Dashboard widgets for leads and applications
  - Create "New Leads (last 7 days)" dashboard widget showing count and list of leads
    with status NEW created in the last 7 days.
  - Create "Apps In Progress" dashboard widget listing applications with status
    STARTED, IN_PROGRESS, or INCOMPLETE.
  - Create "Submitted Apps" dashboard widget listing applications with status SUBMITTED.

- [ ] /apply flow – create and reuse Application
  - On first /apply step submission, create a new Application row (if none exists)
    and attach a Contact via contactId.
  - On later steps, reuse that existing Application instead of creating new ones.
