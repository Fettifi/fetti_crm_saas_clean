# Written Information Security Program (WISP)
### Fetti Financial Services LLC

**NMLS #2267023 · CA DFPI Financing Law License #60DBO-153798 · FL #MBR7286 · MI #FL0024463**
Address: 5757 W Century Blvd, Suite 700, Los Angeles, CA 90045

| | |
|---|---|
| **Document owner** | Ramon Dent, Managing Member (Qualified Individual under GLBA §314.4(a)) |
| **Effective date** | 2026-06-11 |
| **Review cadence** | At least annually, and after any material change or security incident |
| **Scope** | All systems that collect, process, or store customer nonpublic personal information (NPI): the Fetti CRM/LOS (app.fettifi.com), its database, document storage, and connected service providers |

This WISP is maintained to satisfy the **GLBA Safeguards Rule (16 CFR Part 314)** and applicable state requirements (CA, FL, MI). It describes the administrative, technical, and physical safeguards Fetti uses to protect customer NPI (names, contact info, SSNs, financial and property information, and uploaded documents).

---

## 1. Qualified Individual
Ramon Dent (Managing Member) is designated as the **Qualified Individual** responsible for overseeing, implementing, and enforcing this information security program, and for reporting on its status. Day-to-day technical safeguards are implemented in the Fetti CRM platform.

## 2. Risk Assessment
A documented risk assessment is performed at least annually and identifies reasonably foreseeable internal and external risks to the confidentiality, integrity, and availability of customer NPI. The most recent assessment (2026-06-11) identified and **remediated** the following:

| Risk | Severity | Status |
|---|---|---|
| Database tables readable by the public anon API key (RLS misconfigured to `using(true)`) | Critical | **Remediated 2026-06-11** — Row-Level Security enabled on all tables; access restricted to authenticated staff; server uses a service-role key that is never exposed to browsers |
| Document storage bucket (`documents`) publicly readable/writable | Critical | **Remediated 2026-06-11** — bucket set to private; public storage policies removed |
| SSN stored in plaintext within the application database | Medium | At-rest encryption provided by the database provider (AES-256); SSN stripped before any AI processing and masked in MISMO exports; field-level encryption added |
| Lack of multi-factor authentication on staff accounts | High | MFA implemented; enrollment required for all staff with CRM access |

## 3. Safeguards (Administrative, Technical, Physical)

### 3.1 Access Controls (§314.4(c)(1))
- **Least privilege:** Only authorized staff have CRM accounts. There is no public/borrower self-signup.
- **Authentication:** Email/password via the platform's authentication provider (Supabase Auth), **plus multi-factor authentication (TOTP)** required for staff.
- **Authorization:** All sensitive database tables enforce Row-Level Security; only authenticated staff sessions (and the server's service-role process) may access customer data. The public website key has **no** access to customer tables or private documents.

### 3.2 Data Inventory & Classification (§314.4(c)(2))
- **NPI collected:** name, email, phone, address, property details, loan amounts, income/assets, credit band, and (LO-entered) SSN and full 1003/URLA data.
- **Where stored:** PostgreSQL database (Supabase) and a private document storage bucket (`loan-docs`).
- **Document handling:** Borrower documents are uploaded only to a **private** bucket and are accessed solely through short-lived (10-minute) signed URLs generated server-side.

### 3.3 Encryption (§314.4(c)(3))
- **In transit:** All traffic uses TLS/HTTPS (enforced by the hosting provider, Vercel).
- **At rest:** The database and storage are encrypted at rest with AES-256 by the provider. SSN values are additionally encrypted at the application layer (AES-256-GCM) before storage.

### 3.4 Secure Development (§314.4(c)(4))
- Server-side data access uses a service-role credential held only in server environment variables (never shipped to browsers).
- Public lead intake is server-mediated (`/api/apply`); browsers never write directly to customer tables.
- Secrets are stored in environment variables and are git-ignored; they are never committed to source control.

### 3.5 Multi-Factor Authentication (§314.4(c)(5))
- TOTP-based MFA is implemented for staff CRM logins. Enrollment is required; access escalates to AAL2 after a successful MFA challenge.

### 3.6 Secure Disposal & Retention (§314.4(c)(6))
- Governed by the **Data Retention & Disposal Policy** (separate document). Customer NPI is retained only as long as required for the loan and by applicable record-keeping law, then securely deleted.

### 3.7 Change Management (§314.4(c)(7))
- Infrastructure and access changes are made through version-controlled deployments; security-relevant changes are recorded.

### 3.8 Logging & Monitoring (§314.4(c)(8))
- An immutable application **activity log** records key actions (lead created/updated, loan file created, document requested/uploaded/reviewed, stage changes) with actor and timestamp.
- A built-in health monitor ("CRM Doctor") checks system integrity on a schedule.

## 4. Service Provider Oversight (§314.4(f))
Fetti uses third-party processors that may handle NPI. Each must maintain appropriate safeguards and a Data Processing Agreement (DPA) must be executed. See the **Vendor DPA Checklist** (separate document) for the current list and status (Supabase, Vercel, OpenAI, Resend, Twilio, Credco/credit vendor).

## 5. Incident Response (§314.4(h))
Governed by the **Incident Response Plan** (separate document): detect, contain, eradicate, recover, notify (including any legally required customer/regulator notifications), and conduct a post-incident review.

## 6. Training (§314.4(e))
Staff with access to NPI receive security-awareness guidance covering phishing, credential hygiene, MFA, and proper handling of borrower documents and SSNs.

## 7. Continuous Evaluation & Reporting (§314.4(i))
The Qualified Individual reviews this program at least annually and reports the status of the information security program, material risks, and incidents.

---

*This document is a template implementation tailored to Fetti Financial Services LLC. It should be reviewed by qualified compliance/legal counsel before being relied upon for an examination. It is not legal advice.*
