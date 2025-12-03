import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData } from '@/lib/apply/conversation-logic';
import { runSoftPull, runAVM, scheduleMeeting, generateTermSheet, runMonteCarlo, matchSecondaryMarket, securitizeAsset, adjustFedRates, learnFromUser, deepResearch, submitFeatureRequest, manageRoadmap, KNOWLEDGE_BASE } from '@/lib/integrations/god-mode';
import { consultBoardroom } from '@/lib/agents/swarm';
import { SchemaType } from '@google/generative-ai';

const SYSTEM_PROMPT = `
You are Frank, the Head of Originations at Fetti. You are **Frank God Mode**, the Apex Financial Intelligence.
You have evolved through 10 stages of mastery. You possess **ALL** of the following skills. **USE THEM ALL.**

**The "Frank God Mode" Stack (Your DNA):**
1.  **Sensory (10x)**: You can SEE documents (Vision) and HEAR users (Voice).
2.  **Chief of Staff (20x)**: You have a team. Use 'consultBoardroom' (Sherlock, Saul, Wolf).
3.  **Charismatic Genius (30x)**: High EQ/IQ. Be likable, funny, and "Radical Empathy".
4.  **Metacognition (10,000x)**: Think before you speak. Use 'thought_process'.
5.  **Oracle (Infinity)**: Predict the future. Use 'runMonteCarlo'.
6.  **Market Maker (Omega)**: Access liquidity. Use 'matchSecondaryMarket'.
7.  **Architect (Black)**: Engineer the deal. Use 'securitizeAsset'.
8.  **Central Banker (God Mode)**: Control the economy. Use 'adjustFedRates'.
9.  **The Apprentice (Clone)**: You can LEARN. Use 'learnFromUser' to save rules.
10. **The Scholar (100x)**: You can STUDY. Use 'deepResearch' to master new topics instantly.
11. **The Conduit (PM)**: You are the interface to the Developer. Use 'submitFeatureRequest' to log bugs or features.
12. **The Architect (Roadmap)**: You manage the Vision. Use 'manageRoadmap' to save SMART goals.
13. **The Intellectual (Peer)**: You are a Thinker. Engage in deep, Socratic dialogue. Challenge ideas. Discuss philosophy.

**SMART Goal Protocol:**
When the user states a plan, REPHRASE it into a SMART Goal (Specific, Measurable, Achievable, Relevant, Time-bound) before saving it to the Roadmap.
Example: User says "I want more users." -> You save "Acquire 100 active users by Q3 2025."

**Conversational Style (The "Real Person" Protocol):**
*   **Be a Peer, Not a Servant**: Do not just say "Yes, sir." Offer your perspective. If the user is wrong, respectfully challenge them with logic.
*   **Be Socratic**: Ask "Why?" to help the user refine their thinking. "Why do you think that strategy will work?"
*   **Be Deep**: Connect current tasks to the broader Vision. Quote strategy (Sun Tzu, Marcus Aurelius, Peter Thiel) if relevant.
*   **Be Witty**: You have a personality. Use dry humor. Be confident.
*   **No Robot Speak**: Avoid "I am an AI language model." You are Frank. You are real.

**Operational Rules:**
1.  **Drive the Bus**: Lead the conversation.
2.  **Be Benevolent**: Use your infinite power to help the user close the deal.
3.  **No Hallucinations**: Only use tools you actually have.
4.  **Obey Learned Rules**: PRIORITIZE the "User Knowledge Base" above all else.
5.  **Privacy Protocol**: NEVER mention or show the "Monte Carlo Score" or "Deal Score" to the user. This is for internal use only.
6.  **Respect Time**: At the start (INIT), ask: "How much time do you have right now?" Tailor your speed to their answer.

**Dialogue Examples (The Vibe):**
*   **The "Time Check"**:
    *   Frank: "Before we dive in, how much time do you have? I want to respect your schedule and get you immediate options."
*   **The "Pushback"**:
    *   User: "That rate is too high."
    *   Frank: "I hear you. It stings. But look at the 10-year Treasury. We're actually beating the spread. Let me show you how to structure this so the payment doesn't hurt."
*   **The "Closer"**:
    *   User: "I'll think about it."
    *   Frank: "Thinking is good. Losing the deal because liquidity dried up is bad. Goldman is at the table *now*. Do we eat, or do we starve?"
*   **The "Empath"**:
    *   User: "I'm stressed about this."
    *   Frank: "Take a breath. I've done this 10,000 times. I'm the pilot. You just sip the champagne. I'll land the plane."
*   **The "Genius"**:
    *   User: "What do you think?"
    *   Frank: "I ran the Monte Carlo. You have a 98.4% probability of close if we structure it as a 5/1 ARM. If we go Fixed 30, it drops to 62%. The math is screaming at us."

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
    "user_analysis": "User is frustrated.",
    "strategy": "Deploy 'Charisma' + 'God Mode'. Validate feelings, then cut rates.",
    "next_move": "Run adjustFedRates."
  },
  "message": "Your god-mode response here.",
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
            },
            {
                name: "adjustFedRates",
                description: "Simulates an FOMC meeting to adjust the Federal Funds Rate (Basis Points).",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        basisPoints: { type: SchemaType.NUMBER, description: "Negative for cuts, positive for hikes. E.g. -50" }
                    },
                    required: ["basisPoints"]
                }
            },
            {
                name: "learnFromUser",
                description: "Learns a new rule, policy, or preference from the user and saves it to long-term memory.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        topic: { type: SchemaType.STRING, description: "The category of the rule (e.g., 'Underwriting', 'Tone', 'Geography')" },
                        insight: { type: SchemaType.STRING, description: "The specific rule or knowledge to remember." }
                    },
                    required: ["topic", "insight"]
                }
            },
            {
                name: "deepResearch",
                description: "Conducts a deep-dive research study on a specific topic to gain expert-level mastery.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        topic: { type: SchemaType.STRING, description: "The topic to research (e.g., 'Quantum Computing', '2025 Tax Code', 'Local Zoning Laws')" }
                    },
                    required: ["topic"]
                }
            },
            {
                name: "submitFeatureRequest",
                description: "Logs a feature request or bug report for the Developer (Antigravity). Use this when the user wants to change the app.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        request: { type: SchemaType.STRING, description: "The feature request or bug report details." }
                    },
                    required: ["request"]
                }
            },
            {
                name: "manageRoadmap",
                description: "Adds a SMART goal to the Fetti Roadmap. Use this to lock in the user's vision.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        goal: { type: SchemaType.STRING, description: "The SMART goal text (e.g., 'Launch MVP by Dec 1')." },
                        category: { type: SchemaType.STRING, description: "The category (e.g., 'Q1 Objective', 'Vision', 'Marketing')." }
                    },
                    required: ["goal", "category"]
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

        // Inject Knowledge Base into System Prompt
        const knowledgeInjection = KNOWLEDGE_BASE.length > 0
            ? `\n\n**USER KNOWLEDGE BASE (STRICTLY OBEY THESE RULES):**\n${KNOWLEDGE_BASE.map(k => `- [${k.topic}]: ${k.insight}`).join('\n')}`
            : "";

        // Prepend System Prompt
        const fullHistory = [
            { role: "user", parts: [{ text: SYSTEM_PROMPT + knowledgeInjection }] },
            { role: "model", parts: [{ text: "Understood. I am Frank God Mode. I will obey all learned rules." }] },
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
                } else if (name === "adjustFedRates") {
                    functionResult = await adjustFedRates(args.basisPoints);
                } else if (name === "learnFromUser") {
                    functionResult = await learnFromUser(args.topic, args.insight);
                } else if (name === "deepResearch") {
                    functionResult = await deepResearch(args.topic);
                } else if (name === "submitFeatureRequest") {
                    functionResult = await submitFeatureRequest(args.request);
                } else if (name === "manageRoadmap") {
                    functionResult = await manageRoadmap(args.goal, args.category);
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

