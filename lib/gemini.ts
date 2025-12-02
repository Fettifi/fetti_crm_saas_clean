import { GoogleGenerativeAI } from "@google/generative-ai";

if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use the latest experimental model for best performance/reasoning
export const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
