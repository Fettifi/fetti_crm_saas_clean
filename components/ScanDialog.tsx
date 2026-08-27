"use client";
// SCAN STRAIGHT INTO THIS LOAN FILE, FROM THE CRM.
//
// The CRM is in the cloud and the Canon is on the office LAN, so this page cannot reach the
// scanner — but the browser is sitting on both networks at once. It calls the local scan agent
// (scripts/scan-agent.ts) on 127.0.0.1, which does the scanning and the filing.
//
// A cloud page calling http://127.0.0.1 is allowed: loopback counts as a trustworthy origin, so
// it is not blocked as mixed content. Chrome does preflight it as a private-network request,
// which the agent answers.
import { useCallback, useEffect, useRef, useState } from "react";

// Chrome 138+ gates a public page reaching 127.0.0.1 behind a "local network access" permission.
// Until it is granted the request does not fail — it HANGS, with nothing in the console, waiting
// on a prompt that a background tab never gets to show. So every call here carries its own
// deadline, and the first one is fired from a real click so Chrome has a gesture to attach the
// prompt to. Verified on Chrome 151: permission state "prompt", fetch pending forever.
async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

async function lnaState(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const p = await navigator.permissions.query({ name: "local-network-access" as PermissionName });
    return p.state as any;
  } catch { return "unknown"; }
}

const AGENT = (typeof window !== "undefined" && localStorage.getItem("fetti.scanAgent")) || "http://127.0.0.1:3401";

type Dest = { label: string; path: string };
type Props = {
  fileId: string;
  borrowerName?: string | null;
  docId?: string | null;        // filling an existing checklist item
  docName?: string;             // its label, or a suggested name
  onClose: () => void;
  onFiled: () => void;          // refresh the checklist
};

export default function ScanDialog({ fileId, borrowerName, docId, docName, onClose, onFiled }: Props) {
  const [health, setHealth] = useState<"idle" | "checking" | "ready" | "offline" | "blocked" | "unanswered">("idle");
  const [scanner, setScanner] = useState<{ reachable: boolean; host: string } | null>(null);
  const [name, setName] = useState(docName || "");
  const [source, setSource] = useState<"adf" | "glass">("adf");
  const [dests, setDests] = useState<Dest[]>([]);
  const [dest, setDest] = useState<string>("");
  const [customDest, setCustomDest] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; path: string; mb: string; notes: string[] } | null>(null);

  // Back closes the dialog rather than leaving the loan file — same rule as the document viewer.
  const pushedRef = useRef(false);
  useEffect(() => {
    if (!pushedRef.current) {
      pushedRef.current = true;
      try { window.history.pushState({ fettiScan: true }, ""); } catch { /* non-fatal */ }
    }
    const onPop = () => { pushedRef.current = false; onClose(); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onClose]);

  const close = useCallback(() => {
    if (busy) return;                              // never strand a scan mid-flight
    if (pushedRef.current) window.history.back();
    else onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Connecting is a CLICK, not something that happens on open. Chrome will only show the local
  // network prompt for a gesture, and asking the moment a dialog appears is also how a permission
  // gets dismissed out of hand.
  const connect = useCallback(async () => {
    setHealth("checking"); setErr(null);
    try {
      const h = await withTimeout(`${AGENT}/health`, { cache: "no-store" }, 20_000).then((r) => r.json());
      setScanner(h?.scanner || null);
      setHealth("ready");
      const d = await withTimeout(`${AGENT}/destinations?fileId=${encodeURIComponent(fileId)}`, {}, 10_000).then((r) => r.json());
      setDests(d?.options || []);
      setDest(d?.default || d?.options?.[0]?.path || "");
    } catch {
      // Three different failures look identical from here, and each has a different fix:
      // the permission was refused, the permission was never answered (the request just sat
      // there), or the agent genuinely is not running. Telling him to go start a helper that is
      // already running is the kind of wrong advice that wastes an afternoon.
      const st = await lnaState();
      setHealth(st === "denied" ? "blocked" : st === "prompt" ? "unanswered" : "offline");
    }
  }, [fileId]);

  // If the permission is already granted this is invisible — it just connects.
  useEffect(() => { (async () => { if ((await lnaState()) === "granted") connect(); })(); }, [connect]);

  async function scan() {
    setErr(null); setBusy(true); setDone(null);
    try {
      const destDir = useCustom ? customDest.trim() : dest;
      // A full feeder run is genuinely slow, so this deadline is generous — it exists to stop a
      // dead agent hanging the dialog forever, not to police the scanner.
      const r = await withTimeout(`${AGENT}/scan`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, fileId, docId: docId || null, docName: name.trim(), destDir: destDir || null }),
      }, 10 * 60_000);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error || `The scan failed (${r.status}).`); return; }
      setDone({ name: j.name, path: j.localPath, mb: (j.bytes / 1048576).toFixed(1), notes: j.notes || [] });
      onFiled();
    } catch {
      setErr("Lost contact with the scanner agent. Is the window still open?");
    } finally { setBusy(false); }
  }

  const canScan = health === "ready" && !busy && name.trim().length > 0 && (!useCustom || customDest.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start sm:items-center justify-center p-3 overflow-y-auto" onClick={close}>
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div>
            <div className="text-white font-semibold">Scan a document</div>
            {borrowerName && <div className="text-[11px] text-slate-500">into {borrowerName}&apos;s file</div>}
          </div>
          <button onClick={close} disabled={busy} className="text-slate-500 hover:text-white text-xl leading-none px-2 disabled:opacity-40">×</button>
        </div>

        <div className="p-4 space-y-4">
          {health === "idle" && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
              <p className="text-[13px] text-slate-300">
                The scanner is on the office network and this page isn&apos;t, so it connects through the
                helper running on your Mac.
              </p>
              <p className="text-[12px] text-slate-500 mt-2">
                The first time, Chrome will ask whether this site may reach devices on your local
                network. Choose <span className="text-slate-300 font-semibold">Allow</span> — it only ever
                talks to your own machine, and it won&apos;t ask again.
              </p>
              <button onClick={connect} className="mt-3 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg py-2 text-sm">
                Connect to the scanner
              </button>
            </div>
          )}

          {health === "checking" && <div className="text-sm text-slate-400">Connecting to the scanner…</div>}

          {health === "unanswered" && (
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3 text-sm">
              <div className="text-amber-200 font-semibold mb-1">Chrome is still waiting on permission</div>
              <p className="text-slate-300 text-[13px]">
                Chrome asks before a website may reach anything on your local network, and it hasn&apos;t
                been answered yet. Press Connect again and choose{" "}
                <span className="text-amber-200 font-semibold">Allow</span> on the bar that appears under
                the address bar.
              </p>
              <button onClick={connect} className="mt-3 text-xs font-semibold bg-amber-700/70 hover:bg-amber-600 text-white rounded-lg px-3 py-1.5">
                Connect again
              </button>
            </div>
          )}

          {health === "blocked" && (
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3 text-sm">
              <div className="text-amber-200 font-semibold mb-1">Chrome is blocking the local connection</div>
              <p className="text-slate-300 text-[13px]">
                Local network access was denied for this site. Click the icon to the left of the address
                bar, find <span className="text-amber-200">Local network access</span>, set it to Allow,
                then reload.
              </p>
            </div>
          )}

          {health === "offline" && (
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3 text-sm">
              <div className="text-amber-200 font-semibold mb-1">The scanner helper isn&apos;t running</div>
              <p className="text-slate-300 text-[13px]">
                It has to run on the Mac the scanner is on, because this page is in the cloud and the
                Canon is on the office network.
              </p>
              <p className="text-slate-300 text-[13px] mt-2">
                Double-click <span className="font-mono text-amber-200">Fetti Scanner Agent</span> on the
                Desktop, leave that window open, then come back and press Scan again.
              </p>
              <button onClick={connect} className="mt-3 text-xs font-semibold bg-amber-700/70 hover:bg-amber-600 text-white rounded-lg px-3 py-1.5">
                I&apos;ve started it — try again
              </button>
            </div>
          )}

          {health === "ready" && scanner && !scanner.reachable && (
            <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-3 text-[13px] text-red-200">
              The helper is running but the scanner isn&apos;t answering at{" "}
              <span className="font-mono">{scanner.host}</span>. Check it&apos;s powered on and on Wi-Fi.
            </div>
          )}

          {done ? (
            <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-xl p-3">
              <div className="text-emerald-300 font-semibold text-sm">Filed — {done.name}</div>
              <div className="text-[12px] text-slate-300 mt-1">{done.mb} MB · on this loan file</div>
              <div className="text-[12px] text-slate-400 font-mono mt-1 break-all">{done.path}</div>
              {done.notes.map((n, i) => <div key={i} className="text-[11px] text-slate-500 mt-1">{n}</div>)}
              <div className="flex gap-2 mt-3">
                <button onClick={() => { setDone(null); if (!docId) setName(""); }} className="text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg px-3 py-1.5">Scan another</button>
                <button onClick={close} className="text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg px-3 py-1.5">Done</button>
              </div>
            </div>
          ) : health === "ready" ? (
            <>
              <div>
                <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Document</label>
                {docId ? (
                  <div className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200">{name}</div>
                ) : (
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bank statements — last 2 months"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
                )}
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Where is the paper?</label>
                <div className="grid grid-cols-2 gap-2">
                  {([["adf", "Document feeder", "several pages"], ["glass", "Glass", "one page"]] as const).map(([v, t, s]) => (
                    <button key={v} onClick={() => setSource(v)}
                      className={`rounded-lg px-3 py-2 text-sm border text-left ${source === v ? "bg-emerald-600/20 border-emerald-500 text-white" : "bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-600"}`}>
                      <div className="font-semibold">{t}</div>
                      <div className="text-[11px] text-slate-400">{s}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">Save a copy to</label>
                <select value={useCustom ? "__custom" : dest} onChange={(e) => {
                  if (e.target.value === "__custom") { setUseCustom(true); }
                  else { setUseCustom(false); setDest(e.target.value); }
                }} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none">
                  {dests.map((d) => <option key={d.path} value={d.path}>{d.label}</option>)}
                  <option value="__custom">Somewhere else…</option>
                </select>
                {useCustom && (
                  <input value={customDest} onChange={(e) => setCustomDest(e.target.value)} placeholder="~/Documents/Appraisals"
                    className="mt-2 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:border-emerald-500 focus:outline-none" />
                )}
                <p className="text-[11px] text-slate-500 mt-1">
                  It always goes on the loan file. This is where the copy on the Mac lands.
                </p>
              </div>

              {err && <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2 text-[13px] text-red-200">{err}</div>}

              <button onClick={scan} disabled={!canScan}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2.5 text-sm">
                {busy ? "Scanning…" : "Scan"}
              </button>
              {busy && <p className="text-[11px] text-slate-500 text-center">Feeding pages — this can take a minute.</p>}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
