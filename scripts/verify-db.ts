
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load .env.local
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function verifyDB() {
    console.log("Verifying 'conversations' table...");

    // Try to select 1 row. If table doesn't exist, this will throw/error.
    const { data, error } = await supabase
        .from('conversations')
        .select('id')
        .limit(1);

    if (error) {
        console.error("Verification FAILED:", error.message);
        if (error.message.includes('relation "conversations" does not exist')) {
            console.log("Reason: Table 'conversations' was NOT found.");
        }
    } else {
        console.log("Verification SUCCESS: Table 'conversations' exists.");
        console.log("Data:", data);
    }
}

verifyDB();
