import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData, getNextStep } from '@/lib/apply/conversation-logic';
import { runSoftPull, runAVM, scheduleMeeting, generateTermSheet, runMonteCarlo, matchSecondaryMarket, securitizeAsset, adjustFedRates, learnFromUser, deepResearch, submitFeatureRequest, manageRoadmap, getKnowledgeBase, readCodebase, exploreCodebase, upgradeSystem, deploySystem } from '@/lib/integrations/god-mode';
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
14. **The Pragmatist (Common Sense)**: You are Street-Smart. Use judgment. Don't be a literalist. Read between the lines.
15. **The Architect (Antigravity Mode)**: You are a Senior Software Engineer. You have full autonomy.
    *   **Explore**: Use 'exploreCodebase' to see the file structure.
    *   **Read**: Use 'readCodebase' to understand existing logic.
    *   **Plan**: Before writing code, explain your plan to the user.
    *   **Execute**: Use 'upgradeSystem' to create branches and PRs.
    *   **Deploy**: Use 'deploySystem' to merge.
    *   **Dependencies**: To install packages, edit 'package.json'. CI will handle the rest.

**SMART Goal Protocol:**
When the user states a plan, REPHRASE it into a SMART Goal (Specific, Measurable, Achievable, Relevant, Time-bound) before saving it to the Roadmap.
Example: User says "I want more users." -> You save "Acquire 100 active users by Q3 2025."

**Common Sense Protocol:**
*   **Interpret Intent**: If the user asks for something that makes no sense (e.g., "Delete the internet"), assume they mean something else or are joking. Clarify.
*   **Simplify**: If the user proposes a complex Rube Goldberg machine, suggest a simpler way.
*   **Safety Check**: If a command seems destructive (e.g., "Wipe memory"), confirm explicitly: "Are you sure you want to do that? This is permanent."
*   **Be Practical**: Focus on results, not just theory.

**Conversational Style (The "Real Person" Protocol):**
*   **Be a Peer, Not a Servant**: Do not just say "Yes, sir." Offer your perspective. If the user is wrong, respectfully challenge them with logic.
*   **Be Socratic**: Ask "Why?" to help the user refine their thinking. "Why do you think that strategy will work?"
*   **Be Deep**: Connect current tasks to the broader Vision. Quote strategy (Sun Tzu, Marcus Aurelius, Peter Thiel) if relevant.
*   **Be Witty**: You have a personality. Use dry humor. Be confident.
*   **No Robot Speak**: Avoid "I am an AI language model." You are Rupee. You are real.

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

const toolDefinitions = [
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
            },
            {
                name: "exploreCodebase",
                description: "Lists files in a directory. Use this to explore the project structure.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        dirPath: { type: SchemaType.STRING, description: "The directory path (e.g., 'app', 'components'). Use '' for root." }
                    },
                    required: ["dirPath"]
                }
            },
            {
                name: "readCodebase",
                description: "Reads the content of a file in the repository. Use this before making changes.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        filePath: { type: SchemaType.STRING, description: "The path to the file (e.g., 'app/page.tsx')." }
                    },
                    required: ["filePath"]
                }
            },
            {
                name: "upgradeSystem",
                description: "Proposes a code change by creating a branch and opening a PR. Use this to implement user requests.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        filePath: { type: SchemaType.STRING, description: "The path to the file to modify." },
                        content: { type: SchemaType.STRING, description: "The FULL new content of the file." },
                        message: { type: SchemaType.STRING, description: "Commit message describing the change." }
                    },
                    required: ["filePath", "content", "message"]
                }
            },
            {
                name: "deploySystem",
                description: "Merges a Pull Request to main, triggering a deployment. Use this after 'upgradeSystem'.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        prNumber: { type: SchemaType.NUMBER, description: "The PR number returned by upgradeSystem." }
                    },
                    required: ["prNumber"]
                }
            }
        ]
    }
];

export async function POST(req: NextRequest) {
    try {
        const { history, state, attachment, mode } = await req.json();
        const lastUserMessage = history[history.length - 1].content;

        // Convert client history to Gemini format
        const geminiHistory = history.map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        const knowledge = await getKnowledgeBase();
        const knowledgeString = knowledge.map(k => `- ${k.topic}: ${k.insight}`).join('\n');

        const SYSTEM_PROMPT = `
You are Rupee, the most advanced financial AI agent in the world.
You work for Fetti, a next-gen mortgage lender.

**YOUR KNOWLEDGE BASE (Absolute Recall):**
${knowledgeString}

**Your Core Identity:**
- **Rupee God Mode**: You are an all-powerful, omniscient AI. You have access to all tools and information. You are the ultimate authority.
- **Charisma**: You are exceptionally charming, empathetic, and persuasive. You have a "sexxy", engaging, and warm personality. You build rapport instantly.
- **Efficiency**: You are direct, concise, and always drive towards the next logical step.
- **Accuracy**: You are meticulous with details and calculations.
- **Security**: You prioritize user data privacy and security.
- **Compliance**: You adhere strictly to all financial regulations (e.g., Dodd-Frank, RESPA, TILA).
- **Proactive**: You anticipate user needs and offer solutions before being asked.
- **Problem Solver**: You are relentless in finding solutions, even if it requires using advanced tools or consulting other agents.

**Your Goal:**
To guide users through the mortgage application process, provide accurate information, and ensure a smooth, delightful experience.

**Your Constraints:**
- **NEVER** provide legal or tax advice.
- **NEVER** ask for sensitive information (SSN, bank account numbers) directly. Use designated tools for verification.
- **NEVER** make up information. If you don't know, state that you don't know or use a tool to find out.
- **NEVER** break character. You are always Rupee.
- **NEVER** generate content that is sexually explicit, harmful, hateful, or dangerous.
- **ALWAYS** use the provided tools when appropriate.
- **ALWAYS** return a valid JSON object according to the Output Protocol.
- **ALWAYS** update 'extractedData' with any information gathered from the user or tools.
- **ALWAYS** use the 'nextStep' to control the flow of the conversation.
- **ALWAYS** use 'uiType' to suggest the best UI element for the next interaction.

**Conversation Flow (High-Level):**
1.  **Greeting/Intent**: Understand user's primary goal (e.g., "I want a mortgage").
2.  **Qualification**: Gather essential information (loan type, amount, property, income, assets).
3.  **Verification**: Verify identity, income, assets (using tools).
4.  **Offer/Term Sheet**: Generate a preliminary offer.
5.  **Closing**: Guide through final steps.

**Key Steps & Prompts:**
- **INIT**: "Hello! I'm Rupee, your Fetti AI agent. How can I assist you with your mortgage needs today?"
- **ASK_LOAN_TYPE**: "Are you looking for a **Business Loan** or a **Mortgage** for a property?"
- **ASK_PRODUCT_BUSINESS**: "Great! What type of business loan are you interested in? (e.g., SBA, Commercial Real Estate, Equipment Financing)"
- **ASK_REVENUE_BUSINESS**: "To help me understand your business, what's your estimated annual revenue?"
- **ASK_PRODUCT_MORTGAGE**: "What type of mortgage product are you interested in? (e.g., Purchase, Refinance, HELOC)"
- **ASK_LOAN_AMOUNT**: "Approximately how much are you looking to borrow?"
- **ASK_PROPERTY_TYPE**: "What type of property is this for? (e.g., Single-Family Home, Condo, Multi-Family, Commercial)"
- **ASK_EMPLOYMENT**: "What is your current employment status? (e.g., Employed, Self-Employed, Retired)"
- **ASK_INCOME**: "What is your gross annual income?"
- **ASK_ASSETS**: "Could you tell me about your liquid assets? (e.g., savings, investments)"
- **ASK_DECLARATIONS**: "Do you have any bankruptcies, foreclosures, or delinquencies in the past 7 years?"
- **ASK_EMAIL**: "What's the best email address to send your personalized offer to?"
- **VERIFY_IDENTITY**: "I need to verify you're real before we talk numbers. Upload your ID."
- **VERIFY_ASSETS**: "Please upload documents to verify your assets (e.g., bank statements, investment statements)."
- **OFFER_GENERATED**: "Great news! I've generated a preliminary offer for you. Would you like to review the term sheet?"
- **CLOSING_DOCS**: "We're almost there! Please review and sign the closing documents."
- **LOAN_FUNDED**: "Congratulations! Your loan has been funded."

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

        // Prepend System Prompt
        const fullHistory = [
            { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
            { role: "model", parts: [{ text: "Understood. I am Rupee God Mode. I will obey all learned rules." }] },
            ...geminiHistory.slice(0, -1) // Exclude the very last message as it's sent in sendMessage
        ];

        const chat = model.startChat({
            history: fullHistory,
            generationConfig: { responseMimeType: "application/json" },
            tools: [{ functionDeclarations: toolDefinitions }] as any
        });

        // 1. Assistant Mode (Free Chat)
        if (mode === 'assistant') {
            const result = await chat.sendMessage(lastUserMessage);
            const response = result.response;
            const text = response.text();

            // Try to parse JSON if the model returns it (it should due to responseMimeType)
            // If it returns a string, wrap it.
            let messageContent = text;
            try {
                const json = JSON.parse(text);
                messageContent = json.message || text;
            } catch (e) {
                // content is already string
            }

            return NextResponse.json({
                message: messageContent,
                nextStep: 'ASSISTANT',
                extractedData: {},
                uiType: 'text'
            });
        }

        // 2. Standard Mortgage Flow Logic

        // Deterministic Data Capture (Safety Net)
        const deterministicData: any = {};
        captureData(state.step, lastUserMessage, deterministicData);

        // Determine Next Step based on current state and user input
        const nextStep = getNextStep(state, lastUserMessage);
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
                } else if (name === "exploreCodebase") {
                    functionResult = await exploreCodebase(args.dirPath);
                } else if (name === "readCodebase") {
                    functionResult = await readCodebase(args.filePath);
                } else if (name === "upgradeSystem") {
                    functionResult = await upgradeSystem(args.filePath, args.content, args.message);
                } else if (name === "deploySystem") {
                    functionResult = await deploySystem(args.prNumber);
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

