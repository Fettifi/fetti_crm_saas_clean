# Fetti Feature Plan

- [x] Define lead status enum (NEW, CONTACTED, ENGAGED, DEAD, NOT_QUALIFIED) and make Lead.status required with default NEW.
- [x] Define application status enum (STARTED, IN_PROGRESS, SUBMITTED, INCOMPLETE, WITHDRAWN) and make Application.status required with default STARTED.
- [x] Backfill existing leads and applications so no status fields are NULL.
- [x] Ensure each Application row links to a Contact via contactId and backfill existing records where possible.
- [x] Create "New Leads (last 7 days)" dashboard widget showing count and list of leads with status NEW created in last 7 days.
- [x] Create "Apps In Progress" dashboard widget listing applications with status STARTED, IN_PROGRESS, or INCOMPLETE.
- [x] Create "Submitted Apps" dashboard widget listing applications with status SUBMITTED.
- [x] On first /apply step submission, create a new Application row (if none exists) and attach a Contact; return and persist that applicationId through the multi-step flow.


## 2025-11-30 14:25

- [x] Lead + app status enums with dashboard widgets
- [x] Change the dashboard hero subtitle to mention 'Fetti SuperAgent is live and healthy'.
