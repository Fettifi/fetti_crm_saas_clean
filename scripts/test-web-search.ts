
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import * as dotenv from 'dotenv';
import { searchWeb } from '../lib/integrations/search';

dotenv.config({ path: '.env' });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("No API KEY");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const toolDefinitions = [
    {
        name: "deepResearch",
        description: "Performs web search to find real-time information, prices, news, or deep research on any topic.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                topic: { type: SchemaType.STRING }
            },
            required: ["topic"]
        }
    }
];

const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [{ functionDeclarations: toolDefinitions as any }]
});

async function testWebSearch() {
    console.log("Testing Web Search with gemini-2.0-flash...");
    try {
        const chat = model.startChat();
        const msg = "What is the current price of Bitcoin?";
        console.log(`User: ${msg}`);

        // 1. First Turn
        let result = await chat.sendMessage(msg);
        let response = await result.response;
        let functionCalls = response.functionCalls();

        console.log("Initial Function Calls:", JSON.stringify(functionCalls, null, 2));

        if (!functionCalls || functionCalls.length === 0) {
            console.log("❌ No tool call made. Model response:", response.text());
            return;
        }

        // 2. Execute Tool
        const call = functionCalls[0];
        if (call.name === 'deepResearch') {
            const args = call.args as any;
            console.log(`Executing deepResearch('${args.topic}')...`);

            const searchResults = await searchWeb(args.topic);
            const summary = searchResults.map(r => `Source: ${r.title}\nContent: ${r.content}`).join("\n\n");
            console.log("--- Search Summary ---");
            console.log(summary);
            console.log("----------------------");

            const toolResult = {
                status: "RESEARCH_COMPLETE",
                topic: args.topic,
                insight: summary,
                source: "The Oracle (Live Web)"
            };

            console.log("Tool Result generated.");

            // 3. Send Result back to Model
            const toolResponse = {
                functionResponse: {
                    name: 'deepResearch',
                    response: { result: toolResult }
                }
            };

            result = await chat.sendMessage([toolResponse]);
            response = await result.response;
            const text = response.text();

            console.log("\n--- Final Response ---");
            console.log(text);
        }

    } catch (e: any) {
        console.error("❌ Error:", e);
    }
}

testWebSearch();
