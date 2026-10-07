import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla } from "@/lib/urla";
import { readyForCredit, credcoConfigured, credcoCreds, buildCreditRequestXml, parseCreditResponse, CREDCO_ENV } from "@/lib/credit";
import { getCardAuths, type CardAuth } from "@/lib/cardAuth";
import { hasAuthorization } from "@/lib/borrowerAuthorization";
import { cfg } from "@/lib/settings";

// Credco tri-merge pull. Auth-gated via the /api/los matcher.
//   GET  /api/los/credit?file=<id>   -> status (ready? configured? last pull)
//   POST /api/los/credit?file=<id>   -> fire the pull (only if configured)
export const runtime = "nodejs";
export const maxDuration = 60;

async function resolve(req: NextRequest) {
  const fileId = req.nextUrl.searchParams.get("file");
  if (!fileId) return { loanFile: null, lead: null };
  const { data: loanFile } = await supabaseAdmin.from("loan_files").select("*").eq("id", fileId).maybeSingle();
  let lead: any = null;
  if (loanFile?.lead_id) { const r = await supabaseAdmin.from("leads").select("*").eq("id", loanFile.lead_id).maybeSingle(); lead = r.data; }
  return { loanFile, lead };
}

export async function GET(req: NextRequest) {
  const { loanFile, lead } = await resolve(req);
  if (!lead) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  const urla = assembleUrla(lead, loanFile);
  const ready = readyForCredit(urla);
  const credit = (lead.raw?.urla?.credit) || null;
  return NextResponse.json({ configured: await credcoConfigured(), neededEnv: CREDCO_ENV, ready, credit });
}

export async function POST(req: NextRequest) {
  try {
    const { loanFile, lead } = await resolve(req);
    if (!lead) return NextResponse.json({ error: "Record not found." }, { status: 404 });
    const urla = assembleUrla(lead, loanFile);
    const ready = readyForCredit(urla);
    if (!ready.ready) return NextResponse.json({ error: `Complete these first: ${ready.missing.join(", ")}` }, { status: 422 });

    // ── WHO PAYS FOR THIS REPORT. A tri-merge costs money the moment it fires, so the
    //    borrower's card authorization has to be on file BEFORE the pull, not chased after.
    //    On a consumer mortgage the credit-report fee is specifically the one fee that may be
    //    collected before the Loan Estimate and intent to proceed (Reg Z 1026.19(e)(2)) — any
    //    OTHER fee still has to wait, so this deliberately gates on nothing else.
    const auths: Record<string, CardAuth> = getCardAuths(lead);
    const authorized = Object.values(auths || {}).find((a: any) => a?.status === "authorized" && a?.last4);
    if (!authorized) {
      return NextResponse.json({
        error: "No authorized card on file — a credit report is a real cost. Send the card authorization first (Card authorization panel), then pull.",
        needsCardAuth: true,
      }, { status: 402 });
    }

    // ── AND WHO CONSENTED. 2026-10-06, Ramon, on the Jackson Metoyer file: "If anything, you made
    //    this mistake by not having a borrower's authorization built into the LOS." He is right.
    //    This route gated the pull on the CARD authorization — who PAYS — and never once asked
    //    whether the borrower had actually consented to the inquiry. lib/borrowerAuthorization.ts
    //    already exported hasAuthorization(); nothing called it here.
    //
    //    What that cost: 82609059 was pulled 2026-09-02 and the written authorization was not
    //    signed until 09-17/09-21. The lender rejected the condition three times ("required w/in
    //    compliance 9/2") and the file is still fighting it a month later, with a rate lock running.
    //
    //    FCRA 1681b(a)(3)(A)/(F) permits a pull for a consumer-INITIATED credit transaction, and a
    //    verbal authorization given in person is valid — so this must NOT hard-block the legitimate
    //    in-office case. It demands a RECORD instead: either a signed authorization on file, or an
    //    explicit attestation of the verbal one, captured BEFORE the pull rather than reconstructed
    //    after it. A contemporaneous record is the whole difference between documentation and a
    //    scramble. [[borrower-authorization-required]]
    //    `resolve()` only reads query params, so the request body is still unread here. A POST may
    //    carry none at all, so this must never throw on an empty or non-JSON body — a gate that
    //    500s is a gate that gets removed.
    let reqBody: any = {};
    try { reqBody = (await req.json()) || {}; } catch { reqBody = {}; }
    const rawLead: any = (lead as any)?.raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {};
    const written = rawLead.borrower_authorization;
    const verbal = reqBody?.verbal_authorization;
    const verbalOk = !!(verbal && typeof verbal === "object" &&
                        String(verbal.obtained_by || "").trim() &&
                        String(verbal.obtained_at || "").trim() &&
                        String(verbal.how || "").trim());
    if (!hasAuthorization(written) && !verbalOk) {
      return NextResponse.json({
        error: "No borrower credit authorization on file. A credit report may only be pulled with the borrower's permission — " +
               "card authorization covers who PAYS, not who CONSENTED. Either have them sign the Borrower's Certification " +
               "and Authorization, or record the verbal authorization you took (who took it, when, and how) so the file shows " +
               "consent existed BEFORE the inquiry, not after it.",
        needsBorrowerAuthorization: true,
      }, { status: 412 });
    }

    const creds = await credcoCreds();
    if (!(creds.url && creds.user && creds.password)) {
      return NextResponse.json({
        configured: false,
        neededEnv: CREDCO_ENV,
        note: "Add your Credco endpoint + credentials below (start with the CERT/test endpoint), or set them in Vercel env. Send the Credco integration guide so the request envelope can be confirmed against their schema before the first production pull.",
      }, { status: 503 });
    }

    // --- Live pull (envelope/auth per your Credco spec) ---
    const requestXml = buildCreditRequestXml(urla);
    const auth = Buffer.from(`${creds.user}:${creds.password}`).toString("base64");
    const res = await fetch(creds.url as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Authorization: `Basic ${auth}`,
        ...(creds.account ? { "X-Account": creds.account } : {}),
      },
      body: requestXml,
    });
    const responseXml = await res.text();
    if (!res.ok) throw new Error(`Credco HTTP ${res.status}: ${responseXml.slice(0, 200)}`);

    const result = parseCreditResponse(responseXml);

    // Persist: scores on the 1003, tradelines merged into liabilities.
    const raw = lead.raw && typeof lead.raw === "object" ? lead.raw : {};
    const cur = (raw.urla && typeof raw.urla === "object") ? raw.urla : assembleUrla(lead, loanFile);
    cur.credit = { scores: result.scores, representativeScore: result.representativeScore, pulledAt: result.pulledAt, reference: result.reference };
    if (result.liabilities.length) cur.liabilities = [...(cur.liabilities || []), ...result.liabilities];
    raw.urla = cur;
    const patch: any = { raw };
    if (result.representativeScore) patch.credit_score = result.representativeScore;
    await supabaseAdmin.from("leads").update(patch).eq("id", lead.id);

    return NextResponse.json({ configured: true, credit: cur.credit, addedLiabilities: result.liabilities.length });
  } catch (e: any) {
    console.error("[los/credit] error:", e);
    return NextResponse.json({ error: e?.message || "Credit pull failed." }, { status: 500 });
  }
}
