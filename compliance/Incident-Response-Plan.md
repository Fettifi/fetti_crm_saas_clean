# Incident Response Plan (IRP)
### Fetti Financial Services LLC — NMLS #2267023

**Owner:** Ramon Dent, Qualified Individual · **Effective:** 2026-06-11 · **Review:** Annually

Satisfies GLBA Safeguards Rule §314.4(h). Covers any actual or suspected unauthorized access to, or acquisition of, customer nonpublic personal information (NPI).

## 1. Roles
- **Incident Lead / Qualified Individual:** Ramon Dent — owns the response, decisions, and notifications.
- **Technical responder:** whoever administers the CRM/infrastructure (Supabase, Vercel).

## 2. Phases

### 2.1 Detect & Report
Anyone who suspects an incident (data exposure, lost device, phishing, anomalous access, vendor breach notice) reports it to the Incident Lead **immediately**. Record date/time, what was observed, and systems involved.

### 2.2 Contain
- Revoke/rotate affected credentials (API keys, service-role key, passwords).
- Disable affected accounts or tighten access policies (e.g., RLS) to stop ongoing exposure.
- Preserve logs and evidence (do not wipe).

### 2.3 Eradicate & Recover
- Fix the root cause (e.g., correct an access-control misconfiguration).
- Restore from known-good backups if data integrity is affected.
- Verify the fix (re-test that the exposure is closed).

### 2.4 Notify
Determine notification obligations **with counsel**:
- **Customers:** Many states (incl. CA, FL, MI) require notice to affected individuals without unreasonable delay if their personal information was, or is reasonably believed to have been, acquired by an unauthorized person.
- **Regulators:** The FTC requires notification for events involving the NPI of **500+ consumers** (GLBA Safeguards Rule amendment, effective May 2024) — report through the FTC's reporting portal as soon as possible and no later than 30 days after discovery. State regulators (CA DFPI, etc.) and NMLS may have additional requirements.
- **Vendors/Partners:** Notify affected service providers as needed.

### 2.5 Post-Incident Review
Within 30 days: document the timeline, root cause, impact, remediation, and program changes to prevent recurrence. Update the WISP and risk assessment.

## 3. Incident Log
Maintain a log of all incidents: date discovered, description, data involved, # individuals affected, containment actions, notifications made, resolution date.

| Date | Summary | Data | # Affected | Notified | Resolved |
|---|---|---|---|---|---|
| 2026-06-11 | Internal review found DB tables + a storage bucket readable by the public anon key (no evidence of external access). Remediated same day (RLS + private storage). | loan files, documents metadata, chat | Unknown / none confirmed accessed | Internal review — assess notice obligations with counsel | 2026-06-11 |

*Not legal advice. Confirm specific notification thresholds and timelines with qualified counsel.*
