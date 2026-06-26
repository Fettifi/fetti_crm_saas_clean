// Bulk-delete loan files. POST { ids: string[], purge?: boolean }. Each file is
// removed with the same cascade as a single delete (docs + activity + preapprovals,
// and stored files when purge is true). Auth-gated via the /api/los matcher.
import { NextRequest, NextResponse } from "next/server";
import { deleteLoanFileCascade } from "@/lib/los";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const purge = !!body?.purge;
    const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids: string[] = [...new Set(rawIds.map((x) => String(x || "")).filter(Boolean))].slice(0, 300);
    if (!ids.length) return NextResponse.json({ error: "No files selected." }, { status: 400 });

    let deleted = 0, docs = 0, storage = 0;
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const r = await deleteLoanFileCascade(id, { purgeStorage: purge });
        deleted += r.files; docs += r.docs; storage += r.storage;
      } catch { failed.push(id); }
    }

    await logActivity({
      entity_type: "org", actor: "lo", action: "loan_files.bulk_deleted",
      detail: { requested: ids.length, deleted, docs, storage, purge, failed: failed.length },
    }).catch(() => {});

    return NextResponse.json({ ok: true, deleted, docs, storage, failed });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
