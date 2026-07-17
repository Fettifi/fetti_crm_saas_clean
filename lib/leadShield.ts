// LEAD SHIELD — bot / fake-lead / duplicate defense for every intake surface.
//
// Verdict model: pass (clean | watch) or quarantine (gray | junk). NOTHING with
// plausible contact info is ever rejected or silently dropped — the failure mode
// of every check is quarantine (stage "Review" + nurture_paused, automations
// deferred, one-click recover), never a lost borrower. Calibration invariant:
// no single non-hard signal reaches the quarantine threshold — a lone typo,
// VoIP number, or fast fill can never quarantine a real person; it takes two
// independent signal families or a hard signal (honeypot, ≥3 names on one
// phone/email, active flood surge).
//
// Modes (app_settings SHIELD_MODE): off | shadow (assess + record, verdict
// forced pass) | enforce. Ship in shadow, flip to enforce via setSetting after
// the 48h evidence window — shadow doubles as the permanent kill switch.
//
// Economics: a quarantined lead costs zero Twilio sends, zero OpenAI calls,
// zero owner pings (digest instead), and — because the Meta CAPI Lead event is
// deferred until promotion — teaches Meta's optimizer to deliver HUMANS.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { signingSecret } from "@/lib/signingSecret";
import { cfg, getSetting, setSetting } from "@/lib/settings";
import { rateLimit } from "@/lib/rateLimit";
import { logActivity } from "@/lib/activity";
import { senderFrom } from "@/lib/notify/mailFrom";
import { isDisposableDomain, FREEMAIL_DOMAINS } from "@/lib/disposableDomains";
import crypto from "crypto";

export type ShieldChannel = "lp" | "wizard" | "quote" | "api" | "meta" | "meta_import" | "mark" | "sms_optin";

export type ShieldContext = {
  body: Record<string, any>;
  channel: ShieldChannel;
  ip: string | null;
  uaPresent?: boolean;
  honeypotFilled?: boolean;
  transcriptText?: string;            // mark channel: the visitor's own words
  existing?: { id: string; full_name?: string | null; stage?: string | null; raw?: any } | null;
  nameMismatch?: boolean;
  internal?: boolean;                 // trusted server-to-server (skip IP velocity)
  smsConsent?: boolean;
};

export type ShieldSignal = { key: string; pts: number; ev: "hard" | "strong" | "medium" | "weak" | "trust"; note?: string };

export type ShieldVerdict = {
  verdict: "pass" | "quarantine";
  band: "clean" | "watch" | "gray" | "junk";
  risk: number;
  signals: ShieldSignal[];
  smsCapable: boolean;                // false → never auto-SMS this lead, even after promote
  lookup: { lineType: string; carrier?: string; valid: boolean; checkedAt: string } | null;
  mode: "off" | "shadow" | "enforce";
  version: 1;
  checkedAt: string;
};

const S = (key: string, pts: number, ev: ShieldSignal["ev"], note?: string): ShieldSignal => ({ key, pts, ev, ...(note ? { note } : {}) });

// ---------------------------------------------------------------- helpers ---

export function normalizeEmail(email: string): string {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

export function normalizeAddress(addr?: string | null): string | null {
  const a = String(addr || "").trim().toLowerCase().replace(/[.,#]/g, "").replace(/\s+/g, " ");
  return a.length >= 8 ? a : null;
}

export function editDistance(a: string, b: string): number {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

const FAKE_NAMES = new Set([
  "test", "testing", "test test", "tester", "test user", "abc", "abc abc", "aaa",
  "john doe", "jane doe", "mickey mouse", "donald duck", "none", "na", "n/a",
  "no name", "your name", "first last", "asdf", "qwerty", "fake name", "anonymous",
]);

export function checkName(name?: string | null, extraFakes: string[] = []): ShieldSignal[] {
  const out: ShieldSignal[] = [];
  const n = String(name || "").trim();
  if (!n) return out;
  const low = n.toLowerCase();
  if (FAKE_NAMES.has(low) || extraFakes.includes(low) || /^(asdf|qwer|zxcv|test\b|fuck|shit)/i.test(low) || /\d|@|http/.test(n) || n.replace(/\s/g, "").length < 2) {
    out.push(S("name.fake", 40, "strong", n.slice(0, 40)));
    return out;
  }
  // Gibberish: only flag CLEAR keyboard noise — "Ng", "Wm", hyphenated and
  // non-Anglo names must pass (vowel test applies to tokens ≥4 chars only).
  const tokens = low.split(/[\s\-']+/).filter(Boolean);
  const gibberish = tokens.some((t) =>
    (t.length >= 4 && !/[aeiouy]/.test(t)) ||
    /(.)\1{3,}/.test(t) ||
    /[bcdfghjklmnpqrstvwxz]{5,}/.test(t) ||
    /(qwert|werty|asdfg|sdfgh|zxcvb|xcvbn|12345|09876)/.test(t)
  );
  if (gibberish) out.push(S("name.gibberish", 30, "medium", n.slice(0, 40)));
  return out;
}

export function checkEmail(email: string | null, extraDisposable: string[] = [], allow: string[] = []): ShieldSignal[] {
  const out: ShieldSignal[] = [];
  if (!email) return out;
  const e = String(email).toLowerCase().trim();
  const at = e.lastIndexOf("@");
  if (at < 1) return out;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (isDisposableDomain(domain, extraDisposable, allow)) out.push(S("email.disposable", 50, "strong", domain));
  if (/^(test|testing|admin|noreply|no-reply|abuse|spam|asdf|qwerty|sample|fake)$/.test(local)) out.push(S("email.role", 20, "medium", local));
  const digits = (local.match(/\d/g) || []).length;
  if ((local.length >= 10 && !/[aeiouy]/.test(local)) || (local.length >= 8 && digits / local.length >= 0.7)) {
    out.push(S("email.gibberish", 15, "weak", local.slice(0, 20)));
  }
  return out;
}

/** Deterministic NANP sanity — no network. `phone10` is bare 10 digits. */
export function checkPhonePattern(phone10?: string | null): ShieldSignal | null {
  const p = String(phone10 || "").replace(/\D/g, "");
  if (!p) return null;
  const ten = p.length === 11 && p.startsWith("1") ? p.slice(1) : p;
  if (ten.length !== 10) return S("phone.invalid_nanp", 50, "strong", `len ${ten.length}`);
  if (/^[01]/.test(ten) || /^[01]/.test(ten.slice(3, 6))) return S("phone.invalid_nanp", 50, "strong", "NANP 0/1 lead");
  if (ten.slice(3, 6) === "555" && ten.slice(6, 8) === "01") return S("phone.invalid_nanp", 50, "strong", "555-01xx fiction range");
  if (/^(\d)\1{9}$/.test(ten)) return S("phone.invalid_nanp", 50, "strong", "repeated digit");
  if (ten === "1234567890" || ten === "0123456789" || ten === "9876543210") return S("phone.invalid_nanp", 50, "strong", "sequential");
  return null;
}

export function checkPayloadSanity(body: Record<string, any>): ShieldSignal[] {
  const out: ShieldSignal[] = [];
  let pts = 0;
  const cs = Number(body.credit_score);
  if (body.credit_score != null && isFinite(cs) && (cs < 300 || cs > 850)) pts += 15;
  const pv = Number(body.property_value);
  if (body.property_value != null && isFinite(pv) && pv > 0 && (pv < 10000 && pv >= 5000 || pv > 50000000)) pts += 10; // <5000 is Meta coded-thousands, legit
  const la = Number(body.loan_amount_requested);
  if (isFinite(la) && isFinite(pv) && la > 0 && pv >= 10000 && la > pv * 1.5) pts += 10;
  if (pts > 0) out.push(S("payload.absurd", Math.min(pts, 25), "medium"));
  return out;
}

// ------------------------------------------------------------ form token ---

const fstSecret = () => signingSecret() + ":fst";

/** Server-signed form-timing token: "<ts>.<hmac16>". Client can't forge age. */
export function mintFormToken(): string {
  const ts = String(Date.now());
  const mac = crypto.createHmac("sha256", fstSecret()).update(ts).digest("hex").slice(0, 16);
  return `${ts}.${mac}`;
}

export function verifyFormToken(fst?: string | null): { ok: boolean; ageMs: number | null } {
  const m = String(fst || "").match(/^(\d{10,16})\.([a-f0-9]{16})$/);
  if (!m) return { ok: false, ageMs: null };
  const expected = crypto.createHmac("sha256", fstSecret()).update(m[1]).digest("hex").slice(0, 16);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected))) return { ok: false, ageMs: null };
  } catch { return { ok: false, ageMs: null }; }
  return { ok: true, ageMs: Date.now() - Number(m[1]) };
}

// ------------------------------------------------------------ pure scorer ---

/** All FREE deterministic signals — the unit-test surface. No network, no DB. */
export function scoreSignals(ctx: ShieldContext, opts?: { extraDisposable?: string[]; allowDomains?: string[]; extraFakes?: string[]; minFillMs?: number }): { risk: number; signals: ShieldSignal[] } {
  const signals: ShieldSignal[] = [];
  const b = ctx.body || {};
  const minFill = opts?.minFillMs ?? (ctx.channel === "wizard" ? 3000 : 5000);

  if (ctx.honeypotFilled) signals.push(S("honeypot", 60, "hard"));

  signals.push(...checkName(b.full_name || [b.first_name, b.last_name].filter(Boolean).join(" "), opts?.extraFakes || []));
  signals.push(...checkEmail(b.email ? String(b.email) : null, opts?.extraDisposable || [], opts?.allowDomains || []));
  const ph = checkPhonePattern(b.phone);
  if (ph) signals.push(ph);
  signals.push(...checkPayloadSanity(b));

  // Server-verified fill timing — browser channels only.
  if (ctx.channel === "lp" || ctx.channel === "wizard" || ctx.channel === "quote") {
    const v = verifyFormToken(b.fst);
    if (!v.ok) signals.push(S("fst.missing", 15, "weak"));
    else if (v.ageMs != null && v.ageMs >= 0 && v.ageMs < minFill) signals.push(S("fill.too_fast", 35, "medium", `${v.ageMs}ms`));
    // age > 2h = stale tab: 0 pts.
    if (!ctx.uaPresent) signals.push(S("ua.missing", 10, "weak"));
  }

  // Direct API post with no browser envelope and no internal secret.
  if (ctx.channel === "api" && !ctx.internal) signals.push(S("transport.api", 25, "medium"));

  // Mark chat: contact details the visitor never actually typed = hallucinated
  // or prompt-injected capture.
  if (ctx.channel === "mark" && ctx.transcriptText) {
    const t = ctx.transcriptText.toLowerCase();
    const emailIn = b.email ? t.includes(String(b.email).toLowerCase()) : true;
    const phoneDigits = String(b.phone || "").replace(/\D/g, "");
    const phoneIn = phoneDigits ? t.replace(/\D/g, "").includes(phoneDigits.slice(-10)) : true;
    if (!emailIn || !phoneIn) signals.push(S("mark.unverified", 20, "medium"));
  }

  // Attribution mismatch (weak).
  const utm = String(b.utm_source || "").toLowerCase();
  if ((b.gclid && /facebook|instagram|meta/.test(utm)) || (b.fbclid && /google/.test(utm))) {
    signals.push(S("attr.mismatch", 10, "weak"));
  }

  // Trust credits.
  if ((b.gclid && /google|paid/.test(utm)) || (b.fbclid && /facebook|instagram|meta|paid/.test(utm))) {
    signals.push(S("trust.clickid", -10, "trust"));
  }
  if (ctx.channel === "sms_optin") signals.push(S("trust.sms_optin", -40, "trust", "a texting phone is self-verifying"));

  const risk = Math.max(0, signals.reduce((a, s) => a + s.pts, 0));
  return { risk, signals };
}

// ----------------------------------------------------------- async checks ---

const mxCache = new Map<string, { ok: boolean; at: number }>();

export async function checkMx(domain: string): Promise<ShieldSignal | null> {
  const d = String(domain || "").toLowerCase().trim();
  if (!d || FREEMAIL_DOMAINS.has(d)) return null;
  const hit = mxCache.get(d);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.ok ? null : S("email.no_mx", 35, "strong", d);
  try {
    const dns = await import("dns");
    const recs = await Promise.race([
      dns.promises.resolveMx(d),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1500)),
    ]);
    const ok = Array.isArray(recs) && recs.length > 0;
    mxCache.set(d, { ok, at: Date.now() });
    return ok ? null : S("email.no_mx", 35, "strong", d);
  } catch (e: any) {
    if (e?.code === "ENOTFOUND" || e?.code === "ENODATA") {
      mxCache.set(d, { ok: false, at: Date.now() });
      return S("email.no_mx", 35, "strong", d);
    }
    return null; // timeout / resolver error → fail open, 0 pts
  }
}

export async function checkVelocity(ip: string | null, emailNorm: string, domain: string, internal: boolean): Promise<ShieldSignal[]> {
  const out: ShieldSignal[] = [];
  try {
    if (ip && !internal && !(await rateLimit(`shield:ipvel:${ip}`, 3, 3600))) {
      out.push(S("velocity.ip", 40, "strong", "4th+ new lead from this IP in 1h"));
    }
    if (domain && !FREEMAIL_DOMAINS.has(domain) && !(await rateLimit(`shield:domvel:${domain}`, 5, 86400))) {
      out.push(S("domain.burst", 35, "strong", domain));
    }
  } catch { /* fail open */ }
  return out;
}

/** Mutated-identity + email-mutation groups — DB-backed, fail-open. */
export async function checkMutationGroup(body: Record<string, any>, phone10: string | null, emailNorm: string | null): Promise<{ signals: ShieldSignal[]; nameCount: number }> {
  const signals: ShieldSignal[] = [];
  let nameCount = 1;
  try {
    const name = String(body.full_name || [body.first_name, body.last_name].filter(Boolean).join(" ") || "").trim().toLowerCase();
    const firstTok = name.split(/\s+/)[0] || "";
    if (!phone10 && !emailNorm) return { signals, nameCount };
    const ors: string[] = [];
    if (phone10) { ors.push(`phone.eq.${phone10}`, `phone.eq.1${phone10}`); }
    if (body.email) ors.push(`email.eq.${String(body.email).trim().toLowerCase()}`);
    if (!ors.length) return { signals, nameCount };
    const { data: rows } = await supabaseAdmin
      .from("leads").select("id, full_name, email, raw").or(ors.join(",")).limit(20);
    const firsts = new Set<string>([firstTok].filter(Boolean));
    for (const r of rows || []) {
      const f = String((r as any).full_name || "").trim().toLowerCase().split(/\s+/)[0];
      if (!f) continue;
      // near-variants (typos, nicknames) collapse: distance ≤2 or prefix.
      let matched = false;
      for (const seen of firsts) {
        if (f === seen || editDistance(f, seen) <= 2 || f.startsWith(seen) || seen.startsWith(f)) { matched = true; break; }
      }
      if (!matched) firsts.add(f);
    }
    nameCount = firsts.size;
    if (nameCount >= 3) signals.push(S("identity.multi_name", 60, "hard", `${nameCount} distinct names on one contact`));
    // email-mutation: same normalized email, different raw email already on file.
    if (emailNorm && body.email) {
      const rawEmail = String(body.email).trim().toLowerCase();
      const mut = (rows || []).find((r: any) => r.email && r.email !== rawEmail && normalizeEmail(r.email) === emailNorm);
      if (mut) signals.push(S("email.mutation", 35, "strong", "dot/+tag variant of an existing lead"));
    }
  } catch { /* fail open */ }
  return { signals, nameCount };
}

// --------------------------------------------------------- Twilio Lookup ---

export async function lookupPhone(phone10: string): Promise<{ lineType: string; carrier?: string; valid: boolean; checkedAt: string } | null> {
  try {
    const p = String(phone10 || "").replace(/\D/g, "").slice(-10);
    if (p.length !== 10) return null;
    if ((await cfg("SHIELD_LOOKUP_ENABLED")) === "off") return null;
    // 90-day cache — bots recycle numbers; cache hits are free.
    const cacheKey = `shield:lookup:${p}`;
    const cachedRaw = await getSetting(cacheKey);
    if (cachedRaw) {
      try {
        const c = JSON.parse(cachedRaw);
        if (c?.checkedAt && Date.now() - new Date(c.checkedAt).getTime() < 90 * 86400_000) return c;
      } catch { /* re-fetch */ }
    }
    const cap = Number((await cfg("SHIELD_LOOKUP_DAILY_CAP")) || 150);
    if (!(await rateLimit("shield:lookup:daily", cap, 86400))) return null; // budget spent
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !tok) return null;
    const r = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/+1${p}?Fields=line_type_intelligence`, {
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${tok}`).toString("base64") },
      signal: AbortSignal.timeout(2500),
    });
    if (r.status === 404) {
      const res = { lineType: "invalid", valid: false, checkedAt: new Date().toISOString() };
      await setSetting(cacheKey, JSON.stringify(res));
      await logActivity({ entity_type: "shield", entity_id: p.slice(-4), actor: "shield", action: "shield.lookup", detail: { last4: p.slice(-4), lineType: "invalid" } }).catch(() => {});
      return res;
    }
    if (!r.ok) return null;
    const j = await r.json();
    const lti = j?.line_type_intelligence || {};
    const res = {
      lineType: String(lti.type || "unknown"),
      carrier: lti.carrier_name ? String(lti.carrier_name) : undefined,
      valid: j?.valid !== false,
      checkedAt: new Date().toISOString(),
    };
    await setSetting(cacheKey, JSON.stringify(res));
    await logActivity({ entity_type: "shield", entity_id: p.slice(-4), actor: "shield", action: "shield.lookup", detail: { last4: p.slice(-4), lineType: res.lineType, carrier: res.carrier } }).catch(() => {});
    return res;
  } catch { return null; }
}

function lookupSignal(lu: { lineType: string; valid: boolean } | null): ShieldSignal | null {
  if (!lu) return null;
  // Carrier says the number doesn't exist → decisive on its own (>= Q). Lands in the
  // GRAY band (not hard), so a rare Twilio false-invalid still gets the verification
  // email escape hatch — a real person clicks it and is released; a bot never does.
  if (!lu.valid || lu.lineType === "invalid") return S("phone.lookup_invalid", 60, "strong");
  switch (lu.lineType) {
    case "tollFree": case "premium": case "pager": case "voicemail": case "sharedCost":
      return S("phone.lookup_junk", 35, "strong", lu.lineType);
    case "nonFixedVoip": return S("phone.voip", 20, "medium");
    case "fixedVoip": return S("phone.voip_fixed", 10, "weak");
    case "mobile": return S("trust.mobile", -15, "trust");
    default: return null; // landline / unknown: 0 pts (smsCapable handled by caller)
  }
}

// -------------------------------------------------------------- assessor ---

export async function assessLead(ctx: ShieldContext): Promise<ShieldVerdict> {
  const now = new Date().toISOString();
  let mode = String((await cfg("SHIELD_MODE").catch(() => "shadow")) || "shadow").toLowerCase() as ShieldVerdict["mode"];
  if (!["off", "shadow", "enforce"].includes(mode)) mode = "shadow";
  const base: ShieldVerdict = { verdict: "pass", band: "clean", risk: 0, signals: [], smsCapable: true, lookup: null, mode, version: 1, checkedAt: now };
  // Honeypot needs no config, DB, or network — it quarantines in EVERY mode
  // (including off and the fail-open catch below). The pre-shield code dropped
  // these posts unconditionally; the shield must never be weaker than that.
  const honeypotVerdict = (): ShieldVerdict => ({
    ...base, verdict: "quarantine", band: "gray", risk: 60,
    signals: [S("honeypot", 60, "hard")],
  });
  if (ctx.honeypotFilled && mode === "off") return honeypotVerdict();
  if (mode === "off") return base;

  try {
    const [extraDisposable, allowDomains, extraFakes, qThRaw, wThRaw, jThRaw] = await Promise.all([
      cfg("SHIELD_DISPOSABLE_EXTRA").catch(() => ""), cfg("SHIELD_ALLOW_DOMAINS").catch(() => ""),
      cfg("SHIELD_FAKE_NAMES_EXTRA").catch(() => ""), cfg("SHIELD_RISK_QUARANTINE").catch(() => ""),
      cfg("SHIELD_RISK_WATCH").catch(() => ""), cfg("SHIELD_RISK_JUNK").catch(() => ""),
    ]);
    const csv = (s: string | null) => String(s || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const Q = Number(qThRaw) || 60, W = Number(wThRaw) || 30, J = Number(jThRaw) || 90;

    const { signals } = scoreSignals(ctx, { extraDisposable: csv(extraDisposable), allowDomains: csv(allowDomains), extraFakes: csv(extraFakes) });

    const b = ctx.body || {};
    const email = b.email ? String(b.email).trim().toLowerCase() : null;
    const domain = email ? email.slice(email.lastIndexOf("@") + 1) : "";
    const emailNorm = email ? normalizeEmail(email) : null;
    const phone10 = String(b.phone || "").replace(/\D/g, "").slice(-10) || null;

    // Surge breaker: global insert flood → quarantine everything this window
    // (band gray so survivors get promoted), never a 429 that loses a real lead.
    // Counts NEW leads only — the wizard's dedup-merge second POST must not
    // burn budget (that inflated the counter and flagged real applicants).
    const hourlyCap = Number((await cfg("SHIELD_APPLY_GLOBAL_HOURLY").catch(() => ""))) || 150;
    if (!ctx.existing && !(await rateLimit("shield:apply:global", hourlyCap, 3600))) {
      signals.push(S("surge.active", 60, "hard", "global intake flood in progress"));
      if (await getSetting("shield:surge:notified").catch(() => "1") !== new Date().toISOString().slice(0, 10)) {
        await setSetting("shield:surge:notified", new Date().toISOString().slice(0, 10)).catch(() => {});
        await logActivity({ entity_type: "shield", entity_id: "surge", actor: "shield", action: "shield.surge_on", detail: { hourlyCap } }).catch(() => {});
      }
    }

    if (email && domain) {
      const mx = await checkMx(domain);
      if (mx) signals.push(mx);
    }
    if (!ctx.existing) signals.push(...(await checkVelocity(ctx.ip, emailNorm || "", FREEMAIL_DOMAINS.has(domain) ? "" : domain, !!ctx.internal)));

    const mut = await checkMutationGroup(b, phone10, emailNorm);
    signals.push(...mut.signals);
    if (ctx.nameMismatch && ctx.existing?.full_name) {
      const a = String(b.full_name || "").trim().toLowerCase(), c = String(ctx.existing.full_name).trim().toLowerCase();
      if (a && c && editDistance(a, c) > 2) signals.push(S("dupe.name_mismatch", 35, "strong", `was "${ctx.existing.full_name}"`));
    }

    let risk = Math.max(0, signals.reduce((a, s) => a + s.pts, 0));
    let smsCapable = true;
    let lookup: ShieldVerdict["lookup"] = null;

    // Twilio Lookup on EVERY phone lead (cache 90d + daily cap keep it ~free): a
    // valid-NANP-format number can still be an unassigned/invalid line or a VOIP
    // burner that only the carrier check catches — and a confirmed mobile EARNS a
    // -15 trust credit. Data quality is the whole game (fake phone = fake lead), so
    // we no longer gate the check behind pre-existing risk. Skip only self-verifying
    // sms_optin and leads already hard-flagged (decision already made) or past Q.
    const hard = signals.some((s) => s.ev === "hard");
    const wantLookup = !!phone10 && ctx.channel !== "sms_optin" && !hard && risk < Q;
    if (wantLookup) {
      lookup = await lookupPhone(phone10!);
      const ls = lookupSignal(lookup);
      if (ls) signals.push(ls);
      if (lookup && (lookup.lineType === "landline" || !lookup.valid || ["tollFree", "premium", "pager", "voicemail", "invalid"].includes(lookup.lineType))) smsCapable = false;
      risk = Math.max(0, signals.reduce((a, s) => a + s.pts, 0));
    }

    const hardNow = signals.some((s) => s.ev === "hard");
    const quarantine = hardNow || risk >= Q;
    // Band: junk = hard evidence or ≥J. EXCEPTIONS to junk: surge (survivors are
    // real people — gray) and honeypot-only (Chrome autofill can fill hidden
    // fields on real users — gray keeps their verification-email escape hatch;
    // a bot never clicks a JS-gated verify link anyway).
    const onlySoftHard = signals.filter((s) => s.ev === "hard").every((s) => s.key === "honeypot" || s.key === "surge.active");
    const band: ShieldVerdict["band"] = quarantine
      ? ((hardNow && !onlySoftHard) || risk >= J + (hardNow && onlySoftHard ? 999 : 0) ? "junk" : "gray")
      : risk >= W ? "watch" : "clean";

    // Honeypot enforces even in shadow: it early-returned (silent drop) before this
    // system existed, so quarantining it in shadow is strictly safer than letting a
    // proven bot through the full auto-contact pipeline while we calibrate.
    const honeypotHit = signals.some((s) => s.key === "honeypot");
    const verdict: ShieldVerdict = {
      verdict: (mode === "enforce" && quarantine) || honeypotHit ? "quarantine" : "pass",
      band, risk, signals, smsCapable, lookup, mode, version: 1, checkedAt: now,
    };
    if (band !== "clean") {
      await logActivity({
        entity_type: "shield", entity_id: emailNorm || phone10 || "unknown", actor: "shield",
        action: quarantine ? "shield.quarantine" : "shield.assessed",
        detail: { channel: ctx.channel, band, risk, mode, enforced: verdict.verdict === "quarantine", signals: signals.map((s) => `${s.key}:${s.pts}`) },
      }).catch(() => {});
    }
    return verdict;
  } catch (e) {
    console.warn("[shield] assess failed open:", e);
    if (ctx.honeypotFilled) return honeypotVerdict();
    return { ...base, signals: [S("shield.error", 0, "weak")] };
  }
}

// -------------------------------------------------------------- lifecycle ---

/** Mutates the insert row for a quarantine verdict + always records raw.shield. */
export function applyShieldToRow(row: Record<string, unknown>, v: ShieldVerdict, ctx: { channel: ShieldChannel; ip: string | null; preStage?: string | null }): void {
  const raw = (row.raw && typeof row.raw === "object" ? row.raw : {}) as Record<string, any>;
  raw.shield = {
    version: 1, verdict: v.verdict, band: v.band, risk: v.risk,
    signals: v.signals.map(({ key, pts, ev, note }) => ({ key, pts, ev, ...(note ? { note } : {}) })),
    channel: ctx.channel, ip: ctx.ip, lookup: v.lookup, sms_capable: v.smsCapable,
    mode: v.mode, checked_at: v.checkedAt,
    ...(v.verdict === "quarantine" ? { quarantined_at: v.checkedAt, pre_quarantine_stage: String(ctx.preStage || row.stage || "New Lead") } : {}),
  };
  row.raw = raw;
  if (v.verdict === "quarantine") {
    row.stage = "Review";
    row.nurture_paused = true;
  }
}

export function shieldActionToken(leadId: string, action: "promote" | "dismiss"): string {
  return crypto.createHmac("sha256", signingSecret() + ":shield").update(`${leadId}:${action}`).digest("hex").slice(0, 32);
}

export function verifyShieldToken(leadId: string, action: string, t: string): boolean {
  if (action !== "promote" && action !== "dismiss") return false;
  const expected = shieldActionToken(leadId, action);
  try { return crypto.timingSafeEqual(Buffer.from(String(t || "")), Buffer.from(expected)); } catch { return false; }
}

/**
 * THE one release path. Restores the pre-quarantine stage, unpauses, and replays
 * the FULL deferred new-lead pipeline (capture draft, first touch, Meta CAPI with
 * the ORIGINAL event time, deal screen, agents) — a promoted lead is
 * indistinguishable from a clean intake, just delayed.
 */
export async function promoteQuarantined(leadId: string, actor: string, trigger: string): Promise<boolean> {
  try {
    const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", leadId).maybeSingle();
    if (!lead || String((lead as any).stage || "").toLowerCase() !== "review") return false;
    const raw = ((lead as any).raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {}) as Record<string, any>;
    const shield = raw.shield || {};
    shield.resolved_at = new Date().toISOString();
    shield.resolved_by = actor;
    shield.resolution = "promoted";
    shield.trigger = trigger;
    raw.shield = shield;
    const toStage = shield.pre_quarantine_stage && shield.pre_quarantine_stage !== "Review" ? shield.pre_quarantine_stage : "New Lead";
    await supabaseAdmin.from("leads").update({ stage: toStage, nurture_paused: false, raw }).eq("id", leadId);
    await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor, action: "shield.promote", detail: { trigger, to_stage: toStage } }).catch(() => {});
    // Replay the deferred pipeline — but ONLY if it never ran for this lead.
    // Retro-swept and merge-flipped leads already got their first touch, agents,
    // and Meta event at original intake; replaying would double-text and
    // double-report. Evidence: raw.pipeline_ran_at stamp, retro flag, or any
    // existing lead_agents row (covers pre-shield leads).
    let alreadyRan = raw.pipeline_ran_at != null || shield.retro === true;
    if (!alreadyRan) {
      try {
        const { data: ag } = await supabaseAdmin.from("lead_agents").select("lead_id").eq("lead_id", leadId).limit(1).maybeSingle();
        alreadyRan = !!ag;
      } catch { /* fail toward replaying (new leads have no rows) */ }
    }
    if (alreadyRan) {
      await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor: "shield", action: "shield.promote_norerun", detail: { reason: "pipeline already ran at original intake" } }).catch(() => {});
      return true;
    }
    const { runNewLeadPipeline } = await import("@/lib/leadPipeline");
    const fresh = { ...(lead as any), stage: toStage, nurture_paused: false, raw };
    await runNewLeadPipeline(fresh, {
      smsCapable: shield.sms_capable !== false,
      deferredReplay: true,
      skipOwnerAlert: actor.startsWith("owner"),
      optedOut: raw.tracking_opt_out === true,
      appCompleted: raw.app_completed === true,
    }).catch((e: any) => console.warn("[shield] promote pipeline replay failed:", e));
    return true;
  } catch (e) {
    console.warn("[shield] promote failed:", e);
    return false;
  }
}

export async function dismissQuarantined(leadId: string, actor: string): Promise<boolean> {
  try {
    const { data: lead } = await supabaseAdmin.from("leads").select("id, stage, raw").eq("id", leadId).maybeSingle();
    if (!lead || String((lead as any).stage || "").toLowerCase() !== "review") return false;
    const raw = ((lead as any).raw && typeof (lead as any).raw === "object" ? (lead as any).raw : {}) as Record<string, any>;
    raw.shield = { ...(raw.shield || {}), resolved_at: new Date().toISOString(), resolved_by: actor, resolution: "dismissed" };
    await supabaseAdmin.from("leads").update({ stage: "Dead", nurture_paused: true, raw }).eq("id", leadId);
    await logActivity({ entity_type: "lead", entity_id: leadId, lead_id: leadId, actor, action: "shield.dismiss", detail: {} }).catch(() => {});
    return true;
  } catch { return false; }
}

/** Cheap engagement hook: real-human evidence (SMS reply, link click, upload) frees the lead. */
export async function autoPromoteIfQuarantined(leadId: string, trigger: string): Promise<boolean> {
  try {
    const { data: lead } = await supabaseAdmin.from("leads").select("id, stage").eq("id", leadId).maybeSingle();
    if (!lead || String((lead as any).stage || "").toLowerCase() !== "review") return false;
    return await promoteQuarantined(leadId, "shield", trigger);
  } catch { return false; }
}

/** Gray-band verification email — template only, zero OpenAI, the self-promote path. */
export async function sendVerificationEmail(lead: any): Promise<boolean> {
  try {
    const key = process.env.RESEND_API_KEY, from = senderFrom();
    if (!key || !from || !lead?.email) return false;
    const raw = (lead.raw && typeof lead.raw === "object" ? lead.raw : {}) as Record<string, any>;
    // Never mail a burner/dead box — that's handing junk a self-promote button.
    const sigs: Array<{ key: string }> = raw.shield?.signals || [];
    if (sigs.some((s) => s.key === "email.disposable" || s.key === "email.no_mx")) return false;
    const { magicApplyLink } = await import("@/lib/magicLink");
    const { unsubUrl } = await import("@/lib/notify/emailCopy");
    const { markSignatureLite } = await import("@/lib/notify/emailSignature");
    const first = String(lead.first_name || lead.full_name || "there").split(/\s+/)[0];
    const purpose = String(lead.loan_purpose || "financing").toLowerCase();
    const link = magicApplyLink(lead);
    const signature = await markSignatureLite(unsubUrl(lead.id));
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;max-width:560px">
Hey ${first} — it's Mark with Fetti. Your ${purpose} inquiry just hit my desk.<br><br>
One quick step so I know it's really you (and not one of the bots we keep out): tap below and your application opens already filled out — takes about 3 minutes to finish.<br><br>
<a href="${link}" style="display:inline-block;background:#0c7a52;color:#fff;font-weight:600;padding:10px 22px;border-radius:8px;text-decoration:none">Confirm &amp; continue my application</a><br><br>
If that wasn't you, just ignore this email and nothing happens.</div>${signature}`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [lead.email], reply_to: [((await cfg("REPLY_TO_EMAIL")) || "frank@fettifi.com").trim()], subject: "quick check — then your application opens", html }),
    });
    if (r.ok) {
      raw.shield = { ...(raw.shield || {}), verify_email_sent_at: new Date().toISOString() };
      await supabaseAdmin.from("leads").update({ raw }).eq("id", lead.id);
      await logActivity({ entity_type: "lead", entity_id: lead.id, lead_id: lead.id, actor: "shield", action: "shield.verify_email_sent", detail: {} }).catch(() => {});
    }
    return r.ok;
  } catch { return false; }
}

/** Immediate owner email for Tier-1 gray quarantines only (the rest ride the digest). */
export async function notifyQuarantine(lead: any, v: ShieldVerdict): Promise<void> {
  try {
    if (v.band !== "gray" || lead?.tier !== "Tier 1") return;
    const key = process.env.RESEND_API_KEY, from = senderFrom();
    const to = (process.env.LEAD_NOTIFY_EMAIL_TO || "ramon@fettifi.com").trim();
    if (!key || !from) return;
    const app = process.env.NEXT_PUBLIC_APP_URL || "https://app.fettifi.com";
    const pl = `${app}/api/shield/act?lead=${lead.id}&action=promote&t=${shieldActionToken(lead.id, "promote")}`;
    const dl = `${app}/api/shield/act?lead=${lead.id}&action=dismiss&t=${shieldActionToken(lead.id, "dismiss")}`;
    const sigList = v.signals.filter((s) => s.pts > 0).map((s) => `• ${s.key} (+${s.pts})${s.note ? ` — ${s.note}` : ""}`).join("<br>");
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject: `🛡️ Tier-1 lead held for review — ${lead.full_name || lead.email || lead.phone}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">
A <b>Tier 1</b> lead was quarantined by the shield (risk ${v.risk}) — no auto-contact was sent.<br><br>
<b>${lead.full_name || "?"}</b> · ${lead.email || "-"} · ${lead.phone || "-"} · ${lead.loan_purpose || "-"}<br><br>${sigList}<br><br>
<a href="${pl}" style="display:inline-block;background:#0c7a52;color:#fff;font-weight:600;padding:8px 18px;border-radius:8px;text-decoration:none">✓ Real — release &amp; work it</a>&nbsp;&nbsp;
<a href="${dl}" style="display:inline-block;background:#7f1d1d;color:#fff;font-weight:600;padding:8px 18px;border-radius:8px;text-decoration:none">✕ Junk — dismiss</a><br><br>
Or open it in the CRM: <a href="${app}/leads">${app}/leads</a></div>`,
      }),
    });
  } catch { /* best-effort */ }
}

/** Per-surface abuse gate for expensive public endpoints (Mark chat). */
export async function surfaceGate(ip: string | null, channel: ShieldChannel): Promise<{ allowed: boolean; degraded: boolean }> {
  try {
    if (channel === "mark") {
      if ((await cfg("SHIELD_MODE").catch(() => "shadow")) === "off") return { allowed: true, degraded: false };
      // Default is deliberately generous — an office NAT shares one IP.
      const ipCap = Number((await cfg("SHIELD_MARK_DAILY_IP_CAP").catch(() => ""))) || 240;
      const globalCap = Number((await cfg("SHIELD_MARK_GLOBAL_DAY_CAP").catch(() => ""))) || 1500;
      const ipOk = !ip || (await rateLimit(`shield:mark:day:${ip}`, ipCap, 86400));
      const globalOk = await rateLimit("shield:mark:global:day", globalCap, 86400);
      return { allowed: true, degraded: !ipOk || !globalOk };
    }
    return { allowed: true, degraded: false };
  } catch { return { allowed: true, degraded: false }; }
}
