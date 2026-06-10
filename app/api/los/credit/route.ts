import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { assembleUrla } from "@/lib/urla";
import { readyForCredit, credcoConfigured, buildCreditRequestXml, parseCreditResponse, CREDCO_ENV } from "@/lib/credit";

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
  return NextResponse.json({ configured: credcoConfigured(), neededEnv: CREDCO_ENV, ready, credit });
}

export async function POST(req: NextRequest) {
  try {
    const { loanFile, lead } = await resolve(req);
    if (!lead) return NextResponse.json({ error: "Record not found." }, { status: 404 });
    const urla = assembleUrla(lead, loanFile);
    const ready = readyForCredit(urla);
    if (!ready.ready) return NextResponse.json({ error: `Complete these first: ${ready.missing.join(", ")}` }, { status: 422 });

    if (!credcoConfigured()) {
      return NextResponse.json({
        configured: false,
        neededEnv: CREDCO_ENV,
        note: "Add your Credco endpoint + credentials to Vercel env (use the CERT/test endpoint first), and send me your Credco integration guide so I finalize the request envelope. Then this fires a live tri-merge.",
      }, { status: 503 });
    }

    // --- Live pull (envelope/auth per your Credco spec) ---
    const requestXml = buildCreditRequestXml(urla);
    const auth = Buffer.from(`${process.env.CREDCO_USER}:${process.env.CREDCO_PASSWORD}`).toString("base64");
    const res = await fetch(process.env.CREDCO_URL as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml",
        Authorization: `Basic ${auth}`,
        ...(process.env.CREDCO_ACCOUNT ? { "X-Account": process.env.CREDCO_ACCOUNT } : {}),
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
