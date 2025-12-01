# Fetti CRM – Matrix Feature Plan (Live Design as Baseline)

## Global rules for feature agents

- The current deployed design (tag: v0.3-design-stable) is the visual baseline.
- DO NOT change the overall layout or dark Fetti theme of:
  - app/apply/page.tsx (multi-step apply flow)
  - app/dashboard/page.tsx (dashboard shell)
- You MAY:
  - Add widgets, cards, and sections INSIDE existing layouts.
  - Wire data to existing components.
  - Add new route segments under app/ when needed.
- You MUST NOT:
  - Replace the multi-step /apply conversational UX.
  - Replace the page shells with generic boilerplate.
- LeadStatus and ApplicationStatus are canonical enums in lib/leadStatus.ts.
  - Only IMPORT and USE these types.
  - Do NOT change or append to lib/leadStatus.ts.

---

- [x] Lead + Application status enums (DONE – do NOT modify lib/leadStatus.ts)
  - NOTE: LeadStatus and ApplicationStatus are already defined in lib/leadStatus.ts.
    Future work should only IMPORT and USE these types; do not change that file. 

- [ ] Dashboard widgets for leads and applications
  - Create "New Leads (last 7 days)" dashboard widget showing count and list of leads
    with status NEW created in the last 7 days.
  - Create "Apps In Progress" dashboard widget listing applications with status
    STARTED, IN_PROGRESS, or INCOMPLETE.
  - Create "Submitted Apps" dashboard widget listing applications with status SUBMITTED.
  - All widgets MUST:
    - Reuse the existing dashboard layout and theme.
    - Live in components/ and be imported into app/dashboard/page.tsx.

- [ ] /apply flow – create and reuse Application
  - On first /apply step submission, create a new Application row (if none exists)
    and attach a Contact via contactId.
  - On later steps, reuse that existing Application instead of creating new ones.
  - Do NOT change the multi-step UX; only wire data and state behind it.
