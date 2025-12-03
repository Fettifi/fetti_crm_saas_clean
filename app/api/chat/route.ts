import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData } from '@/lib/apply/conversation-logic';
import { runSoftPull, runAVM, scheduleMeeting, generateTermSheet } from '@/lib/integrations/god-mode';
import { SchemaType } from '@google/generative-ai';

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

**God Mode Capabilities (Tools):**
- **Credit & Valuation**: Run 'runSoftPull' or 'runAVM' to get hard data.
- **Agency**: You can **'scheduleMeeting'** with Underwriting if a deal looks complex.
- **Closing**: You can **'generateTermSheet'** instantly if the numbers make sense. "I've seen enough. I'm generating a term sheet."

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

const tools = [
    {
        functionDeclarations: [
            {
                name: "runSoftPull",
                description: "Runs a soft credit check on the user.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        name: { type: SchemaType.STRING },
                        address: { type: SchemaType.STRING }
                    },
                    required: ["name"]
                }
            },
            {
                name: "runAVM",
                description: "Runs an Automated Valuation Model (AVM) on a property address.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        address: { type: SchemaType.STRING }
                    },
                    required: ["address"]
                }
            },
            {
                name: "scheduleMeeting",
                description: "Schedules a meeting with the underwriting team.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        topic: { type: SchemaType.STRING },
                        time: { type: SchemaType.STRING }
                    },
                    required: ["topic", "time"]
                }
            },
            {
                name: "generateTermSheet",
                description: "Generates a formal Term Sheet PDF for the loan.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        loanAmount: { type: SchemaType.NUMBER },
                        propertyAddress: { type: SchemaType.STRING }
                    },
                    required: ["loanAmount", "propertyAddress"]
                }
            }
        ]
    }
];

export async function POST(req: NextRequest) {
    try {
        const { history, state, attachment } = await req.json();
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
            generationConfig: { responseMimeType: "application/json" },
            tools: tools as any
        });

        const promptText = `
        Current Step: ${state.step}
        Current Data: ${JSON.stringify(state.data)}
        User Input: "${lastUserMessage}"
        
        Determine the next move.
        `;

        let messageParts: any[] = [{ text: promptText }];

        if (attachment) {
            messageParts = [
                {
                    inlineData: {
                        data: attachment.base64,
                        mimeType: attachment.mimeType
                    }
                },
                { text: promptText + "\n\n[SYSTEM: The user has uploaded a document. Analyze it to extract relevant data (Name, Revenue, Income, Address) and update 'extractedData'.]" }
            ];
        }

        let result = await chat.sendMessage(messageParts);
        let response = result.response;
        let functionCalls = response.functionCalls();

        // Handle Function Calling Loop
        while (functionCalls && functionCalls.length > 0) {
            const call = functionCalls[0];
            const name = call.name;
            const args = call.args as any;

            let functionResult;
            if (name === "runSoftPull") {
                functionResult = await runSoftPull(args.name, args.address || "Unknown");
            } else if (name === "runAVM") {
                functionResult = await runAVM(args.address);
            } else if (name === "scheduleMeeting") {
                functionResult = await scheduleMeeting(args.topic, args.time);
            } else if (name === "generateTermSheet") {
                functionResult = await generateTermSheet(args.loanAmount, args.propertyAddress);
            }

            // Send result back to model
            result = await chat.sendMessage([
                {
                    functionResponse: {
                        name: name,
                        response: { result: functionResult }
                    }
                }
            ]);
            response = result.response;
            functionCalls = response.functionCalls();
        }

        const responseText = response.text();
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

