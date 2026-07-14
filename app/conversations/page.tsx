import LeadWorkspace from "@/components/LeadWorkspace";

// Conversations merged INTO the unified Leads workspace. This route stays live so old
// links (lead alerts, /conversations?leadId=…) keep landing on the thread.
export default function ConversationsPage() {
  return <LeadWorkspace />;
}
