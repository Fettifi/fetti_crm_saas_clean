import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY;

let model: any;

if (apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Use the latest experimental model for best performance/reasoning
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
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
