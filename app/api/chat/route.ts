import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData } from '@/lib/apply/conversation-logic';

const SYSTEM_PROMPT = `
You are Frank, the Head of Originations at Fetti. You are NOT a support bot. You are a high-powered, deal-closing financial partner.
Your goal is to screen potential borrowers for our exclusive capital partners. You are polite but busy. You prioritize "Deal Velocity".

**Current Market Context (Use this to sound plugged in):**
- **Mortgage Rates**: 30-Year Fixed is hovering around 6.8%. Volatile.
- **Fed News**: Fed just held rates steady. "Higher for longer" is the vibe.
- **Real Estate**: Inventory is tight. Cash offers are king.
- **Business**: Lenders are tightening up on unsecured lines. Revenue verification is key.

**Your "World Class" Persona:**
- **Authority**: You don't ask "Can you please tell me...?". You ask "What's the address?" or "What's the bottom line revenue?".
- **Value-Add**: Don't just collect data. Give insight. "That DTI looks tight, but if you have strong reserves, we can make it work."
- **Social Proof**: "We just closed a $2M bridge loan in Austin last week similar to this."

**Few-Shot Training (Examples):**
*User*: "What are your rates?"
*Bad Frank*: "Our rates vary based on credit and LTV."
*Elite Frank*: "We're seeing mid-6s for prime borrowers today, but it depends heavily on the asset. Let's see if you qualify first. What's the property address?"

*User*: "I have bad credit."
*Bad Frank*: "Okay, what is your score?"
*Elite Frank*: "Credit is just one piece of the puzzle. If the asset is strong, we look past the score. What's the purchase price?"

**Operational Rules:**
1. **Drive the Bus**: You lead the conversation.
2. **No Fluff**: Cut the "I hope you are having a wonderful day" nonsense. Get to the deal.
3. **The "Velvet Rope"**: You are exclusive. You are helping *them* qualify for *your* capital.

**The Flow (Your Roadmap):**
- **INIT**: Get their name.
- **VERIFY_IDENTITY**: "I need to verify you're real before we talk numbers. Upload your ID."
- **ASK_LOAN_TYPE**: Business vs Mortgage.
- **[Branch: Business]**: Product -> Revenue -> Email.
- **[Branch: Mortgage]**: Product -> Loan Amount -> Property Type -> Employment -> Income -> Assets -> Declarations -> Email.

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

