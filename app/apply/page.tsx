// /apply — the old AI-chat application page POSTed to the session-gated /api/chat and
// 401'd for every public visitor (dead end, audit P0). Until a public chat intake is
// rebuilt on its own endpoint, every application path routes to the proven wizard.
import { redirect } from "next/navigation";

export default function ApplyPage() {
  redirect("/apply/form");
}
