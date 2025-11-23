import { supabaseServer } from "./supabaseClient";

export async function getLeads() {
  const { data, error } = await supabaseServer
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading leads:", error.message);
    return [];
  }
  return data ?? [];
}

export async function getLeadById(id: string) {
  const { data, error } = await supabaseServer
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Error loading lead:", error.message);
    return null;
  }
  return data;
}

export async function getLeadStats() {
  const { data, error } = await supabaseServer
    .from("leads")
    .select("id, score, stage");

  if (error || !data) {
    console.error("Error loading stats:", error?.message);
    return { totalLeads: 0, activeLeads: 0, avgScore: 0 };
  }

  const totalLeads = data.length;
  const activeLeads = data.filter(
    (l) => l.stage && !["Closed", "Dead"].includes(l.stage)
  ).length;
  const scored = data.filter((l) => typeof l.score === "number");
  const avgScore =
    scored.length === 0
      ? 0
      : Math.round(
          scored.reduce((sum, l) => sum + (l.score as number), 0) /
            scored.length
        );

  return { totalLeads, activeLeads, avgScore };
}
