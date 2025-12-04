import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Resilient initialization: Return a real client if configured, otherwise a mock.
// This prevents crashes on import while still allowing the app to build.
let client: SupabaseClient;

if (supabaseUrl && supabaseAnonKey) {
  client = createClient(supabaseUrl, supabaseAnonKey);
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
