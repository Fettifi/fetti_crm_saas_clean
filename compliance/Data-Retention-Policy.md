# Data Retention & Secure Disposal Policy
### Fetti Financial Services LLC — NMLS #2267023

**Owner:** Ramon Dent · **Effective:** 2026-06-11 · **Review:** Annually

Satisfies GLBA Safeguards Rule §314.4(c)(6). Customer NPI is kept only as long as necessary for the loan purpose and as required by law, then securely disposed of.

## Retention Schedule

| Data | Retention | Basis |
|---|---|---|
| **Closed/funded loan files** (1003, disclosures, docs) | **Minimum 25 months** after the date of action (adverse or completion); many lenders keep **7 years** | ECOA/Reg B (25 mo.), HMDA, investor/agency requirements |
| **Adverse action / declined applications** | 25 months minimum | ECOA/Reg B §1002.12 |
| **Marketing leads that never became applications** | Up to 24 months, then delete or anonymize | Data minimization; TCPA consent records kept as proof |
| **TCPA/SMS consent records** | Duration of relationship + 4–5 years | TCPA statute of limitations |
| **Credit reports / SSNs** | Only as long as needed for the active loan; purge/redact after | FCRA, data minimization |
| **Application activity logs** | 1–7 years | Audit/examination support |
| **Borrower documents in storage (`loan-docs`)** | Tied to the loan file's retention | Same as loan file |

## Secure Disposal
- Deletion of database records and storage objects is performed through the platform using administrative (service-role) access.
- SSNs and credit data are redacted/purged from active records once no longer needed for the loan.
- Backups age out per the provider's backup retention; confirm provider's deletion-from-backups timeline.

## Minimization
- Full SSN is **not** collected on the public web application; it is collected by the loan officer only at verification and stored encrypted.
- Only data necessary for origination is collected.

*Confirm exact retention periods for your investors/regulators with counsel. Not legal advice.*
