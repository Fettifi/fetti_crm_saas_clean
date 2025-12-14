
import { runSoftPull, runTerminal } from '../lib/integrations/god-mode';

// Mock other tools if needed, or just import them
// We want to test the loop logic specifically

async function testLoop() {
    console.log("Starting Loop Test...");

    const functionCalls = [
        { name: 'runTerminal', args: { command: 'echo "Hello World"' } },
        { name: 'unknownTool', args: {} } // Test unknown tool handling
    ];

    const toolPromises = functionCalls.map(async (call: any) => {
        const name = call.name;
        const args = call.args as any;
        let functionResult;

        console.log(`Executing ${name}...`);

        try {
            if (name === "runTerminal") functionResult = await runTerminal(args.command);
            // ... (simulate other tools)
            else if (name === "unknownTool") {
                // Do nothing, functionResult remains undefined
            }
        } catch (e) {
            console.error(`Error in ${name}:`, e);
            functionResult = { error: String(e) };
        }

        return {
            functionResponse: {
                name: name,
                response: { result: functionResult }
            }
        };
    });

    const toolResponses = await Promise.all(toolPromises);
    console.log("Tool Responses:", JSON.stringify(toolResponses, null, 2));

    // Check if any result is undefined
    const hasUndefined = toolResponses.some(r => r.functionResponse.response.result === undefined);
    if (hasUndefined) {
        console.error("FAILURE: Found undefined result! This might crash Gemini.");
    } else {
        console.log("SUCCESS: All results defined.");
    }
}

testLoop();
