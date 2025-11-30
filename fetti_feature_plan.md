# Fetti Feature Plan

- [x] Define lead status enum (NEW, CONTACTED, ENGAGED, DEAD, NOT_QUALIFIED) and make Lead.status required with default NEW.
- [x] Define application status enum (STARTED, IN_PROGRESS, SUBMITTED, INCOMPLETE, WITHDRAWN) and make Application.status required with default STARTED.
- [x] Backfill existing leads and applications so no status fields are NULL.
- [x] Ensure each Application row links to a Contact via contactId and backfill existing records where possible.
- [x] Create "New Leads (last 7 days)" dashboard widget showing count and list of leads with status NEW created in last 7 days.
- [x] Create "Apps In Progress" dashboard widget listing applications with status STARTED, IN_PROGRESS, or INCOMPLETE.
- Create "Submitted Apps" dashboard widget listing applications with status SUBMITTED.
- On first /apply step submission, create a new Application row (if none exists) and attach a Contact; return and persist that applicationId through the multi-step flow.

Edit this file to add, remove, or change tasks. Each bullet starting with "-" is treated as a separate task.
