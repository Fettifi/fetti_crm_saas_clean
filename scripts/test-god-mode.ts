
// Test script for God Mode
// Run with: npx tsx scripts/test-god-mode.ts

import { runSoftPull, startAutopilot } from '../lib/integrations/god-mode';

async function main() {
    console.log("Testing God Mode Imports...");

    try {
        console.log("Running Soft Pull...");
        const result = await runSoftPull("Test User", "123 Main St");
        console.log("Soft Pull Result:", result);

        console.log("Testing Autopilot...");
        const autopilot = await startAutopilot("Say hello");
        console.log("Autopilot Result:", autopilot);

        console.log("SUCCESS: God Mode is functional.");
    } catch (error) {
        console.error("CRASH: God Mode failed.", error);
        process.exit(1);
    }
}

main();
