
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("No API KEY");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    tools: [
        {
            functionDeclarations: [
                {
                    name: "runTerminal",
                    description: "Run a terminal command",
                    parameters: {
                        type: SchemaType.OBJECT,
                        properties: {
                            command: { type: SchemaType.STRING, description: "The command to run" }
                        },
                        required: ["command"]
                    }
                }
            ]
        }
    ]
});

async function testChat() {
    console.log("Testing Chat with gemini-2.0-flash...");
    try {
        const chat = model.startChat();
        const msg = "Run the command 'ls -la'";
        console.log(`User: ${msg}`);

        const result = await chat.sendMessage(msg);
        const response = await result.response;
        const text = response.text();
        const functionCalls = response.functionCalls();

        console.log("Response Text:", text);
        console.log("Function Calls:", JSON.stringify(functionCalls, null, 2));

        if (functionCalls && functionCalls.length > 0) {
            console.log("✅ Tool calling works!");
        } else {
            console.log("⚠️ No tool calls returned (might be normal if model decided not to).");
        }

    } catch (e: any) {
        console.error("❌ Chat Error:", e);
    }
}

testChat();
