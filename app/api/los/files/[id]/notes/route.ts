// Loan-officer working notes on a file — the running record kept while on the phone with a
// borrower. Stored per file under app_settings, the same pattern the income review already
// uses (los_income_review:<id>), because loan_files has no notes column and this project has
// no migration runner or direct DB connection to add one.
//
// INTERNAL ONLY. Never rendered on the borrower portal and never written into a generated
// PDF or the MISMO export — an LO must be able to write "credit is thin, ask about the 2023
// late" without worrying where it surfaces. Staff-gated by the /api/los matcher in proxy.ts.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { getSetting, setSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
const keyFor = (id: string) => `los_file_notes:${id}`;
const MAX = 20000;   // generous for a long file history, bounded so one file can't bloat the row

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const raw = await getSetting(keyFor(id));
    if (!raw) return NextResponse.json({ ok: true, notes: "", updated_at: null });
    try {
      const j = JSON.parse(raw);
      return NextResponse.json({ ok: true, notes: String(j?.notes ?? ""), updated_at: j?.updated_at ?? null });
    } catch {
      // Tolerate a plain-string value written by an older shape rather than losing the text.
      return NextResponse.json({ ok: true, notes: raw, updated_at: null });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data: file } = await supabaseAdmin.from("loan_files").select("id, lead_id").eq("id", id).maybeSingle();
    if (!file) return NextResponse.json({ error: "loan file not found" }, { status: 404 });

    const body = await req.json().catch(() => ({} as any));
    if (typeof body?.notes !== "string") return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
    const notes = body.notes.slice(0, MAX);
    const updated_at = new Date().toISOString();

    const prev = await getSetting(keyFor(id));
    const ok = await setSetting(keyFor(id), JSON.stringify({ notes, updated_at }));
    // setSetting reports whether the write actually landed — a silent failure here would
    // lose an LO's typing, so surface it instead of returning a cheerful ok.
    if (!ok) return NextResponse.json({ error: "Couldn't save the note — please try again." }, { status: 500 });

    // Audit only a genuine first write or a change, not every keystroke-debounced save.
    let prevNotes = "";
    try { prevNotes = prev ? String(JSON.parse(prev)?.notes ?? "") : ""; } catch { prevNotes = prev || ""; }
    if (prevNotes.trim() !== notes.trim()) {
      await logActivity({
        entity_type: "loan_file", entity_id: id, loan_file_id: id, lead_id: (file as any).lead_id,
        actor: "lo", action: "file.note_saved", detail: { chars: notes.length },
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, updated_at });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
