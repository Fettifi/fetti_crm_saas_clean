
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import * as dotenv from 'dotenv';
import { getWeather } from '../lib/integrations/god-mode';

dotenv.config({ path: '.env' });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("No API KEY");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const toolDefinitions = [
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

async function testGetWeather() {
    console.log("Testing getWeather Tool with gemini-2.0-flash...");
    try {
        const chat = model.startChat();
        const msg = "What is the weather in Tokyo?";
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
        if (call.name === 'getWeather') {
            const args = call.args as any;
            console.log(`Executing getWeather('${args.city}')...`);

            const weatherResult = await getWeather(args.city);
            console.log("Tool Result:", JSON.stringify(weatherResult, null, 2));

            // 3. Send Result back to Model
            const toolResponse = {
                functionResponse: {
                    name: 'getWeather',
                    response: { result: weatherResult }
                }
            };

            result = await chat.sendMessage([toolResponse]);
            response = await result.response;
            const text = response.text();

            console.log("\n--- Final Response ---");
            console.log(text);
        } else {
            console.log("❌ Wrong tool called:", call.name);
        }

    } catch (e: any) {
        console.error("❌ Error:", e);
    }
}

testGetWeather();
