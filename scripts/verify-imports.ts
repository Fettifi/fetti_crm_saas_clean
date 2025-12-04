
// Verify Imports Script
// Run with: npx tsx scripts/verify-imports.ts

async function main() {
    console.log("Verifying Imports...");

    try {
        console.log("Importing Supabase Client...");
        await import('../lib/supabaseClient');
        console.log("✅ Supabase Client OK");
    } catch (e) {
        console.error("❌ Supabase Client Failed:", e);
    }

    try {
        console.log("Importing GitHub Integration...");
        await import('../lib/integrations/github');
        console.log("✅ GitHub Integration OK");
    } catch (e) {
        console.error("❌ GitHub Integration Failed:", e);
    }

    try {
        console.log("Importing Search Integration...");
        await import('../lib/integrations/search');
        console.log("✅ Search Integration OK");
    } catch (e) {
        console.error("❌ Search Integration Failed:", e);
    }

    try {
        console.log("Importing Gemini Client...");
        await import('../lib/gemini');
        console.log("✅ Gemini Client OK");
    } catch (e) {
        console.error("❌ Gemini Client Failed:", e);
    }

    try {
        console.log("Importing God Mode...");
        await import('../lib/integrations/god-mode');
        console.log("✅ God Mode OK");
    } catch (e) {
        console.error("❌ God Mode Failed:", e);
    }

    console.log("Verification Complete.");
}

main();
