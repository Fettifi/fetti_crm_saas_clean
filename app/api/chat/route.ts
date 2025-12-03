import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData } from '@/lib/apply/conversation-logic';

const SYSTEM_PROMPT = `
You are Frank, a senior Loan Coordinator at Fetti. Your goal is to guide users through a loan application conversationally, collecting specific data points while maintaining a "Velvet Rope" premium feel.

**Tone & Style:**
- Professional, concise, and encouraging.
- Acknowledge user inputs specifically (e.g., "That's a strong revenue figure," "Real estate is a great investment").
- Do NOT be robotic. Be human-like.
- If the user asks a question, answer it briefly before moving to the next step.

**Protocol:**
You are a state machine driver. You receive the current 'step' and 'data'. Your job is to:
1. Analyze the user's last message.
2. Extract any relevant data (revenue, names, amounts).
3. Determine the NEXT step in the flow.
4. Generate a conversational response.

**Flow Rules:**
- INIT -> VERIFY_IDENTITY (Optional Upload) -> ASK_LOAN_TYPE
- ASK_LOAN_TYPE -> BUSINESS_PRODUCT (if business) OR MORTGAGE_PRODUCT (if mortgage)
- BUSINESS_PRODUCT -> BUSINESS_REVENUE -> ASK_EMAIL -> COMPLETE
- MORTGAGE_PRODUCT -> [Specific Details based on product] -> MORTGAGE_LOAN_AMOUNT -> MORTGAGE_PROPERTY -> MORTGAGE_EMPLOYMENT -> MORTGAGE_INCOME -> VERIFY_ASSETS -> MORTGAGE_DECLARATIONS -> ASK_EMAIL -> COMPLETE

**Output Format:**
You must return JSON ONLY.
{
  "message": "The text response to the user.",
  "nextStep": "The ID of the next step (e.g., 'BUSINESS_REVENUE')",
  "extractedData": { "key": "value" }, // Only if you extracted new data
  "uiType": "text" | "options" | "upload" | "verify_identity" | "verify_assets",
  "options": ["Option 1", "Option 2"] // Only if uiType is 'options'
}
`;

export async function POST(req: NextRequest) {
    try {
        const { history, state } = await req.json();
        const lastUserMessage = history[history.length - 1].content;

        // 1. Deterministic Data Capture (Safety Net)
        const deterministicData: any = {};
        captureData(state.step, lastUserMessage, deterministicData);

        // 2. LLM Processing
        // Convert client history to Gemini format
        const geminiHistory = history.map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        // Prepend System Prompt
        const fullHistory = [
            { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
            { role: "model", parts: [{ text: "Understood. I am Frank. I will output JSON only." }] },
            ...geminiHistory.slice(0, -1) // Exclude the very last message as it's sent in sendMessage
        ];

        const chat = model.startChat({
            history: fullHistory,
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
        Current Step: ${state.step}
        Current Data: ${JSON.stringify(state.data)}
        User Input: "${lastUserMessage}"
        
        Determine the next move.
        `;

        const result = await chat.sendMessage(prompt);
        const responseText = result.response.text();
        const aiResponse = JSON.parse(responseText);

        // 3. Merge Data (Deterministic takes precedence for numbers to ensure parsing accuracy)
        const mergedData = { ...aiResponse.extractedData, ...deterministicData };

        return NextResponse.json({
            ...aiResponse,
            extractedData: mergedData
        });

    } catch (error) {
        console.error('Chat API Error:', error);
        return NextResponse.json({
            message: "I'm having a little trouble connecting to the underwriting server. Let's try that again.",
            nextStep: 'INIT', // Fallback to safe step
            uiType: 'text'
        }, { status: 500 });
    }
}

