"use client";

// Deal Scout — FSBO acquisition desk. Scored deals come in from the screener,
// Ramon verifies, then ONE CLICK per deal: send the seller a direct-buyer
// meeting invite (SMS+email with the Calendly link — seller books themselves),
// and when terms are agreed, fire a branded LOI (download / email / e-sign).
// Sellers are never leads; all state lives in the scout store.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Home, Upload, Loader2, CalendarClock, FileSignature, Check, X, ExternalLink, Phone, Mail, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import CurrencyInput from "@/components/ui/CurrencyInput";

type Deal = {
  id: string; address: string; city?: string | null; state?: string | null; zip?: string | null;
  price: number; monthly_rent?: number | null;
  dscr_at_max_ltv?: number | null; breakeven_ltv?: number | null; max_loan_at_target_dscr?: number | null;
  beds?: number | null; baths?: number | null; sqft?: number | null;
  property_type?: string | null; days_on_market?: number | null; url?: string | null;
  seller_name?: string | null; seller_phone?: string | null; seller_email?: string | null;
  status: string; optout?: boolean; notes?: string | null;
  events: { at: string; kind: string; detail?: string }[];
  loi?: { offer_price: number; sent_at?: string | null; sign_link?: string | null } | null;
};

const money = (n?: number | null) => (n == null ? "—" : "$" + Math.round(Number(n)).toLocaleString());
const STATUS_META: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-slate-100 text-slate-700" },
  verified: { label: "Verified", cls: "bg-blue-100 text-blue-700" },
  invited: { label: "Invite sent", cls: "bg-amber-100 text-amber-700" },
  replied: { label: "Replied", cls: "bg-violet-100 text-violet-700" },
  meeting_booked: { label: "Meeting booked", cls: "bg-emerald-100 text-emerald-700" },
  loi_sent: { label: "LOI sent", cls: "bg-emerald-200 text-emerald-800" },
  under_contract: { label: "Under contract", cls: "bg-emerald-600 text-white" },
  passed: { label: "Passed", cls: "bg-slate-200 text-slate-500" },
};
const FILTERS = ["all", "new", "verified", "invited", "replied", "meeting_booked", "loi_sent", "passed"] as const;

function dscrBadge(v?: number | null) {
  if (v == null) return null;
  const good = v >= 1.1;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${good ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
      DSCR {v.toFixed(2)}
    </span>
  );
}

// ---------- Meeting-invite modal (module scope — never define inside the page) ----------
function InviteModal({ deal, onClose, onSent }: { deal: Deal; onClose: () => void; onSent: (d: Deal) => void }) {
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [sms, setSms] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailHtml, setEmailHtml] = useState("");
  const [useSms, setUseSms] = useState(!!deal.seller_phone);
  const [useEmail, setUseEmail] = useState(!!deal.seller_email);
  const [quietOk, setQuietOk] = useState(true);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch("/api/scout/outreach", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deal.id, dryRun: true }),
    }).then((r) => r.json()).then((j) => {
      if (j.error) { setErr(j.error); return; }
      setSms(j.preview.sms); setEmailSubject(j.preview.emailSubject); setEmailHtml(j.preview.emailHtml);
      setQuietOk(j.channels?.sms?.quietHoursOk !== false);
    }).catch(() => setErr("preview failed")).finally(() => setLoading(false));
  }, [deal.id]);

  async function send() {
    setSending(true); setErr("");
    const channels = [useSms ? "sms" : null, useEmail ? "email" : null].filter(Boolean);
    const r = await fetch("/api/scout/outreach", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: deal.id, channels, smsBody: sms, emailSubject, emailHtml, resend: deal.status !== "new" && deal.status !== "verified" }),
    });
    const j = await r.json();
    setSending(false);
    if (j.error) { setErr(j.error); return; }
    setResult(j);
    if (j.deal) onSent(j.deal);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><CalendarClock className="w-5 h-5 text-emerald-600" /> Book a meeting — {deal.address}</h3>
        <p className="text-sm text-slate-500 mt-1">The seller gets your Calendly link and books themselves. What you see below is exactly what sends.</p>
        {loading ? <div className="py-10 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div> : (
          <>
            {err && <div className="mt-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{err}</div>}
            {result ? (
              <div className="mt-4 p-4 rounded-xl bg-emerald-50 text-emerald-800 text-sm space-y-1">
                <div className="font-semibold flex items-center gap-2"><Check className="w-4 h-4" /> {result.sent ? "Invite sent" : "Nothing sent"}</div>
                {result.results?.sms && <div>SMS: {result.results.sms.ok ? "sent ✓" : result.results.sms.detail}</div>}
                {result.results?.email && <div>Email: {result.results.email.ok ? "sent ✓" : result.results.email.detail}</div>}
                <button className="mt-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold" onClick={onClose}>Done</button>
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-4">
                  <div className={`rounded-xl border p-3 ${useSms ? "border-emerald-300" : "border-slate-200 opacity-60"}`}>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={useSms} disabled={!deal.seller_phone} onChange={(e) => setUseSms(e.target.checked)} />
                      <Phone className="w-4 h-4" /> Text {deal.seller_phone || "(no phone on file)"}
                    </label>
                    {!quietOk && useSms && (
                      <div className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Outside 8am–9pm seller-local — the SMS will be withheld until you click during the window. Email still sends.
                      </div>
                    )}
                    <textarea className="mt-2 w-full text-sm border border-slate-200 rounded-lg p-2 h-24" value={sms} onChange={(e) => setSms(e.target.value)} />
                  </div>
                  <div className={`rounded-xl border p-3 ${useEmail ? "border-emerald-300" : "border-slate-200 opacity-60"}`}>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input type="checkbox" checked={useEmail} disabled={!deal.seller_email} onChange={(e) => setUseEmail(e.target.checked)} />
                      <Mail className="w-4 h-4" /> Email {deal.seller_email || "(no email on file)"}
                    </label>
                    <input className="mt-2 w-full text-sm border border-slate-200 rounded-lg p-2" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
                    <div className="mt-2 text-xs text-slate-500">Body preview (HTML):</div>
                    <div className="mt-1 border border-slate-100 rounded-lg p-3 text-sm max-h-40 overflow-y-auto" dangerouslySetInnerHTML={{ __html: emailHtml }} />
                  </div>
                </div>
                <div className="mt-5 flex gap-2 justify-end">
                  <button className="px-4 py-2 rounded-lg border border-slate-200 text-sm" onClick={onClose}>Cancel</button>
                  <button
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
                    disabled={sending || (!useSms && !useEmail)}
                    onClick={send}
                  >
                    {sending && <Loader2 className="w-4 h-4 animate-spin" />} Send invite
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- LOI modal ----------
function LoiModal({ deal, onClose, onSent }: { deal: Deal; onClose: () => void; onSent: (d: Deal) => void }) {
  const [offer, setOffer] = useState(String(Math.round(deal.price * 0.9)));
  const [earnest, setEarnest] = useState("2500");
  const [closeDays, setCloseDays] = useState("21");
  const [inspectionDays, setInspectionDays] = useState("7");
  const [financing, setFinancing] = useState("Investor financing arranged by Buyer; ability to close evidenced promptly");
  const [mode, setMode] = useState<"esign" | "email" | "download">(deal.seller_email ? "esign" : "download");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<any>(null);

  const payload = () => ({
    id: deal.id, offer_price: Number(offer) || 0, earnest: Number(earnest) || null,
    close_days: Number(closeDays) || null, inspection_days: Number(inspectionDays) || null,
    financing, valid_days: 7,
  });

  async function download() {
    setBusy(true); setErr("");
    const r = await fetch("/api/scout/loi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload(), mode: "download" }) });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || "failed"); return; }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `LOI-${deal.address.replace(/\W+/g, "-")}.pdf`; a.click();
    URL.revokeObjectURL(a.href);
  }

  async function send() {
    setBusy(true); setErr("");
    const r = await fetch("/api/scout/loi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload(), mode }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) { setErr(j.error || "failed"); return; }
    setDone(j);
    if (j.deal) onSent(j.deal);
  }

  const field = "w-full text-sm border border-slate-200 rounded-lg p-2";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><FileSignature className="w-5 h-5 text-emerald-600" /> Offer letter — {deal.address}</h3>
        <p className="text-sm text-slate-500 mt-1">Asking {money(deal.price)} · max loan at 1.10 DSCR {money(deal.max_loan_at_target_dscr)}</p>
        {done ? (
          <div className="mt-4 p-4 rounded-xl bg-emerald-50 text-emerald-800 text-sm space-y-1">
            <div className="font-semibold flex items-center gap-2"><Check className="w-4 h-4" /> {done.sent ? "LOI sent" : done.detail || "done"}</div>
            {done.signLink && <div className="break-all">Signing link: {done.signLink}</div>}
            <button className="mt-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            {err && <div className="mt-3 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{err}</div>}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-slate-600 col-span-2">Offer price
                <CurrencyInput className={field} value={offer} onChange={setOffer} />
              </label>
              <label className="text-xs font-semibold text-slate-600">Earnest money
                <CurrencyInput className={field} value={earnest} onChange={setEarnest} />
              </label>
              <label className="text-xs font-semibold text-slate-600">Close within (days)
                <input className={field} type="number" value={closeDays} onChange={(e) => setCloseDays(e.target.value)} />
              </label>
              <label className="text-xs font-semibold text-slate-600">Inspection period (days)
                <input className={field} type="number" value={inspectionDays} onChange={(e) => setInspectionDays(e.target.value)} />
              </label>
              <label className="text-xs font-semibold text-slate-600 col-span-2">Financing line
                <input className={field} value={financing} onChange={(e) => setFinancing(e.target.value)} />
              </label>
              <label className="text-xs font-semibold text-slate-600 col-span-2">Delivery
                <select className={field} value={mode} onChange={(e) => setMode(e.target.value as any)}>
                  <option value="esign" disabled={!deal.seller_email}>E-sign — seller signs from their phone (recommended)</option>
                  <option value="email" disabled={!deal.seller_email}>Email PDF only</option>
                  <option value="download">Download only (review first)</option>
                </select>
              </label>
            </div>
            <div className="mt-5 flex gap-2 justify-end">
              <button className="px-4 py-2 rounded-lg border border-slate-200 text-sm" onClick={onClose}>Cancel</button>
              <button className="px-4 py-2 rounded-lg border border-emerald-300 text-emerald-700 text-sm font-semibold disabled:opacity-50" disabled={busy} onClick={download}>Preview PDF</button>
              {mode !== "download" && (
                <button className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2" disabled={busy} onClick={send}>
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} {mode === "esign" ? "Send for e-sign" : "Email LOI"}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- Deal card ----------
function DealCard({ deal, onUpdate, onInvite, onLoi }: {
  deal: Deal; onUpdate: (d: Deal) => void; onInvite: () => void; onLoi: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[deal.status] || STATUS_META.new;
  const hasContact = !!(deal.seller_phone || deal.seller_email);

  const patch = useCallback(async (fields: any) => {
    setBusy(true);
    const r = await fetch("/api/scout", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deal.id, ...fields }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.deal) onUpdate(j.deal);
  }, [deal.id, onUpdate]);

  const loc = [deal.city, deal.state].filter(Boolean).join(", ");
  return (
    <div className={`bg-white rounded-2xl border p-4 ${deal.status === "passed" ? "opacity-50 border-slate-100" : "border-slate-200"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-bold text-slate-900 flex items-center gap-2 flex-wrap">
            {deal.address}{loc ? <span className="text-slate-400 font-normal">· {loc}</span> : null}
            {deal.url && <a href={deal.url} target="_blank" rel="noreferrer" className="text-emerald-600"><ExternalLink className="w-4 h-4" /></a>}
          </div>
          <div className="text-sm text-slate-500 mt-0.5 flex items-center gap-3 flex-wrap">
            <span className="font-semibold text-slate-800">{money(deal.price)}</span>
            {deal.monthly_rent ? <span>{money(deal.monthly_rent)}/mo rent</span> : null}
            {dscrBadge(deal.dscr_at_max_ltv)}
            {deal.beds != null && <span>{deal.beds}bd/{deal.baths ?? "?"}ba{deal.sqft ? ` · ${Number(deal.sqft).toLocaleString()} sqft` : ""}</span>}
            {deal.days_on_market != null && <span>{deal.days_on_market} DOM</span>}
          </div>
          <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
            {deal.seller_phone && <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{deal.seller_phone}</span>}
            {deal.seller_email && <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{deal.seller_email}</span>}
            {!hasContact && <span className="text-amber-600">no seller contact — add one to enable outreach</span>}
            {deal.optout && <span className="text-red-600 font-semibold">OPTED OUT</span>}
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${meta.cls}`}>{meta.label}</span>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {deal.status === "new" && (
          <button className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold disabled:opacity-50" disabled={busy} onClick={() => patch({ status: "verified" })}>
            <Check className="w-3.5 h-3.5 inline mr-1" />Verify
          </button>
        )}
        <button
          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-40"
          disabled={busy || !hasContact || deal.optout || deal.status === "passed"}
          onClick={onInvite}
          title={hasContact ? "Send the seller your Calendly link" : "Add seller contact first"}
        >
          <CalendarClock className="w-3.5 h-3.5 inline mr-1" />Book meeting
        </button>
        <button
          className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold disabled:opacity-40"
          disabled={busy || deal.optout || deal.status === "passed"}
          onClick={onLoi}
        >
          <FileSignature className="w-3.5 h-3.5 inline mr-1" />Offer letter
        </button>
        {["invited"].includes(deal.status) && (
          <button className="px-3 py-1.5 rounded-lg border border-violet-300 text-violet-700 text-xs font-semibold" disabled={busy} onClick={() => patch({ status: "replied" })}>Mark replied</button>
        )}
        {["invited", "replied"].includes(deal.status) && (
          <button className="px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 text-xs font-semibold" disabled={busy} onClick={() => patch({ status: "meeting_booked" })}>Mark booked</button>
        )}
        {deal.status !== "passed" ? (
          <button className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs" disabled={busy} onClick={() => patch({ status: "passed" })}><X className="w-3.5 h-3.5 inline mr-1" />Pass</button>
        ) : (
          <button className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs" disabled={busy} onClick={() => patch({ status: "new" })}>Restore</button>
        )}
        <button className="ml-auto text-xs text-slate-400 flex items-center gap-1" onClick={() => setOpen(!open)}>
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />} details
        </button>
      </div>

      {open && (
        <div className="mt-3 border-t border-slate-100 pt-3 grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">Numbers</div>
            <div className="text-xs text-slate-600 space-y-0.5">
              <div>Break-even LTV: {deal.breakeven_ltv != null ? `${Math.round(deal.breakeven_ltv * 100)}%` : "—"}</div>
              <div>Max loan @ 1.10 DSCR: {money(deal.max_loan_at_target_dscr)}</div>
              {deal.loi?.offer_price ? <div>LOI: {money(deal.loi.offer_price)}{deal.loi.sent_at ? ` · sent ${new Date(deal.loi.sent_at).toLocaleDateString()}` : ""}</div> : null}
              {deal.loi?.sign_link ? <div className="break-all">Sign link: {deal.loi.sign_link}</div> : null}
            </div>
            <div className="text-xs font-semibold text-slate-600 mt-3 mb-1">Seller contact</div>
            <SellerContactEditor deal={deal} onSave={patch} />
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={!!deal.optout} onChange={(e) => patch({ optout: e.target.checked })} /> Seller asked not to be contacted
            </label>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">Notes</div>
            <NotesEditor deal={deal} onSave={patch} />
            <div className="text-xs font-semibold text-slate-600 mt-3 mb-1">Timeline</div>
            <div className="text-xs text-slate-500 space-y-0.5 max-h-32 overflow-y-auto">
              {[...(deal.events || [])].reverse().map((e, i) => (
                <div key={i}>{new Date(e.at).toLocaleString()} — {e.kind}{e.detail ? `: ${e.detail}` : ""}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SellerContactEditor({ deal, onSave }: { deal: Deal; onSave: (f: any) => void }) {
  const [name, setName] = useState(deal.seller_name || "");
  const [phone, setPhone] = useState(deal.seller_phone || "");
  const [email, setEmail] = useState(deal.seller_email || "");
  const dirty = name !== (deal.seller_name || "") || phone !== (deal.seller_phone || "") || email !== (deal.seller_email || "");
  const f = "w-full text-xs border border-slate-200 rounded-lg p-1.5";
  return (
    <div className="space-y-1.5">
      <input className={f} placeholder="Seller name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className={f} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <input className={f} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {dirty && <button className="px-2.5 py-1 rounded-lg bg-slate-800 text-white text-xs" onClick={() => onSave({ seller_name: name, seller_phone: phone, seller_email: email })}>Save contact</button>}
    </div>
  );
}

function NotesEditor({ deal, onSave }: { deal: Deal; onSave: (f: any) => void }) {
  const [notes, setNotes] = useState(deal.notes || "");
  return (
    <div>
      <textarea className="w-full text-xs border border-slate-200 rounded-lg p-2 h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {notes !== (deal.notes || "") && <button className="px-2.5 py-1 rounded-lg bg-slate-800 text-white text-xs" onClick={() => onSave({ notes })}>Save notes</button>}
    </div>
  );
}

// ---------- Page ----------
export default function ScoutPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [inviteFor, setInviteFor] = useState<Deal | null>(null);
  const [loiFor, setLoiFor] = useState<Deal | null>(null);

  const load = useCallback(() => {
    fetch("/api/scout").then((r) => r.json()).then((j) => setDeals(j.deals || [])).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const updateDeal = useCallback((d: Deal) => {
    setDeals((prev) => prev.map((x) => (x.id === d.id ? d : x)));
  }, []);

  async function doImport() {
    setImportMsg("");
    let rows: any;
    try { rows = JSON.parse(importText); } catch { setImportMsg("That's not valid JSON."); return; }
    const r = await fetch("/api/scout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rows) });
    const j = await r.json().catch(() => ({}));
    if (j.error) { setImportMsg(j.error); return; }
    setImportMsg(`Imported: ${j.added} new, ${j.updated} updated.`);
    setImportText(""); load();
  }

  const shown = useMemo(() => deals.filter((d) => filter === "all" ? d.status !== "passed" : d.status === filter), [deals, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of deals) c[d.status] = (c[d.status] || 0) + 1;
    return c;
  }, [deals]);

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><Home className="w-6 h-6 text-emerald-600" /> Deal Scout</h1>
          <p className="text-sm text-slate-500 mt-1">FSBO acquisition desk — verify a deal, one click to book the seller, one click to send the offer.</p>
        </div>
        <button className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold flex items-center gap-2" onClick={() => setShowImport(!showImport)}>
          <Upload className="w-4 h-4" /> Import deals
        </button>
      </div>

      {showImport && (
        <div className="mt-4 bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-sm font-semibold text-slate-700">Paste the screener's JSON export</div>
          <p className="text-xs text-slate-500 mt-1">From the DSCR screener: <code>--output json</code> (or any JSON array with address/price/rent/seller contact). Re-imports merge — workflow status survives.</p>
          <textarea className="mt-2 w-full h-40 text-xs font-mono border border-slate-200 rounded-lg p-2" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[{"address":"57 W Frank Ave","city":"Memphis","state":"TN","zip":"38109","price":49995,"monthly_rent":1136,"dscr_at_max_ltv":4.26,"seller_phone":"(603) 978-8841","is_fsbo":true}]' />
          <div className="mt-2 flex items-center gap-3">
            <button className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold" onClick={doImport}>Import</button>
            {importMsg && <span className="text-sm text-slate-600">{importMsg}</span>}
          </div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${filter === f ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
            {f === "all" ? "Active" : STATUS_META[f]?.label || f}{f !== "all" && counts[f] ? ` (${counts[f]})` : ""}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="py-16 text-center text-slate-400"><Loader2 className="w-8 h-8 animate-spin inline" /></div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No deals here yet — import the screener's JSON to get started.</div>
        ) : (
          shown.map((d) => (
            <DealCard key={d.id} deal={d} onUpdate={updateDeal} onInvite={() => setInviteFor(d)} onLoi={() => setLoiFor(d)} />
          ))
        )}
      </div>

      {inviteFor && <InviteModal deal={inviteFor} onClose={() => setInviteFor(null)} onSent={updateDeal} />}
      {loiFor && <LoiModal deal={loiFor} onClose={() => setLoiFor(null)} onSent={updateDeal} />}
    </div>
  );
}
