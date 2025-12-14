// lib/supabaseAdminClient.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabaseAdmin: any;

if (supabaseUrl && serviceRoleKey) {
  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
} else {
  console.warn("Supabase Admin environment variables missing. Using mock client.");
  // Mock builder to handle chained calls: .from().insert().select().single()
  const mockBuilder = {
    select: () => mockBuilder,
    single: async () => ({ data: null, error: { message: "Supabase Admin Client Disabled (Missing Env Vars)" } }),
    insert: () => mockBuilder,
    update: () => mockBuilder,
    delete: () => mockBuilder,
    eq: () => mockBuilder
  };

  supabaseAdmin = {
    from: () => mockBuilder,
    auth: {
      admin: {
        createUser: async () => ({ data: null, error: { message: "Supabase Admin Disabled" } }),
        deleteUser: async () => ({ data: null, error: { message: "Supabase Admin Disabled" } })
      }
    }
  };
}

export { supabaseAdmin };
