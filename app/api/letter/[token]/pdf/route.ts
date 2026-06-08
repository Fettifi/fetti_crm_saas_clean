// Generate a crisp, single-page US-Letter PDF of a pre-approval letter and return
// it as a download. Public (token-gated), same as the letter view.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { LICENSING_NOTE } from "@/lib/legal";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
const money = (n?: number | null) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const fdate = (s?: string) => (s ? new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: l } = await supabaseAdmin.from("preapprovals").select("*").eq("share_token", token).maybeSingle();
  if (!l) return NextResponse.json({ error: "not found" }, { status: 404 });

  const W = 612, H = 792, M = 54;          // Letter, 0.75in margins
  const RIGHT = W - M, CW = W - 2 * M;
  const EMERALD = rgb(0.02, 0.47, 0.34), SLATE = rgb(0.07, 0.09, 0.16), GREY = rgb(0.39, 0.45, 0.55), LIGHT = rgb(0.95, 0.96, 0.97);

  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let cur = M; // distance from top
  const yAt = (size: number) => H - cur - size;
  const text = (s: string, size: number, f = font, color = SLATE, x = M) => page.drawText(s, { x, y: yAt(size), size, font: f, color });
  const right = (s: string, size: number, f = font, color = SLATE) => page.drawText(s, { x: RIGHT - f.widthOfTextAtSize(s, size), y: yAt(size), size, font: f, color });
  const center = (s: string, size: number, f = font, color = SLATE) => page.drawText(s, { x: (W - f.widthOfTextAtSize(s, size)) / 2, y: yAt(size), size, font: f, color });
  const wrap = (s: string, f: any, size: number, max: number) => {
    const words = s.split(/\s+/); const lines: string[] = []; let line = "";
    for (const w of words) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines;
  };
  const para = (s: string, size: number, f = font, color = SLATE, x = M, max = CW, gap = 1.45) => {
    for (const ln of wrap(s, f, size, max)) { page.drawText(ln, { x, y: yAt(size), size, font: f, color }); cur += size * gap; }
  };

  // Logo
  try {
    const bytes = await fetch(`${APP_URL}/fetti-logo.png`, { signal: AbortSignal.timeout(6000) }).then((r) => r.arrayBuffer());
    const png = await doc.embedPng(bytes);
    page.drawImage(png, { x: M, y: H - M - 40, width: 40, height: 40 });
  } catch { /* logo optional */ }

  // Header
  page.drawText("Fetti Financial Services LLC", { x: M + 50, y: H - M - 16, size: 15, font: bold, color: EMERALD });
  page.drawText("NMLS #2267023 · CA DFPI Financing Law License #60DBO-153798", { x: M + 50, y: H - M - 30, size: 7.5, font, color: GREY });
  page.drawText(l.letter_number || "", { x: RIGHT - font.widthOfTextAtSize(l.letter_number || "", 8), y: H - M - 14, size: 8, font, color: GREY });
  const dstr = fdate(l.created_at);
  page.drawText(dstr, { x: RIGHT - font.widthOfTextAtSize(dstr, 8), y: H - M - 26, size: 8, font, color: GREY });
  cur = M + 46;
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 2, color: EMERALD });
  cur += 22;

  center("MORTGAGE PRE-APPROVAL LETTER", 13, bold); cur += 26;
  text("To Whom It May Concern,", 10.5); cur += 18;
  const co = l.co_borrower ? ` and ${l.co_borrower}` : "";
  para(`This letter confirms that ${l.borrower_name}${co} ${l.co_borrower ? "have" : "has"} been pre-approved by Fetti Financial Services LLC for mortgage financing based on a preliminary review of the information provided, subject to the conditions below.`, 10.5);
  cur += 10;

  // Terms table
  const rows: [string, string][] = [
    ["Loan program", l.loan_type || "—"],
    ["Approved loan amount (up to)", money(l.loan_amount)],
    ["Estimated purchase price", money(l.purchase_price)],
    ["Down payment", money(l.down_payment)],
    ["Loan term", l.term || "—"],
    ["Estimated rate", l.interest_rate || "Subject to market at lock"],
    ["Occupancy", l.occupancy || "—"],
    ["Subject property", l.property_address || "To be determined"],
  ];
  const rh = 18;
  rows.forEach(([k, v], i) => {
    if (i % 2) page.drawRectangle({ x: M, y: H - cur - rh + 4, width: CW, height: rh, color: LIGHT });
    page.drawText(k, { x: M + 8, y: H - cur - 12, size: 10, font, color: GREY });
    page.drawText(v, { x: RIGHT - 8 - font.widthOfTextAtSize(v, 10), y: H - cur - 12, size: 10, font: bold, color: SLATE });
    cur += rh;
  });
  page.drawRectangle({ x: M, y: H - cur + 4, width: CW, height: rows.length * rh, borderColor: rgb(0.85, 0.87, 0.9), borderWidth: 1, color: undefined });
  cur += 14;

  if (l.conditions) { para(`Conditions: ${l.conditions}`, 9.5, font, SLATE); cur += 4; }

  para(`This pre-approval is not a commitment to lend and is contingent upon: verification of income, assets, and employment; a satisfactory property appraisal; clear title; acceptable property insurance; an acceptable contract of sale; and final underwriting approval. Rates and programs are subject to change until locked. Valid through ${fdate(l.expires_on)}.`, 8.5, font, GREY);
  cur += 16;

  text("Sincerely,", 10.5); cur += 30;
  text(l.officer_name || "Fetti Financial Services LLC", 11, bold); cur += 13;
  text(`Mortgage Loan Originator${l.officer_nmls ? ` · NMLS #${l.officer_nmls}` : ""} · Fetti Financial Services LLC`, 8, font, GREY); cur += 18;
  page.drawLine({ start: { x: M, y: H - cur }, end: { x: RIGHT, y: H - cur }, thickness: 0.5, color: rgb(0.85, 0.87, 0.9) });
  cur += 10;
  para(`Equal Housing Opportunity. ${LICENSING_NOTE}`, 7, font, GREY, M, CW, 1.4);

  const pdf = await doc.save();
  const safe = (l.borrower_name || "borrower").replace(/[^a-zA-Z0-9]+/g, "-");
  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Pre-Approval-${l.letter_number}-${safe}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
