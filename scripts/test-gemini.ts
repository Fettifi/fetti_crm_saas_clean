import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const apiKey = process.env.GEMINI_API_KEY;

async function testModel(modelName: string) {
    console.log(`Testing model: ${modelName}...`);
    try {
        const genAI = new GoogleGenerativeAI(apiKey!);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hello, are you working?");
        console.log(`✅ ${modelName} works! Response: ${result.response.text().substring(0, 50)}...`);
        return true;
    } catch (error: any) {
        console.error(`❌ ${modelName} failed: ${error.message}`);
        return false;
    }
}

async function run() {
    if (!apiKey) {
        console.error("GEMINI_API_KEY is missing in environment.");
        process.exit(1);
    }

    console.log("API Key found. Starting tests...");

    const models = ["gemini-2.0-flash", "gemini-2.0-flash-exp", "gemini-1.5-flash", "gemini-1.5-pro"];

    for (const m of models) {
        await testModel(m);
    }
}

run();
