
import { searchWeb } from '../lib/integrations/search';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function diagnoseSearch() {
    console.log("Diagnosing Search (Basic Mode)...");
    const query = "What is the current price of Bitcoin?";
    console.log(`Query: "${query}"`);

    const results = await searchWeb(query);

    console.log(`Results found: ${results.length}`);

    results.forEach((r, i) => {
        console.log(`\n[Result ${i + 1}]`);
        console.log(`Title: ${r.title}`);
        console.log(`URL: ${r.url}`);
        console.log(`Content Preview: ${r.content.substring(0, 200)}...`);
    });

    const hasDirectAnswer = results.some(r => r.title === "Direct Answer");
    if (hasDirectAnswer) {
        console.log("\n✅ Direct Answer found!");
    } else {
        console.log("\n❌ NO Direct Answer found.");
    }
}

diagnoseSearch();
