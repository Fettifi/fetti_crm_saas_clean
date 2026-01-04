
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

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

async function getWeather(city: string): Promise<any> {
    console.log(`[Mock] Getting Weather for: ${city}`);
    try {
        const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
        const geoData = await geoRes.json();
        if (!geoData.results || geoData.results.length === 0) return { error: `City '${city}' not found.` };
        const { latitude, longitude, name, country } = geoData.results[0];
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m&temperature_unit=fahrenheit`);
        const weatherData = await weatherRes.json();
        return { location: `${name}, ${country}`, temperature: `${weatherData.current.temperature_2m}°F` };
    } catch (e: any) {
        return { error: e.message };
    }
}

async function runTest() {
    console.log("🚀 Starting Simple System Test...");
    const query = "What is the weather in Tokyo?";
    console.log(`User: "${query}"`);

    try {
        const chat = model.startChat();
        let result = await chat.sendMessage(query);
        let response = await result.response;
        let functionCalls = response.functionCalls();

        if (!functionCalls || functionCalls.length === 0) {
            console.log(`❌ FAILED: No tool called.`);
            console.log(`Response: ${response.text()}`);
            process.exit(1);
        }

        const call = functionCalls[0];
        console.log(`Tool Called: ${call.name}`);

        const args = call.args as any;
        const toolResult = await getWeather(args.city);
        console.log(`Tool Result:`, toolResult);

        const toolResponse = {
            functionResponse: {
                name: call.name,
                response: { result: toolResult }
            }
        };

        result = await chat.sendMessage([toolResponse]);
        console.log(`Final Answer: ${result.response.text()}`);
        console.log("\n✅ SYSTEM TEST PASSED.");
        process.exit(0);
    } catch (e: any) {
        console.error(`❌ ERROR: ${e.message}`);
        process.exit(1);
    }
}

runTest();
