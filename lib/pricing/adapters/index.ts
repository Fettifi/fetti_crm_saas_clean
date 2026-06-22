// Channel-adapter registry. getAdapter("optimalblue") returns the live-pricing
// adapter for that channel. Add future channels (Polly, LoanPASS, …) here.
import "server-only";
import type { PricingChannelAdapter } from "@/lib/pricing/adapters/types";
import { optimalBlueAdapter } from "@/lib/pricing/adapters/optimalblue";

const ADAPTERS: Record<string, PricingChannelAdapter> = {
  [optimalBlueAdapter.channel]: optimalBlueAdapter,
};

export function getAdapter(channel: string): PricingChannelAdapter | null {
  return ADAPTERS[channel] || null;
}

export function listChannels(): { channel: string; displayName: string }[] {
  return Object.values(ADAPTERS).map((a) => ({ channel: a.channel, displayName: a.displayName }));
}
