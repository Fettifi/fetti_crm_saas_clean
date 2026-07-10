// Rupee's EXECUTIVE-ASSISTANT toolkit — real business actions, not simulations.
// Ramon directs Rupee like a chief of staff: "email this borrower," "text that agent,"
// "remind me to follow up." These execute for real (Resend + Twilio + org_tasks) and
// log everything to the conversation timeline. Every send is a HUMAN-DIRECTED 1:1
// action Ramon initiated — a different legal posture than the automated nurture engine
// (which can't confirm each send, so it hard-gates on consent). We still surface the
// compliance line so Ramon never sends marketing to a non-consented number by reflex.
import { supabaseAdmin } from "@/lib/supabaseAdminClient";
import { sendSms, sendEmail, logComms } from "@/lib/comms";
import { logActivity } from "@/lib/activity";
import { canonicalPhone, phoneMatchForms } from "@/lib/phone";

type LeadLite = { id: string; full_name: string | null; email: string | null; phone: string | null; stage: string | null; tier: string | null; raw: any };

function smsConsented(raw: any): boolean {
  return raw?.sms_consent === true || raw?.consent?.sms_optin === true;
}

// Resolve a recipient string that may be a lead name, an email, or a phone number,
// to a lead row (best match) plus the literal contact if it's a raw address/number.
async function resolveContact(q: string): Promise<{ lead: LeadLite | null; email: string | null; phone: string | null }> {
  const s = String(q || "").trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  const digits = s.replace(/\D/g, "");
  const isPhone = digits.length >= 10;
  const sel = "id,full_name,email,phone,stage,tier,raw";
  let lead: LeadLite | null = null;
  if (isEmail) {
    const { data } = await supabaseAdmin.from("leads").select(sel).ilike("email", s).order("created_at", { ascending: false }).limit(1).maybeSingle();
    lead = (data as any) || null;
  } else if (isPhone) {
    const canon = canonicalPhone(s);
    const forms = canon ? phoneMatchForms(canon) : [digits];
    const { data } = await supabaseAdmin.from("leads").select(sel).or(forms.map((f) => `phone.eq.${f}`).join(",")).order("created_at", { ascending: false }).limit(1).maybeSingle();
    lead = (data as any) || null;
  } else if (s) {
    const { data } = await supabaseAdmin.from("leads").select(sel).ilike("full_name", `%${s}%`).order("created_at", { ascending: false }).limit(1).maybeSingle();
    lead = (data as any) || null;
  }
  return { lead, email: isEmail ? s : lead?.email || null, phone: isPhone ? s : lead?.phone || null };
}

/** Find a lead/contact by name, email, or phone — returns their info + whether we can text them. */
export async function findContact(query: string) {
  const { lead } = await resolveContact(query);
  if (!lead) return { found: false, message: `No contact matches "${query}".` };
  return {
    found: true,
    id: lead.id, name: lead.full_name, email: lead.email, phone: lead.phone,
    stage: lead.stage, tier: lead.tier,
    sms_consent: smsConsented(lead.raw),
    note: smsConsented(lead.raw) ? "Textable — SMS consent on file." : "No SMS consent on file — email is safe; a 1:1 text is your call but keep it non-promotional.",
  };
}

/** Send a real email from Fetti to a contact (by name or address). Logs to the thread. */
export async function assistantSendEmail(to: string, subject: string, body: string) {
  const { lead, email } = await resolveContact(to);
  if (!email) return { ok: false, error: `No email found for "${to}".` };
  const html = `<div style="font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#0f172a">${String(body).replace(/\n/g, "<br>")}</div>`;
  const r = await sendEmail(email, subject, { html, text: body });
  if (!r.ok) return { ok: false, error: `Email failed: ${r.detail}` };
  await logComms({ leadId: lead?.id || null, channel: "email", direction: "outbound", type: "assistant", subject, body, to: email, status: "sent", providerId: r.id, actor: "rupee" }).catch(() => {});
  return { ok: true, sent_to: email, subject, id: r.id, message: `Email sent to ${lead?.full_name || email}.` };
}

/** Send a real SMS to a contact. Human-directed 1:1; flags (does not block) missing consent. */
export async function assistantSendText(to: string, message: string) {
  const { lead, phone } = await resolveContact(to);
  if (!phone) return { ok: false, error: `No phone found for "${to}".` };
  const consented = lead ? smsConsented(lead.raw) : true; // unknown number Ramon typed = his business contact
  const r = await sendSms(phone, message);
  if (!r.ok) return { ok: false, error: `Text failed: ${r.detail}` };
  await logComms({ leadId: lead?.id || null, channel: "sms", direction: "outbound", type: "assistant", body: message, to: phone, status: "sent", providerId: r.sid, actor: "rupee" }).catch(() => {});
  return {
    ok: true, sent_to: phone, sid: r.sid,
    message: `Text sent to ${lead?.full_name || phone}.`,
    ...(consented ? {} : { compliance_note: "⚠️ No SMS consent on file for this contact. That's fine for a 1:1 message you directed, but do NOT send marketing/promotional texts to non-consented numbers (TCPA)." }),
  };
}

/** Create a follow-up / task for Ramon. dueInHours optional. */
export async function assistantCreateTask(title: string, detail?: string, dueInHours?: number) {
  const due = typeof dueInHours === "number" && dueInHours > 0 ? new Date(Date.now() + dueInHours * 3600_000).toISOString() : null;
  const { data, error } = await supabaseAdmin.from("org_tasks").insert({
    title: `⭐ ${title}`, detail: detail || null, source: "rupee", status: "open", priority: 6, due_at: due, cadence: "once",
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  await logActivity({ entity_type: "org", entity_id: "rupee", actor: "rupee", action: "task.created", detail: { title } }).catch(() => {});
  return { ok: true, id: data?.id, message: `Task created${due ? ` (due ${new Date(due).toLocaleString()})` : ""}: ${title}` };
}

/** List Ramon's open tasks (the assistant's to-do view). */
export async function assistantListTasks() {
  const { data } = await supabaseAdmin.from("org_tasks").select("id,title,detail,priority,due_at,created_at").eq("status", "open").order("priority", { ascending: false }).order("created_at", { ascending: true }).limit(30);
  return { count: (data || []).length, tasks: (data || []).map((t: any) => ({ id: t.id, title: t.title, detail: t.detail, priority: t.priority, due: t.due_at })) };
}

/** Mark a task done by id (or by fuzzy title match). */
export async function assistantCompleteTask(idOrTitle: string) {
  let id = idOrTitle;
  if (!/^[0-9a-f-]{36}$/i.test(idOrTitle)) {
    const { data } = await supabaseAdmin.from("org_tasks").select("id").eq("status", "open").ilike("title", `%${idOrTitle}%`).limit(1).maybeSingle();
    if (!data) return { ok: false, error: `No open task matches "${idOrTitle}".` };
    id = (data as any).id;
  }
  await supabaseAdmin.from("org_tasks").update({ status: "done", completed_at: new Date().toISOString(), completed_by: "rupee" }).eq("id", id);
  return { ok: true, message: "Task marked done." };
}
