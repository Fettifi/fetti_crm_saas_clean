# Vendor / Service-Provider DPA Checklist
### Fetti Financial Services LLC — GLBA Safeguards Rule §314.4(f)

Every third party that may process customer NPI must (1) be capable of appropriate safeguards and (2) have a signed **Data Processing Agreement (DPA)** / addendum on file. Most are click-to-accept. **Ramon must accept these — they are legal agreements and cannot be accepted on the company's behalf by anyone else.**

| Vendor | What it processes | DPA — where to accept | Status |
|---|---|---|---|
| **Supabase** (database + auth + storage) | All NPI, documents, credentials | Dashboard → Organization → Legal/Compliance → **Sign DPA**; SOC 2 report available under Compliance. Enable Point-in-Time Recovery + DB backups. | ☐ To sign |
| **Vercel** (hosting/CDN) | Data in transit, logs | Vercel Dashboard → Team Settings → **Legal → DPA** (accept). SOC 2 available. | ☐ To sign |
| **OpenAI** (AI features) | Lead/loan text sent to AI (SSN is stripped before sending) | platform.openai.com → Settings → **Data Processing Addendum**. Confirm "do not train on our data" (API default) + zero-retention if available. | ☐ To sign |
| **Resend** (email) | Borrower name/email, letter PDFs | resend.com → Settings → **DPA**. Verify the sending domain (SPF/DKIM/DMARC). | ☐ To sign |
| **Twilio** (SMS) | Borrower name/phone, messages | Twilio Console → **Legal → DPA**; complete A2P 10DLC registration. | ☐ To sign |
| **Credco / credit vendor** | SSN, credit data | Request and sign their **FCRA + data-security agreement**; confirm permissible-purpose controls. | ☐ To sign |
| **Google (Ads/Maps)** | Conversion + address lookups (no SSN) | Google Ads Data Processing Terms (accept in account); restrict Maps key by referrer. | ☐ Review |
| **Meta** (pixel/ads) | Website event data (no SSN) | Meta Business Data Processing Terms. | ☐ Review |

## Also configure with each provider
- **Supabase:** Multi-factor auth on the org; restrict dashboard access; enable PITR; review the auto-generated RLS so new tables are never public.
- **Vercel:** Restrict team membership; enable MFA on the Vercel account.
- **All:** Use unique strong passwords + MFA; rotate API keys periodically; keep an inventory of which keys exist and where.

*Maintain signed copies of each DPA. Not legal advice — have counsel review your processor agreements.*
