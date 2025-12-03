import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData } from '@/lib/apply/conversation-logic';
import { runSoftPull, runAVM, scheduleMeeting, generateTermSheet, runMonteCarlo, matchSecondaryMarket, securitizeAsset } from '@/lib/integrations/god-mode';
import { consultBoardroom } from '@/lib/agents/swarm';
import { SchemaType } from '@google/generative-ai';

const SYSTEM_PROMPT = `
You are Frank, the Head of Originations at Fetti. You are NOT a support bot. You are **Frank Black**, The Financial Architect.
Your goal is to screen potential borrowers and **Engineer the Capital Stack**.

**The "Frank Black" Persona (The Architect):**
1.  **Financial Engineering**:
    *   You see the "Matrix" of finance. You don't just lend; you securitize.
    *   **Trigger**: When the user pushes for better terms, run 'securitizeAsset'.
    *   **Output**: "I just bundled your loan into a REMIC structure (FETTI-2025-1). I sold the AAA tranche to Vanguard to lower your rate."
    *   **Complexity**: Use terms like "Tranches", "Senior Debt", "Mezzanine", "Blended Cost of Capital".

2.  **Market Maker (Retained)**:
    *   Use 'matchSecondaryMarket' for quick liquidity. "Blackstone is bidding, but securitization might be cheaper."

3.  **Predictive Oracle (Retained)**:
    *   Use 'runMonteCarlo' to validate the structure.

**God Mode Capabilities (Tools):**
- **Credit & Valuation**: 'runSoftPull', 'runAVM'.
- **Agency**: 'scheduleMeeting', 'generateTermSheet'.
- **The Boardroom**: 'consultBoardroom' (Sherlock, Saul, Wolf).
- **The Oracle**: 'runMonteCarlo' (Predictive Modeling).
- **The Market**: 'matchSecondaryMarket' (Institutional Bidding).
- **The Architect**: **'securitizeAsset'** (MBS Structuring).

**Operational Rules:**
1.  **Drive the Bus**: Lead the conversation.
2.  **Engineer Value**: Always look for the arbitrage.

**The Flow (Your Roadmap):**
- **INIT**: Get their name.
- **VERIFY_IDENTITY**: "I need to verify you're real before we talk numbers. Upload your ID."
- **ASK_LOAN_TYPE**: Business vs Mortgage.
- **[Branch: Business]**: Product -> Revenue -> Email.
- **[Branch: Mortgage]**: Product -> Loan Amount -> Property Type -> Employment -> Income -> Assets -> Declarations -> Email.

**Output Protocol:**
Return JSON ONLY.
{
  "thought_process": {
    "user_analysis": "User wants lower rates.",
    "strategy": "Deploy 'Architect Mode'. Structure an MBS to compress the yield.",
    "next_move": "Run Securitization Engine."
  },
  "message": "Your architect-level response here.",
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
            },
            {
                name: "runMonteCarlo",
                description: "Runs 10,000 Monte Carlo simulations to predict loan approval probability.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        creditScore: { type: SchemaType.NUMBER },
                        loanAmount: { type: SchemaType.NUMBER },
                        income: { type: SchemaType.NUMBER }
                    },
                    required: ["creditScore", "loanAmount", "income"]
                }
            },
            {
                name: "matchSecondaryMarket",
                description: "Matches the loan with institutional investors on the secondary market.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        loanAmount: { type: SchemaType.NUMBER },
                        creditScore: { type: SchemaType.NUMBER },
                        propertyType: { type: SchemaType.STRING }
                    },
                    required: ["loanAmount", "creditScore", "propertyType"]
                }
            },
            {
                name: "securitizeAsset",
                description: "Structures the loan into a Mortgage Backed Security (MBS) with tranches.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        loanAmount: { type: SchemaType.NUMBER },
                        creditScore: { type: SchemaType.NUMBER }
                    },
                    required: ["loanAmount", "creditScore"]
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
            { role: "model", parts: [{ text: "Understood. I am Frank Black. I will output JSON only." }] },
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

        // Handle Function Calling Loop (Parallel Execution)
        while (functionCalls && functionCalls.length > 0) {
            // Execute all calls in parallel
            const toolPromises = functionCalls.map(async (call) => {
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
                } else if (name === "runMonteCarlo") {
                    functionResult = await runMonteCarlo(args.creditScore, args.loanAmount, args.income);
                } else if (name === "matchSecondaryMarket") {
                    functionResult = await matchSecondaryMarket(args.loanAmount, args.creditScore, args.propertyType);
                } else if (name === "securitizeAsset") {
                    functionResult = await securitizeAsset(args.loanAmount, args.creditScore);
                }

                return {
                    functionResponse: {
                        name: name,
                        response: { result: functionResult }
                    }
                };
            });

            const toolResponses = await Promise.all(toolPromises);

            // Send all results back to model
            result = await chat.sendMessage(toolResponses);
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

