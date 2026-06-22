import { ReactNode } from "react";

// The CRM shell (sidebar + top bar + mobile drawer) is now provided globally by
// AppChrome in the root layout, so every CRM route gets consistent navigation
// and a Back button. This component is kept as a passthrough so the route-group
// layouts that import it keep working without double-wrapping the chrome.
export default function CrmShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
