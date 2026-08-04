// LOS loan file detail (file + documents + recent activity + lead) and updates
// (stage, status, assignment, compliance toggles).
import { NextRequest, NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { logActivity } from "@/lib/activity";
import { STAGES, deleteLoanFileCascade, FILE_STATUSES } from "@/lib/los";
import { assembleUrla } from "@/lib/urla";
import { sendMetaFundedEvent } from "@/lib/metaCapi";
import { advanceLeadStage } from "@/lib/leadStage";
import { cfg, setSetting, getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Google Ads offline click-conversion upload — closes the Smart Bidding loop the same
// way sendMetaFundedEvent closes Meta's. When a loan FUNDS we tell Google which ad click
// (the gclid captured at intake) produced a real funded loan and its value, so Smart
// Bidding optimizes toward FUNDED loans instead of raw form-fills. Uses the REST API
// (customers/{id}:uploadClickConversions) with an OAuth refresh-token exchange — no SDK,
// no npm dep. All creds are read via cfg() (DB-then-env) so they can be provisioned at
// runtime; the function NO-OPS cleanly (returns {ok:false}) when ANY credential is unset,
// which preserves today's exact behavior until the Google Ads developer token + OAuth
// creds are wired. Best-effort; never throws into the request path.
async function uploadGoogleAdsFundedConversion(opts: {
  gclid: string;
  value: number;
  loanFileId: string;
  conversionDateTime?: string;
}): Promise<{ ok: boolean; detail: string }> {
  try {
    const developerToken = await cfg("GOOGLE_ADS_DEVELOPER_TOKEN");
    const customerIdRaw = await cfg("GOOGLE_ADS_CUSTOMER_ID");
    const conversionAction = await cfg("GOOGLE_ADS_CONVERSION_ACTION");
    const clientId = await cfg("GOOGLE_ADS_CLIENT_ID");
    const clientSecret = await cfg("GOOGLE_ADS_CLIENT_SECRET");
    const refreshToken = await cfg("GOOGLE_ADS_REFRESH_TOKEN");
    // Any missing credential -> clean no-op (this is the current, un-provisioned state).
    if (!developerToken || !customerIdRaw || !conversionAction || !clientId || !clientSecret || !refreshToken) {
      return { ok: false, detail: "google ads creds not configured" };
    }
    const customerId = customerIdRaw.replace(/\D/g, ""); // API wants digits, no dashes
    // login-customer-id header is required when uploading through a manager (MCC) account.
    const loginCustomerId = (await cfg("GOOGLE_ADS_LOGIN_CUSTOMER_ID"))?.replace(/\D/g, "") || null;
    const conversionActionResource = conversionAction.startsWith("customers/")
      ? conversionAction
      : `customers/${customerId}/conversionActions/${conversionAction.replace(/\D/g, "")}`;

    // 1) Exchange the long-lived refresh token for a short-lived access token.
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(12000),
    });
    const tokenJson: any = await tokenRes.json().catch(() => ({}));
    const accessToken = tokenJson?.access_token;
    if (!accessToken) return { ok: false, detail: `oauth: ${tokenJson?.error_description || tokenJson?.error || `HTTP ${tokenRes.status}`}` };

    // 2) Upload the click conversion. orderId = loanFileId gives Google its own
    //    idempotency key, so a re-upload of the same funded loan is de-duped there too.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "developer-token": developerToken,
    };
    if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;
    const uploadRes = await fetch(
      `https://googleads.googleapis.com/v18/customers/${customerId}:uploadClickConversions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          conversions: [{
            gclid: opts.gclid,
            conversionAction: conversionActionResource,
            // "YYYY-MM-DD HH:MM:SS+00:00" (Google requires a timezone offset).
            conversionDateTime: opts.conversionDateTime || (new Date().toISOString().slice(0, 19).replace("T", " ") + "+00:00"),
            conversionValue: Math.max(0, Math.round(opts.value)),
            currencyCode: "USD",
            orderId: opts.loanFileId,
          }],
          partialFailure: true,
        }),
        signal: AbortSignal.timeout(12000),
      },
    );
    const uploadJson: any = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) return { ok: false, detail: uploadJson?.error?.message || `HTTP ${uploadRes.status}` };
    // partialFailure surfaces per-row errors in partialFailureError even on HTTP 200.
    const pf = uploadJson?.partialFailureError;
    if (pf?.message) return { ok: false, detail: `partial: ${pf.message}` };
    return { ok: true, detail: `uploaded ${(uploadJson?.results || []).length} conversion(s)` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "error" };
  }
}

// DELETE ?purge=1 -> permanently delete this loan file + its documents, activity,
// preapprovals, and (when purge) the uploaded files in storage. Irreversible.
// Auth-gated by the /api/los matcher in proxy.ts.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: file } = await supabaseAdmin.from("loan_files").select("id, lead_id, borrower_name").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
    const purge = req.nextUrl.searchParams.get("purge") === "1";
    const totals = await deleteLoanFileCascade(id, { purgeStorage: purge });
    await logActivity({ entity_type: "loan_file", entity_id: id, lead_id: file.lead_id, actor: "lo", action: "file.deleted", detail: { borrower: file.borrower_name, purged: purge, ...totals } });
    return NextResponse.json({ ok: true, purged: purge, ...totals });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: file } = await supabaseAdmin.from("loan_files").select("*").eq("id", id).maybeSingle();
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data: documents } = await supabaseAdmin
    .from("loan_documents").select("*").eq("loan_file_id", id).order("required", { ascending: false }).order("created_at");
  const { data: activity } = await supabaseAdmin
    .from("activity_log").select("*").eq("loan_file_id", id).order("created_at", { ascending: false }).limit(50);
  let lead = null;
  if (file.lead_id) {
    const { data } = await supabaseAdmin.from("leads").select("*").eq("id", file.lead_id).maybeSingle();
    lead = data;
  }
  // Attach per-borrower attribution so the LO can view/filter outstanding items by borrower.
  const docMap = (lead?.raw?.doc_borrowers && typeof lead.raw.doc_borrowers === "object") ? lead.raw.doc_borrowers : {};
  const docsOut = (documents || []).map((d: any) => ({ ...d, borrowerName: docMap[d.id] || null }));
  // The disposition (why a file was withdrawn/denied/closed, by whom, when) so the LO sees the
  // reason on the file rather than having to dig it out of the activity log.
  let disposition: any = null;
  if (String(file.status || "active").toLowerCase() !== "active") {
    try { const raw = await getSetting(`FILE_DISPOSITION:${id}`); if (raw) disposition = JSON.parse(raw); } catch { /* optional */ }
  }
  return NextResponse.json({ file, documents: docsOut, activity: activity || [], lead, disposition });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let disposition: { status: string; reason: string; by: string; at: string } | null = null;
    let clearDisposition = false;
    if (typeof body.stage === "string" && (STAGES as readonly string[]).includes(body.stage)) patch.stage = body.stage;
    // WITHDRAWING IS A DISPOSITION, NOT A DELETE.
    //
    // Ramon, 2026-08-04. The file, its documents and its history all stay — under Reg B / HMDA
    // "application withdrawn by the applicant" is its own action-taken code, distinct from a
    // denial and from a file closed for incompleteness, and which one it was is not something we
    // may infer later. So the reason and WHO withdrew it are recorded at the moment it happens,
    // and the file can be reinstated.
    if (typeof body.status === "string") {
      const next = body.status.toLowerCase();
      if (!(FILE_STATUSES as readonly string[]).includes(next)) {
        return NextResponse.json({ error: `status must be one of ${FILE_STATUSES.join(", ")}` }, { status: 400 });
      }
      patch.status = next;
      // The reason, who, and when live in app_settings rather than new columns — `loan_files`
      // has no disposition columns and a DDL migration is not worth blocking a withdrawal on.
      // Same pattern the pre-approval terms already use. Written AFTER the row update below.
      if (next !== "active") {
        const reason = String(body.status_reason || "").trim().slice(0, 300);
        if (!reason) return NextResponse.json({ error: "A reason is required to withdraw, deny, or close a file — it becomes the disposition on the record." }, { status: 400 });
        disposition = { status: next, reason, by: String(body.status_by || "").trim().slice(0, 60) || "lo", at: new Date().toISOString() };
      } else {
        disposition = null; clearDisposition = true;
      }
    }
    if (typeof body.assigned_to === "string") patch.assigned_to = body.assigned_to;
    if (Array.isArray(body.compliance)) patch.compliance = body.compliance;

    // Capture the prior stage so we fire the funded conversion only on the FIRST
    // transition into "Funded" (not on every save while already funded).
    let prevStage: string | null = null;
    if (patch.stage === "Funded") {
      const { data: prev } = await supabaseAdmin.from("loan_files").select("stage").eq("id", id).maybeSingle();
      prevStage = (prev as any)?.stage || null;
    }

    const { data: file, error } = await supabaseAdmin
      .from("loan_files").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Persist / clear the disposition, and log it as its OWN event — "withdrawn by the applicant"
    // is a fact about the application that has to be reconstructable later, not a status flip.
    if (disposition) {
      try { await setSetting(`FILE_DISPOSITION:${id}`, JSON.stringify(disposition)); } catch (e) { console.warn("[los] disposition persist failed:", e); }
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo",
        action: `file.${disposition.status}`, detail: { reason: disposition.reason, by: disposition.by, at: disposition.at, prior_stage: file.stage } });
    } else if (clearDisposition) {
      try { await setSetting(`FILE_DISPOSITION:${id}`, ""); } catch { /* best effort */ }
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo", action: "file.reinstated", detail: {} });
    }

    if (patch.stage) {
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo", action: "stage.changed", detail: { stage: patch.stage } });
    } else {
      await logActivity({ entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: file.lead_id, actor: "lo", action: "file.updated", detail: { fields: Object.keys(patch) } });
    }

    // CONVERSION LOOP-BACK: a loan just FUNDED — the bottom-of-funnel money event.
    // Report it to BOTH ad platforms so delivery optimizes toward real funded loans:
    //   • Meta   — Purchase event (value = loan amount) via sendMetaFundedEvent.
    //   • Google — offline click conversion via uploadGoogleAdsFundedConversion
    //              (keyed off raw.gclid + value), closing the Smart Bidding loop.
    // Then advance the lead to Funded and log conversion.funded with the gclid/fbclid +
    // value + created_at (the conversion timestamp). Runs after the response; never
    // blocks the LO.
    //
    // The Google uploader is fully implemented but self-gates on cfg() creds
    // (GOOGLE_ADS_DEVELOPER_TOKEN / CUSTOMER_ID / CONVERSION_ACTION / CLIENT_ID /
    // CLIENT_SECRET / REFRESH_TOKEN — DB-then-env), so it NO-OPS cleanly until those are
    // provisioned. Whenever a gclid isn't actually reported (creds unset, opt-out, or a
    // failed upload) we keep google_pending=true on the conversion.funded row below, so
    // that row remains the durable queue a future importer/cron can backfill from — no
    // funded event is ever lost.
    if (patch.stage === "Funded" && prevStage !== "Funded" && file.lead_id) {
      after(async () => {
        try {
          // Durable idempotency: never report the same funded loan twice (guards
          // re-saves and the race where two concurrent PATCHes both see a non-Funded
          // prior stage). Meta also de-dups on event_id as a second line of defense.
          const { data: already } = await supabaseAdmin.from("activity_log")
            .select("id").eq("loan_file_id", id).eq("action", "conversion.funded").limit(1).maybeSingle();
          if (already) return;
          const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", file.lead_id).maybeSingle();
          if (!lead) return;
          const raw = (lead as any).raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {};
          const urla = assembleUrla(lead, file);
          const value = Number(urla.loan?.amount) || Number((lead as any).loan_amount_requested) || Number(raw.loan_amount_requested) || 0;
          // Respect a stored privacy opt-out from intake (cross-context ad reporting).
          const optedOut = raw.tracking_opt_out === true || raw?.consent?.do_not_sell === true;
          let googleReported = false;
          if (!optedOut) {
            const res = await sendMetaFundedEvent(lead, { value, loanFileId: id });
            if (!res.ok) console.warn("[funded] meta CAPI:", res.detail);
            // Close the Google Smart Bidding loop when this lead came from a Google ad
            // click (gclid captured at intake). No-ops cleanly until Ads creds are wired.
            if (raw.gclid) {
              const g = await uploadGoogleAdsFundedConversion({ gclid: String(raw.gclid), value, loanFileId: id });
              googleReported = g.ok;
              if (!g.ok) console.warn("[funded] google ads offline:", g.detail);
            }
          }
          await advanceLeadStage((lead as any).id, "Funded", { actor: "lo", reason: "loan funded" });
          await logActivity({
            entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: (lead as any).id,
            actor: "system", action: "conversion.funded",
            // google_pending stays true until the click conversion is actually accepted,
            // keeping this row as the backfill queue for any gclid we couldn't report yet.
            detail: { value, currency: "USD", gclid: raw.gclid || null, fbclid: raw.fbclid || null, meta_reported: !optedOut, google_reported: googleReported, google_pending: !!raw.gclid && !googleReported },
          });
        } catch (e) { console.warn("[funded] loop-back failed", e); }
      });
    }
    return NextResponse.json({ file });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
