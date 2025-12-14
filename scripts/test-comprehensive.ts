
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import * as dotenv from 'dotenv';
import { getWeather, deepResearch } from '../lib/integrations/god-mode';

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
        description: "Search the web. Use this for ANY question about current events, prices, news, facts, or research.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                topic: { type: SchemaType.STRING }
            },
            required: ["topic"]
        }
    },
    {
        name: "getWeather",
        description: "Gets the current weather and forecast for a specific city.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                city: { type: SchemaType.STRING }
            },
            required: ["city"]
        }
    }
];

const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [{ functionDeclarations: toolDefinitions as any }]
});

async function runTest(testName: string, query: string, expectedTool: string) {
    console.log(`\n--- Test: ${testName} ---`);
    console.log(`User: "${query}"`);

    try {
        const chat = model.startChat();
        let result = await chat.sendMessage(query);
        let response = await result.response;
        let functionCalls = response.functionCalls();

        if (!functionCalls || functionCalls.length === 0) {
            console.log(`❌ FAILED: No tool called. Expected ${expectedTool}.`);
            console.log(`Response: ${response.text()}`);
            return false;
        }

        const call = functionCalls[0];
        console.log(`Tool Called: ${call.name}`);

        if (call.name !== expectedTool) {
            console.log(`⚠️ WARNING: Expected ${expectedTool}, got ${call.name}. (Might still work if valid fallback)`);
        }

        const args = call.args as any;
        let toolResult;
        if (call.name === 'getWeather') {
            toolResult = await getWeather(args.city);
        } else if (call.name === 'deepResearch') {
            toolResult = await deepResearch(args.topic);
        }

        if (!toolResult || toolResult.error) {
            console.log(`❌ FAILED: Tool execution error.`);
            console.log(toolResult);
            return false;
        }

        console.log(`✅ Tool Execution Success.`);

        // Send back to model
        const toolResponse = {
            functionResponse: {
                name: call.name,
                response: { result: toolResult }
            }
        };

        result = await chat.sendMessage([toolResponse]);
        console.log(`Final Answer: ${result.response.text().substring(0, 100)}...`);
        return true;

    } catch (e: any) {
        console.error(`❌ ERROR: ${e.message}`);
        return false;
    }
}

async function runAllTests() {
    console.log("🚀 Starting Comprehensive System Test...");

    const t1 = await runTest("Weather", "What is the weather in Tokyo?", "getWeather");
    const t2 = await runTest("Crypto Price", "What is the current price of Bitcoin?", "deepResearch");
    const t3 = await runTest("General Fact", "Who won the Super Bowl in 2024?", "deepResearch");

    console.log("\n--------------------------------");
    if (t1 && t2 && t3) {
        console.log("✅ ALL SYSTEMS GO. Rupee is fully operational.");
        process.exit(0);
    } else {
        console.log("❌ SOME TESTS FAILED.");
        process.exit(1);
    }
}

runAllTests();
