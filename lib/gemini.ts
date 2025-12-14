import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

let model: any;

if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Use gemini-2.0-flash as 1.5 is not available for this key
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
} else {
    console.warn("GEMINI_API_KEY is missing. Using mock model.");
    // Mock model that returns a standard error message
    model = {
        startChat: () => ({
            sendMessage: async () => ({
                response: {
                    text: () => JSON.stringify({
                        message: "I am currently offline because my brain (GEMINI_API_KEY) is missing. Please add it to the environment variables.",
                        nextStep: "ERROR",
                        uiType: "text"
                    }),
                    functionCalls: () => []
                }
            })
        })
    };
}

export { model };
