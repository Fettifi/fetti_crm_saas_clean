
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env' });

async function diagnose() {
    console.log("🔍 STARTING SYSTEM DIAGNOSIS 🔍\n");
    let hasErrors = false;

    // 1. Environment Variables
    console.log("--- 1. Environment Variables ---");
    const requiredVars = ['GEMINI_API_KEY', 'TAVILY_API_KEY', 'GITHUB_TOKEN', 'DATABASE_URL'];
    for (const v of requiredVars) {
        if (process.env[v]) {
            console.log(`✅ ${v}: Present`);
        } else {
            console.log(`❌ ${v}: MISSING`);
            hasErrors = true;
        }
    }

    // 2. Gemini API
    console.log("\n--- 2. Gemini API Connectivity ---");
    if (process.env.GEMINI_API_KEY) {
        try {
            const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            // Test the model currently configured in lib/gemini.ts (gemini-2.0-flash)
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const result = await model.generateContent("Ping");
            const response = await result.response;
            console.log(`✅ Gemini (gemini-2.0-flash): Connected. Response: "${response.text().trim()}"`);
        } catch (e: any) {
            console.log(`❌ Gemini Connection Failed: ${e.message}`);
            hasErrors = true;
        }
    } else {
        console.log("⚠️ Skipping Gemini test (No Key)");
    }

    // 3. Tavily API
    console.log("\n--- 3. Tavily API Connectivity ---");
    if (process.env.TAVILY_API_KEY) {
        try {
            const response = await fetch("https://api.tavily.com/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    api_key: process.env.TAVILY_API_KEY,
                    query: "test",
                    search_depth: "basic",
                    max_results: 1
                })
            });
            if (response.ok) {
                console.log("✅ Tavily: Connected");
            } else {
                console.log(`❌ Tavily Failed: ${response.status} ${response.statusText}`);
                hasErrors = true;
            }
        } catch (e: any) {
            console.log(`❌ Tavily Error: ${e.message}`);
            hasErrors = true;
        }
    } else {
        console.log("⚠️ Skipping Tavily test (No Key)");
    }

    // 4. GitHub API
    console.log("\n--- 4. GitHub API Connectivity ---");
    console.log("⚠️ Skipping GitHub test (Octokit ESM issue)");

    // 5. Database
    console.log("\n--- 5. Database Connectivity ---");
    if (process.env.DATABASE_URL) {
        const client = new pg.Client({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false } // Often needed for hosted Postgres
        });
        try {
            await client.connect();
            const res = await client.query('SELECT NOW()');
            console.log(`✅ Database: Connected. Time: ${res.rows[0].now}`);
            await client.end();
        } catch (e: any) {
            console.log(`❌ Database Failed: ${e.message}`);
            hasErrors = true;
        }
    } else {
        console.log("⚠️ Skipping Database test (No URL)");
    }

    console.log("\n--------------------------------");
    if (hasErrors) {
        console.log("🚨 DIAGNOSIS COMPLETE: ERRORS FOUND 🚨");
        process.exit(1);
    } else {
        console.log("✨ DIAGNOSIS COMPLETE: ALL SYSTEMS GO ✨");
        process.exit(0);
    }
}

diagnose();
