// LOAD .env.local BEFORE ANY OTHER IMPORT.
//
// ESM hoists every `import` above the module body, so a script that does
//   import * as dotenv from "dotenv"; dotenv.config(...); import { x } from "../lib/y";
// initialises lib/y with an EMPTY process.env. lib/supabaseAdminClient then falls back to a
// mock whose .upsert() does not exist, and every setSetting() in the run fails silently-ish.
//
// That cost a real thing on 2026-08-02: a Twilio Lookup backfill made all 174 paid calls, wrote
// the results to the leads (its own client was fine), and then failed to populate the 90-day
// lookup CACHE — so the live sweep would have paid for all 174 again. The lookups looked
// successful because the part that was billed worked.
//
// Import this FIRST — `import "./_env";` — and env is configured before anything else loads.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
// The admin client reads the NEXT_PUBLIC_ name; scripts commonly have only the bare one.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL;
}
