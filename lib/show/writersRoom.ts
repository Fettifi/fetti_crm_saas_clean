// THE WRITERS' ROOM — generates new "Ray & Mark — We Do Money" episodes IN CANON
// from the Show Bible (lib/show/showBible). Every episode runs the 5-beat "Owl Always
// Knew" engine, calls back + grows the Owl's Ledger, advances the Bond Meter, welds a
// DSCR/cash-flow lesson to the gag, and ends on the LOCKED sign-off. Persisted in
// app_settings (no DDL): SHOW_EPISODES (library), SHOW_LEDGER (Owl's Ledger), SHOW_BOND.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { SHOW, RAY, MARK, FLAGSHIP, CONCEPTS, LEDGER_SEEDS, buildWritersRoomSystemPrompt } from "@/lib/show/showBible";

export type EpisodeLine = { speaker: "RAY" | "MARK" | "VO"; text: string; onscreen?: string };
export type Episode = {
  id: string;
  number: number;
  title: string;
  logline: string;
  borrower: string;        // anonymized deal the episode teaches
  lessonTag: string;       // the money mechanism in one phrase
  signatureMove: string;   // Ray's signature move this episode
  ledgerCallback: string;  // prior Owl's-Ledger entry called back
  newLedgerEntry: string;  // the one new thing Mark catalogued
  beats: { beat: string; summary: string }[];
  lines: EpisodeLine[];
  cta: string;
  flagship?: boolean;
  created_at: string;
};

const EP_KEY = "SHOW_EPISODES";
const LEDGER_KEY = "SHOW_LEDGER";

// ---- store helpers (app_settings, JSON value) ----
async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    const v = (data as any)?.value;
    if (v == null) return fallback;
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return parsed == null ? fallback : (parsed as T);
  } catch { return fallback; }
}
async function writeJson(key: string, value: any): Promise<void> {
  await supabaseAdmin.from("app_settings").upsert(
    { key, value: JSON.stringify(value), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );
}

export function genId(): string {
  try { if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID(); } catch {}
  return "ep_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// WinAnsi-safe (pdf-lib + some clients choke on stray Unicode); keep the script clean.
function clean(s: any): string {
  return String(s ?? "")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .trim();
}

// ---- library ----
export async function listEpisodes(): Promise<Episode[]> {
  await ensureSeeded();
  const arr = await readJson<Episode[]>(EP_KEY, []);
  return (Array.isArray(arr) ? arr : []).sort((a, b) => (b.number || 0) - (a.number || 0));
}
export async function getEpisode(id: string): Promise<Episode | null> {
  const arr = await readJson<Episode[]>(EP_KEY, []);
  return (arr || []).find((e) => e.id === id) || null;
}
async function saveEpisode(ep: Episode): Promise<Episode> {
  const arr = await readJson<Episode[]>(EP_KEY, []);
  const idx = arr.findIndex((e) => e.id === ep.id);
  if (idx >= 0) arr[idx] = ep; else arr.push(ep);
  await writeJson(EP_KEY, arr);
  return ep;
}
export async function deleteEpisode(id: string): Promise<void> {
  const arr = await readJson<Episode[]>(EP_KEY, []);
  await writeJson(EP_KEY, arr.filter((e) => e.id !== id));
}

// Wipe the library + case log (used to clear stale/old-canon content). Next read reseeds.
export async function resetShow(): Promise<void> {
  await writeJson(EP_KEY, []);
  await writeJson(LEDGER_KEY, []);
  seedChecked = false;
}

// ---- Owl's Ledger ----
export async function getLedger(): Promise<string[]> {
  const arr = await readJson<string[]>(LEDGER_KEY, []);
  return arr && arr.length ? arr : [...LEDGER_SEEDS];
}
async function addLedgerEntry(entry: string): Promise<void> {
  const e = clean(entry);
  if (!e) return;
  const arr = await getLedger();
  if (!arr.some((x) => x.toLowerCase() === e.toLowerCase())) { arr.push(e); await writeJson(LEDGER_KEY, arr); }
}

// Seed the flagship "The Write-Offs Trap" as episode #1 the first time the library is read.
let seedChecked = false;
export async function ensureSeeded(): Promise<void> {
  if (seedChecked) return;
  seedChecked = true;
  try {
    const arr = await readJson<Episode[]>(EP_KEY, []);
    if (arr && arr.length) return;
    const ep: Episode = {
      id: genId(),
      number: 1,
      title: FLAGSHIP.title,
      logline: clean(FLAGSHIP.hook),
      borrower: "A self-employed investor with solid properties, denied by his bank because tax write-offs zero out his income.",
      lessonTag: "DSCR qualifies the deal on the property's rent, not the borrower's tax returns.",
      signatureMove: "DSCR loan",
      ledgerCallback: "(series opener)",
      newLedgerEntry: FLAGSHIP.ledgerSeed,
      beats: [],
      lines: FLAGSHIP.lines.map((l) => ({ speaker: l.speaker as EpisodeLine["speaker"], text: clean(l.text), onscreen: l.onscreen ? clean(l.onscreen) : undefined })),
      cta: clean(FLAGSHIP.cta),
      flagship: true,
      created_at: new Date().toISOString(),
    };
    await writeJson(EP_KEY, [ep]);
  } catch (e) { console.warn("[writersRoom] seed failed:", e instanceof Error ? e.message : e); }
}

// Which TTS provider voices a given line.
export function voiceFor(speaker: string): { provider: "cartesia" | "elevenlabs"; voiceId: string } | null {
  if (speaker === "RAY") return { provider: "cartesia", voiceId: RAY.voice.voiceId };
  if (speaker === "MARK") return { provider: "elevenlabs", voiceId: MARK.voice.voiceId };
  return null; // VO / onscreen
}

// ---- the engine ----
const EPISODE_SCHEMA = `Return ONLY valid JSON, no markdown, in EXACTLY this shape:
{
 "title": string (punchy, 2-5 words),
 "logline": string (one sentence describing the scenario Ray breaks down),
 "borrower": string (the ANONYMIZED borrower scenario, e.g. "a self-employed investor denied over heavy tax write-offs"),
 "lessonTag": string (the takeaway/insight in one phrase, e.g. "DSCR qualifies on the property's rent, not tax returns"),
 "signatureMove": string (the FETTI PRODUCT/SOLUTION Ray uses, e.g. "DSCR loan", "bank-statement loan", "bridge loan"),
 "ledgerCallback": string (optional — a PRIOR case from the Case Log Mark briefly calls back; "" if none),
 "newLedgerEntry": string (this episode's scenario as a short case-log tag),
 "beats": [ {"beat":"BEAT 1 — THE SCENARIO","summary": string}, ... all 5 beats ],
 "lines": [ {"speaker":"RAY"|"MARK","text": string, "onscreen": string} ],  // the full ~50s conversation, 8-12 lines
 "cta": string (the apply caption — an INVITATION, e.g. "Self-employed? The rent can qualify it. Apply at fettifi.com.")
}
RULES: This is a real conversation — MARK brings the scenario and asks the sharp questions; RAY (the founder, the brains) calmly solves it and lands the insight. NEVER make Mark out-think Ray; NEVER make Ray frantic or foolish; no pranks. Name the exact (anonymized) borrower out loud. End the LAST line with EXACTLY: "${SHOW.signoff}" (Mark or Ray). Never promise rates/approval. Never say "find the money".`;

export async function generateEpisode(input: { brief?: string; concept?: string }): Promise<Episode> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Episode writing needs ANTHROPIC_API_KEY.");

  await ensureSeeded();
  const existing = await readJson<Episode[]>(EP_KEY, []);
  const episodeNumber = (existing.reduce((m, e) => Math.max(m, e.number || 0), 0) || 0) + 1;
  const ledger = await getLedger();

  const conceptHint = input.concept
    ? `Build the conversation around this scenario concept: ${input.concept}.`
    : "";
  const briefHint = input.brief
    ? `Base the scenario on this (anonymize any real borrower — never a real name/address/exact figures): ${input.brief}`
    : `Pick a fresh real lending scenario (self-employed with write-offs, flipper needing speed, business owner with strong deposits but messy returns, cash-out on a paid-off rental, foreign national investor, etc.).`;

  const system = buildWritersRoomSystemPrompt({ ledger, episodeNumber });
  const user = `Write EPISODE #${episodeNumber} of "${SHOW.title}". ${conceptHint} ${briefHint}\n\n${EPISODE_SCHEMA}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
      max_tokens: 2500,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j?.error?.message || `Anthropic ${res.status}`);
  const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json/gi, "").replace(/```/g, "").trim();
  const m = txt.match(/\{[\s\S]*\}/);
  let raw: any = {};
  try { raw = JSON.parse(m ? m[0] : txt); } catch { throw new Error("The writers' room returned an unreadable script — try again."); }

  // Normalize + sanitize the lines.
  let lines: EpisodeLine[] = (Array.isArray(raw.lines) ? raw.lines : [])
    .map((l: any) => {
      const sp = String(l.speaker || "").toUpperCase().includes("MARK") ? "MARK" : String(l.speaker || "").toUpperCase().includes("RAY") ? "RAY" : "VO";
      return { speaker: sp as EpisodeLine["speaker"], text: clean(l.text), onscreen: l.onscreen ? clean(l.onscreen) : undefined };
    })
    .filter((l: EpisodeLine) => l.text);

  // Enforce the LOCKED sign-off as the final line (Mark or Ray may deliver it).
  const last = lines[lines.length - 1];
  if (!last || !last.text.toLowerCase().includes("we do money")) {
    lines.push({ speaker: "MARK", text: SHOW.signoff, onscreen: `FETTI FINANCIAL SERVICES - NMLS #${SHOW.nmls}` });
  } else {
    // normalize the wording of the final line to the exact locked phrase, keep the speaker
    lines[lines.length - 1] = { speaker: last.speaker, text: SHOW.signoff, onscreen: last.onscreen || `FETTI FINANCIAL SERVICES - NMLS #${SHOW.nmls}` };
  }

  const beats = (Array.isArray(raw.beats) ? raw.beats : [])
    .map((b: any) => ({ beat: clean(b.beat), summary: clean(b.summary) }))
    .filter((b: any) => b.beat || b.summary);

  const ep: Episode = {
    id: genId(),
    number: episodeNumber,
    title: clean(raw.title) || `Episode ${episodeNumber}`,
    logline: clean(raw.logline),
    borrower: clean(raw.borrower),
    lessonTag: clean(raw.lessonTag),
    signatureMove: clean(raw.signatureMove),
    ledgerCallback: clean(raw.ledgerCallback),
    newLedgerEntry: clean(raw.newLedgerEntry),
    beats,
    lines,
    cta: clean(raw.cta),
    created_at: new Date().toISOString(),
  };

  await saveEpisode(ep);
  if (ep.newLedgerEntry) await addLedgerEntry(ep.newLedgerEntry);
  return ep;
}

// Quick-start concepts for the UI (the 5 canonical prank engines).
export function conceptList() {
  return CONCEPTS.map((c) => ({ name: c.name, premise: c.premise }));
}
