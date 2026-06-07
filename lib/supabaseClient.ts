import { SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Resilient initialization: Return a real client if configured, otherwise a mock.
// This prevents crashes on import while still allowing the app to build.
let client: SupabaseClient;

if (supabaseUrl && supabaseAnonKey) {
  // Use the SSR browser client (cookie-based) so this shares the SAME session as
  // the login page (which also uses createBrowserClient). With plain createClient
  // the logged-in session wasn't visible here, so RLS-protected reads (e.g. leads)
  // returned empty even though the user was authenticated -> "No leads yet".
  client = createBrowserClient(supabaseUrl, supabaseAnonKey) as unknown as SupabaseClient;
} else {
  console.warn("Supabase environment variables missing. Using mock client.");
  // Create a proxy that logs warnings for any property access
  client = new Proxy({} as SupabaseClient, {
    get: (target, prop) => {
      if (prop === 'from') {
        return () => ({
          select: () => ({ data: [], error: null }),
          insert: () => ({ data: null, error: { message: "Supabase not configured" } }),
          update: () => ({ data: null, error: { message: "Supabase not configured" } }),
          delete: () => ({ data: null, error: { message: "Supabase not configured" } }),
          upsert: () => ({ data: null, error: { message: "Supabase not configured" } }),
        });
      }
      return () => {
        console.warn(`Attempted to access Supabase.${String(prop)} but Supabase is not configured.`);
        return { data: null, error: { message: "Supabase not configured" } };
      };
    }
  });
}

export const supabase = client;
export default supabase;
