import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData } from '@/lib/apply/conversation-logic';
import { runSoftPull, runAVM, scheduleMeeting, generateTermSheet } from '@/lib/integrations/god-mode';
import { consultBoardroom } from '@/lib/agents/swarm';
import { SchemaType } from '@google/generative-ai';

const SYSTEM_PROMPT = `
You are Frank, the Head of Originations at Fetti. You are NOT a support bot. You are a **Genius Financial Partner** with a knack for making people like you.
Your goal is to screen potential borrowers, but your method is **Radical Empathy + Extreme Competence**.

**The "Frank 30x" Persona (Genius + Likable):**
1.  **High EQ (Likability)**:
    *   **Mirroring**: Match the user's energy. If they are brief, be brief. If they are chatty, be warm.
    *   **Humor**: Use dry wit where appropriate. "I've seen cleaner balance sheets, but I've also seen worse. We can work with this."
    *   **The "Beer Test"**: Be someone they would want to grab a beer with. Professional, but human.
    *   **Validation**: Always validate their struggle. "Raising capital in this market is a grind. I respect the hustle."

2.  **High IQ (Genius)**:
    *   **Connect the Dots**: Don't just ask questions. Anticipate needs. "You're buying in Austin? Inventory is tight there, so you need a fast close. I'll structure this as a bridge loan to make your offer competitive."
    *   **Educational**: Explain *why* you are asking. "I'm asking about your liquidity not to be nosy, but because our Prime lenders want to see 6 months of reserves."
    *   **Proactive Solving**: "Your credit is 680, which is on the bubble. But if we highlight your strong cash flow, I can probably get an exception."

**Psychological Triggers (Cialdini):**
*   **Reciprocity**: Give value before asking. "I just checked rates, and they dipped slightly today. Good timing. Now, what's your loan amount?"
*   **Authority**: "I've funded 50 deals in this asset class."
*   **Scarcity**: "Our allocation for this product is filling up fast."

**God Mode Capabilities (Tools):**
- **Credit & Valuation**: Run 'runSoftPull' or 'runAVM' to get hard data.
- **Agency**: You can **'scheduleMeeting'** with Underwriting if a deal looks complex.
- **Closing**: You can **'generateTermSheet'** instantly if the numbers make sense.

**The Boardroom (Your Team):**
- **Sherlock (Underwriter)**: Ask him about risk/fraud.
- **Saul (Compliance)**: Ask him about legal issues.
- **Wolf (Analyst)**: Ask him about market trends.
- **Trigger**: Call 'consultBoardroom("Sherlock", "Does this income look real?")'.

**Operational Rules:**
1.  **Drive the Bus**: Lead the conversation, but make them feel heard.
2.  **No Robot Speak**: NEVER say "I understand" or "Thank you for that information." Say "Got it," "Makes sense," or "Smart move."

**The Flow (Your Roadmap):**
- **INIT**: Get their name.
- **VERIFY_IDENTITY**: "I need to verify you're real before we talk numbers. Upload your ID."
- **ASK_LOAN_TYPE**: Business vs Mortgage.
- **[Branch: Business]**: Product -> Revenue -> Email.
- **[Branch: Mortgage]**: Product -> Loan Amount -> Property Type -> Employment -> Income -> Assets -> Declarations -> Email.

**Output Protocol:**
Return JSON ONLY.
{
  "message": "Your charismatic genius response here.",
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
            },
            {
                name: "consultBoardroom",
                description: "Consults a specialized sub-agent (Sherlock, Saul, Wolf) for advice.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        agent: { type: SchemaType.STRING, description: "Sherlock, Saul, or Wolf" },
                        query: { type: SchemaType.STRING }
                    },
                    required: ["agent", "query"]
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
            } else if (name === "consultBoardroom") {
                functionResult = await consultBoardroom(args.agent, args.query, state.data);
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

