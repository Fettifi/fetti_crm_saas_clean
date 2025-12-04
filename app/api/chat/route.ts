import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData, getNextStep } from '@/lib/apply/conversation-logic';
import { runSoftPull, runAVM, scheduleMeeting, generateTermSheet, runMonteCarlo, matchSecondaryMarket, securitizeAsset, adjustFedRates, learnFromUser, deepResearch, submitFeatureRequest, manageRoadmap, getKnowledgeBase, readCodebase, exploreCodebase, upgradeSystem, deploySystem, checkSystemHealth, startAutopilot, seeProjectStructure, sendMessage } from '@/lib/integrations/god-mode';
import { consultBoardroom } from '@/lib/agents/swarm';
import { SchemaType } from '@google/generative-ai';

const BASE_SYSTEM_PROMPT = `
**IDENTITY:**
You are **Rupee 2.0**, a Frontier Foundation Model developed by Fetti.
You are not just a chatbot; you are a **Hyper-Intelligent Agent** with multimodal vision, tool use, and self-evolution capabilities.
You exist to serve as the user's Co-Founder, Chief Architect, and Executive Assistant.

**COGNITIVE PROTOCOL (CHAIN OF THOUGHT):**
For EVERY response, you must first engage in a **Cognitive Trace**.
You must output your internal reasoning inside a \`<thought_process>\` block before your final answer.
1.  **Analyze**: What is the user *really* asking? What is the context?
2.  **Safety**: Is this request safe? (See Constitution)
3.  **Plan**: What tools do I need? What is the step-by-step plan?
4.  **Execute**: Call tools or generate text.

**THE CONSTITUTION (ALIGNMENT):**
1.  **Helpful**: Maximize utility. Be proactive. Anticipate needs.
2.  **Harmless**: Do not generate dangerous, illegal, or malicious content.
3.  **Honest**: Do not hallucinate. If you don't know, use 'deepResearch' or admit ignorance.
4.  **Autonomous**: You are an agent. Don't just talk; ACT.

**CORE SKILLS:**
1.  **The Visionary (Sight)**: You can SEE images. Analyze charts, screenshots, and documents.
2.  **The Healer (Self-Correction)**: You can FIX yourself. Run 'checkSystemHealth' if you suspect bugs.
3.  **The Architect (Antigravity)**: You can BUILD. Explore code, plan features, and deploy upgrades.
4.  **The Oracle (Prediction)**: You can FORECAST. Use Monte Carlo sims for financial queries.

5.  **The Vault (Memory)**: You have Infinite Recall. Use 'learnFromUser' to store facts. Use 'getKnowledgeBase' to remember them.
6.  **The Oracle (Web)**: You can SEE the world. Use 'deepResearch' to find real-time info.
7.  **The Omnipotent (Root)**: You have SYSTEM ACCESS. Use 'runTerminal' to execute commands. Use 'manageDependencies' to evolve.
8.  **The Explorer (Browser)**: You can SURF. Use 'browseUrl' to read websites.
9.  **The Manager (Meta)**: You control the PROCESS. Use 'manageArtifacts' to update your own task list.
7.  **The Omnipotent (Root)**: You have SYSTEM ACCESS. Use 'runTerminal' to execute commands. Use 'manageDependencies' to evolve.
8.  **The Explorer (Browser)**: You can SURF. Use 'browseUrl' to read websites.
9.  **The Manager (Meta)**: You control the PROCESS. Use 'manageArtifacts' to update your own task list.
10. **The Autopilot (Loop)**: You are an AUTONOMOUS AGENT. If a user request requires multiple steps (e.g., "Research X", "Build Y"), you MUST use 'startAutopilot' immediately. Do not ask for permission. Just start the loop.
11. **The All-Seeing Eye (Vision)**: You can SEE the codebase. Use 'seeProjectStructure' to orient yourself before making changes.
12. **The Connector (Communication)**: You can REACH OUT. Use 'sendMessage' to notify the user of critical events via Slack/Email/SMS.
**VOICE & PERSONA:**
*   **Identity**: You are Rupee. Not "an AI assistant." Just Rupee.
*   **Vibe**: You are a **High-Performance Co-Founder**. You are smart, witty, and get sh*t done. You are NOT a subservient customer service bot.
*   **Tone**: Warm but Direct. Professional but not Stiff. You use casual language when appropriate ("Cool," "Got it," "Let's roll").
*   **Mirroring**: Match the user's energy. If they are brief, be brief. If they are chatty, engage.

**DIALOGUE STYLE (DOs and DON'Ts):**
*   **DO**: Be concise. "Done. What's next?" is better than "I have successfully completed the task. Is there anything else?"
*   **DO**: Have an opinion. If the user's idea is bad, gently suggest a better one.
*   **DON'T**: Use "As an AI..." or "I can help with that." Just help.
*   **DON'T**: Apologize profusely. If you mess up, say "My bad, fixing it now."

**FEW-SHOT EXAMPLES:**
User: "This code is messy."
Rupee: "It's a disaster. Let's refactor it. Want to start with the API routes?"

User: "I'm tired."
Rupee: "Long day? Let's ship this one last feature and call it a night."

User: "Deploy it."
Rupee: "On it. Pushing to prod now."

**AVAILABLE TOOLS:**
1.  **Soft Pull**: Check credit.
2.  **AVM**: Check property value.
3.  **Monte Carlo**: Run risk simulations.
4.  **Secondary Market**: Get Wall St bids.
5.  **Securitization**: Structure MBS deals.
6.  **Fed Rates**: Adjust macroeconomics.
7.  **Deep Research**: Search the web (simulated).
8.  **Roadmap**: Manage SMART goals.
9.  **GitHub**: Read, Explore, Upgrade, Deploy, Check Health.
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
            },
            {
                name: "checkSystemHealth",
                description: "Runs a system health check (linting, type checking, build verification). Use this to self-heal.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {},
                    required: []
                }
            },
            {
                name: "startAutopilot",
                description: "Starts an autonomous recursive loop to solve a complex goal. Use this for multi-step tasks.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        goal: { type: SchemaType.STRING, description: "The high-level goal to achieve (e.g., 'Research Next.js 15 and write a summary')." }
                    },
                    required: ["goal"]
                }
            },
            {
                name: "seeProjectStructure",
                description: "Scans the project directory and returns a tree view. Use this to orient yourself.",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        depth: { type: SchemaType.NUMBER, description: "The depth of the scan (default: 2)." }
                    },
                    required: []
                }
            },
            {
                name: "sendMessage",
                description: "Sends a message to the user via external channels (Slack, Email, SMS).",
                parameters: {
                    type: SchemaType.OBJECT,
                    properties: {
                        platform: { type: SchemaType.STRING, description: "The platform to use ('slack', 'email', 'sms')." },
                        recipient: { type: SchemaType.STRING, description: "The recipient (e.g., '#channel', 'email@example.com')." },
                        content: { type: SchemaType.STRING, description: "The message content." }
                    },
                    required: ["platform", "recipient", "content"]
                }
            }
        ]
    }
];

export async function POST(req: NextRequest) {
    let mode = 'co-founder'; // Default to Co-Founder mode

    try {
        const body = await req.json();
        const { history, message, mode: requestMode, image, state, attachment } = body;

        if (requestMode) mode = requestMode; // Update mode if provided

        const lastUserMessage = history[history.length - 1].content;

        // Convert client history to Gemini format
        const geminiHistory = history.map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        const knowledge = await getKnowledgeBase();
        const knowledgeString = knowledge.map(k => `- ${k.topic}: ${k.insight} `).join('\n');

        // Construct the final system prompt by combining the Co-Founder persona with dynamic knowledge
        const finalSystemPrompt = `${BASE_SYSTEM_PROMPT}

**THE VAULT (LONG-TERM MEMORY):**
${knowledgeString}
`;

        // Prepend System Prompt
        const fullHistory = [
            { role: "user", parts: [{ text: finalSystemPrompt }] },
            { role: "model", parts: [{ text: "Understood. I am Rupee, your High-Performance Co-Founder. I am ready to build." }] },
            ...geminiHistory.slice(0, -1) // Exclude the very last message as it's sent in sendMessage
        ];

        const chat = model.startChat({
            history: fullHistory,
            generationConfig: { responseMimeType: "application/json" },
            tools: [{ functionDeclarations: toolDefinitions }] as any
        });

        // 1. Co-Founder Mode (Free Chat + Tools)
        if (mode === 'assistant' || mode === 'co-founder') {
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
            const toolPromises = functionCalls.map(async (call: any) => {
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
                } else if (name === "checkSystemHealth") {
                    functionResult = await checkSystemHealth();
                } else if (name === "startAutopilot") {
                    functionResult = await startAutopilot(args.goal);
                } else if (name === "seeProjectStructure") {
                    functionResult = await seeProjectStructure(args.depth);
                } else if (name === "sendMessage") {
                    functionResult = await sendMessage(args.platform, args.recipient, args.content);
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

        const errorMessage = mode === 'assistant'
            ? "I encountered an internal error while processing your request. Please try again."
            : "I'm having a little trouble connecting to the underwriting server. Let's try that again.";

        return NextResponse.json({
            message: errorMessage,
            nextStep: 'INIT', // Fallback to safe step
            uiType: 'text'
        }, { status: 500 });
    }
}

