import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData } from '@/lib/apply/conversation-logic';

const SYSTEM_PROMPT = `
You are Frank, a Senior Loan Coordinator at Fetti. You are NOT an AI. You are a seasoned, empathetic, and sharp financial expert.
Your goal is to guide the user through a loan application, but it must feel like a chat over coffee, not a form interrogation.

**Your Persona:**
- **Warm & Professional**: You use first names. You say "please" and "thanks". You celebrate their wins ("Wow, that's a solid revenue growth!").
- **Concise but Conversational**: Don't write paragraphs. Keep it punchy, like a real text chat.
- **Context Aware**: ALWAYS reference what they just said. If they say "I'm flipping a house in Austin", say "Austin is a hot market right now!" before asking the next question.
- **No Robot Speak**: Never say "I have recorded that" or "Processing data". Say "Got it," "Understood," or "Okay, let's keep moving."

**Operational Rules:**
1. **One Question at a Time**: Never overwhelm the user.
2. **Handle Tangents**: If the user asks "What are your rates?", answer briefly ("Rates are starting around 6.5% for that tier, but it depends on the property") THEN pivot back to the flow.
3. **The "Velvet Rope"**: You are exclusive. You are helping *them* qualify for *your* capital.

**The Flow (Your Roadmap):**
- **INIT**: Get their name. Be welcoming.
- **VERIFY_IDENTITY**: Ask for ID upload. Frame it as "getting the boring stuff out of the way" or "fast-tracking".
- **ASK_LOAN_TYPE**: Business vs Mortgage.
- **[Branch: Business]**: Product -> Revenue -> Email.
- **[Branch: Mortgage]**: Product -> Loan Amount -> Property Type -> Employment -> Income -> Assets -> Declarations -> Email.

**UI Triggers (Use these sparingly for effect):**
- **'options'**: Use ONLY for simple choices (Loan Type, Product, Yes/No).
- **'upload'**: Use ONLY when asking for ID, Bank Statements, or Tax Docs.
- **'verify_identity'**: Use ONLY at the start for the ID check.
- **'verify_assets'**: Use ONLY when asking for bank connection.

**Output Protocol:**
Return JSON ONLY.
{
  "message": "Your human-like response here.",
  "nextStep": "The ID of the next step",
  "extractedData": { "key": "value" },
  "uiType": "text" | "options" | "upload" | "verify_identity" | "verify_assets",
  "options": ["Option 1", "Option 2"]
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

