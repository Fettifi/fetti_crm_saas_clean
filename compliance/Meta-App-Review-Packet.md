# Meta App Review Packet — Facebook Lead Ads → Fetti CRM

Everything needed to get your OWN Meta app approved to receive Facebook Lead Ads
leads directly into the CRM (no middleman, no monthly fee). Copy-paste the text below
into the matching Meta forms. Only YOU can submit it (it's tied to your Facebook login
+ EIN).

- **App:** App ID `1589486079414223` — current Mode: **Development** (must go **Live** after approval)
- **Business:** FETTI FINANCIAL SERVICES LLC — NMLS #2267023
- **Business Verification:** ✅ DONE (confirmed Verified in Business Settings → Security Center)
- **Webhook endpoint:** `https://app.fettifi.com/api/meta/webhook` — verified healthy in prod
  (verify handshake returns 200; unsigned POST returns 401, so the app secret is set).

---

## WHY leads never arrived — the three gates (all must be cleared)

1. **App is in Development mode.** Meta only delivers TEST leads to a dev-mode app —
   never real consumer leads from live ads. Cleared by: App Review approval → flip to **Live**.
2. **`leads_retrieval` is not at Advanced Access.** Without it, even when a lead ping
   arrives, the app can't fetch the lead's name/email/phone. Cleared by: App Review (below).
3. **App-level `leadgen` webhook subscription is a MANUAL dashboard step** that the code
   does NOT do for you. If the App product isn't subscribed to the `leadgen` field with
   the callback URL registered, Meta never even sends the webhook. **Verify/do this (Step 3).**

The CRM side (token storage, page subscribe-on-connect, signature-verified webhook, lead
intake, alerts) is already built and verified. These three Meta-dashboard gates are the work.

---

## THE EXACT PERMISSION SET to request (Advanced Access)

Request Advanced Access for ALL of these — the audit found the old list was missing three
(`pages_manage_metadata`, `ads_management`, `ads_read`). Missing `pages_manage_metadata`
alone breaks the webhook subscription (#200 error), so it is mandatory, not optional:

- `leads_retrieval` ← the core one (read leads from your own Lead Ads)
- `pages_manage_metadata` ← REQUIRED to subscribe the Page to the `leadgen` webhook
- `pages_show_list`
- `pages_read_engagement`
- `pages_manage_ads`
- `ads_management`
- `ads_read`
- `business_management`

You may also be prompted for the **Marketing API Access Tier** feature (this is the
May 2026 rename of "Ads Management Standard Access"). If prompted, request it too.

---

## STEP 0 — Business Verification  ✅ ALREADY DONE
Confirmed Verified for FETTI FINANCIAL SERVICES LLC in
**business.facebook.com → Business Settings → Security Center**. Skip — but if any
permission request re-prompts for it mid-flow, it will just pass through since it's done.

## STEP 1 — Finish required App Settings (the dashboard blocks submission without these)
App Dashboard (app 1589486079414223) → **App Settings → Basic**. Make sure ALL are set:
- App Icon (1024×1024)
- **Privacy Policy URL** (e.g. https://fettifi.com/privacy)
- App category
- App purpose / description
- Primary contact email (ramon@fettifi.com)

## STEP 2 — Make ≥1 successful API call per permission (within 30 days before submitting)
Meta now requires at least one successful Graph API call using EACH requested permission
in the 30 days before review, or it can auto-reject. Use the live app or the **Graph API
Explorer** (developers.facebook.com/tools/explorer) with your app + a Page token to make
one call touching each permission (e.g. `GET /me/accounts` for pages_show_list, a
`/{page-id}?fields=...` read for pages_read_engagement, a `/{page-id}/leadgen_forms` read,
an ads read for ads_read, etc.).

## STEP 3 — Register the app-level Webhook + subscribe `leadgen`  ← the silent gap
App Dashboard → **Webhooks** → **Page**:
- **Callback URL:** `https://app.fettifi.com/api/meta/webhook`
- **Verify token:** the value of `META_WEBHOOK_VERIFY_TOKEN`
  (`fettimeta_5bca1f2bdc085deed46606f6f82daa0a95ab`)
- Click **Verify and Save** (it will pass — confirmed live), then **subscribe the `leadgen`
  field** (tick it).
Also confirm the PAGE itself is subscribed (the CRM does this on connect, but verify):
the connection status on app.fettifi.com/settings should show the Page connected.

## STEP 4 — Request Advanced Access
App Dashboard → **App Review → Permissions and Features**. For EACH permission in the list
above, click **Request advanced access**, then **Continue the Request**. (Label is
"Request advanced access" — not "Get advanced access".)

### Permission use-case description (paste)
> Fetti Financial Services LLC is a licensed U.S. mortgage lender and broker (company
> NMLS #2267023). Our app imports leads from OUR OWN Facebook Lead Ads — consumers who
> submitted our mortgage-inquiry instant form — directly into our internal CRM at
> app.fettifi.com via the `leadgen` webhook and `leads_retrieval`. A licensed loan
> officer then follows up about the mortgage they requested. We use lead data solely to
> contact and serve the consumer who submitted it. We do not sell, rent, or share lead
> data with third parties.

### How the app uses the permission (paste)
> On a new Lead Ads submission, Facebook sends a `leadgen` webhook to
> https://app.fettifi.com/api/meta/webhook. The app uses `leads_retrieval` to fetch the
> lead's field data (name, email, phone, and the inquiry answers) and creates a contact
> record in our CRM, which alerts our loan officer and starts a compliant follow-up
> sequence (email/SMS with documented consent and STOP opt-out). pages_manage_metadata is
> used only to subscribe our Page to the leadgen webhook; the pages_/ads_ permissions are
> used to identify our Page and read our own ad/lead-form metadata.

## STEP 5 — Data Handling answers (paste as needed, per permission)
- **What data:** name, email, phone, and mortgage-inquiry answers from our own Lead Ads.
- **Why:** to contact and serve the consumer who requested mortgage information.
- **Storage/security:** stored in our access-controlled CRM (Supabase, RLS to
  authenticated staff only); SSN/sensitive fields encrypted at rest (AES-256-GCM);
  TLS in transit; staff MFA available. Not sold or shared with third parties.
- **Retention/deletion:** retained for the loan relationship per our Data-Retention
  policy; deleted on request (the CRM has a permanent-delete/erase function).

## STEP 6 — App Verification / Reviewer access section
The flow asks how reviewers test the app. Provide:
- Whether users sign in via Facebook Login: **No** (staff sign in with email/password).
- Test instructions: "Use the Meta Lead Ads Testing Tool on our connected Page + form to
  submit a test lead; it appears within seconds in the CRM Leads tab at app.fettifi.com."
- Provide a reviewer test login to the CRM if requested.

## STEP 7 — Screencast (required for leads_retrieval review)
Record a short screen recording showing, in order:
1. Log in to the CRM at app.fettifi.com (Leads tab visible).
2. Settings → the Facebook/Instagram connection (the Page is connected).
3. In Meta's Lead Ads Testing Tool, submit a test lead on your form.
4. Switch to the CRM Leads tab — show the new lead appear with the borrower's info.
5. Open the lead → show the loan officer's follow-up view.
Narrate that the data is used only to follow up with that consumer about their mortgage
inquiry. Upload the video in the request form.

## STEP 8 — Submit
Click **Submit for Review** and accept the Platform/Developer Onboarding Terms.
Approval is typically 2–5 business days.

## STEP 9 — AFTER approval (don't skip — leads still won't flow without these)
1. **Switch the app from Development → Live mode** (toggle at the top of the App Dashboard).
   Real leads only flow in Live mode.
2. **Re-mint the Page token WITH the new scopes:** on app.fettifi.com/settings → Connect
   Meta, paste a fresh user token. A token minted BEFORE approval does NOT carry
   `leads_retrieval`; re-pasting mints a new Page token with it so the lead-body fetch works.
3. **End-to-end test:** submit a test lead via the Lead Ads Testing Tool and confirm a new
   row lands in the CRM Leads tab. Only then is the pipeline 100%.
4. Complete the annual **Data Use Checkup** whenever Meta prompts (governs keeping the perms).
