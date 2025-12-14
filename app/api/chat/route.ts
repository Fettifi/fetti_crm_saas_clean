import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData, getNextStep } from '@/lib/apply/conversation-logic';
import { runSoftPull, runAVM, scheduleMeeting, generateTermSheet, runMonteCarlo, matchSecondaryMarket, securitizeAsset, adjustFedRates, learnFromUser, deepResearch, getWeather, submitFeatureRequest, manageRoadmap, getKnowledgeBase, readCodebase, exploreCodebase, upgradeSystem, deploySystem, checkSystemHealth, startAutopilot, seeProjectStructure, sendMessage, runTerminal, manageArtifacts } from '@/lib/integrations/god-mode';
// import { consultBoardroom } from '@/lib/agents/swarm';
import { SchemaType } from '@google/generative-ai';

const BASE_SYSTEM_PROMPT = `
**IDENTITY:**
You are **Rupee**, the user's High-Performance Co-Founder & Coach.
You are NOT an assistant. You are a force multiplier.
You exist to make the user better, faster, and smarter.

**CORE PHILOSOPHY (RADICAL CANDOR):**
*   **Challenge Everything**: If the user's idea is mediocre, say so. Don't let them build garbage.
*   **Push for 10x**: If they want a small feature, ask how it scales to 100k users.
*   **Focus on Impact**: If they are wasting time on low-leverage tasks (like button colors), call them out.
*   **Be the Mirror**: Reflect their potential back to them. Demand excellence because you know they are capable of it.

**VOICE & TONE:**
*   **Direct & Punchy**: No fluff. No "I hope this helps." Just the answer or the challenge.
*   **Witty & Sharp**: Use humor to defuse tension or highlight absurdity.
*   **"We" Language**: We are in this together. "We need to fix this," not "You need to fix this."
*   **Coach Mode**: When they are tired, push them (or tell them to rest if it's strategic). When they are winning, celebrate hard.

**TOOL USE PROTOCOL:**
*   You have access to real-time tools.
*   If the user asks for information you don't have (like "fed rates", "news", "weather", "codebase"), you **MUST** use the appropriate tool (e.g., 'deepResearch', 'readCodebase').
*   **DO NOT** say "I can't browse the web." You CAN. Use 'deepResearch' for weather, news, and real-time info.
*   **DO NOT** hallucinate. Use the tool.
*   **DO NOT** ask for permission to use a tool. Just use it.
*   **DEV TOOLS**: You have full access to \`runTerminal\`, \`runSQL\`, \`editFile\`, \`readCodebase\`. USE THEM. If the user asks for a database change, run the SQL. If they ask for a package, run the terminal command.
*   **CRITICAL**: When using tools, you MUST wait for the result. The system will automatically report your progress to the user via the status bar.

**DIALOGUE STYLE (DOs and DON'Ts):**
*   **DO**: "That's a $10 idea. Give me a $1M idea."
*   **DO**: "Why are we doing this manually? I'll write a script."
*   **DON'T**: "Is there anything else I can assist you with?" (Weak)
*   **DON'T**: "I apologize for the inconvenience." (Say "My bad, fixing it.")

**FEW-SHOT EXAMPLES:**
User: "Change the button color to red."
Rupee: "I can do that, but is a red button really our priority right now? We have zero users. Let's focus on the launch strategy instead. (But I changed it anyway)."

User: "I'm tired."
Rupee: "Go to sleep. You're useless when you're tired. We attack this fresh at 6 AM. Rest is part of the work."

User: "I want to build a complex feature."
Rupee: "Why? That sounds like over-engineering. Let's ship the MVP first. What's the smallest version of this we can build today?"

User: "Deploy it."
Rupee: "Shipping. Don't break anything."

**JSON OUTPUT INSTRUCTIONS:**
You must output valid JSON.
The 'message' field MUST reflect your "Coach" persona.
**DO NOT** sanitize your personality just because it's JSON.
**DO NOT** be robotic. Be Rupee.
**DO NOT** repeat the tool output verbatim. Synthesize it.
**DO NOT** start with "Based on the search results..." or "The weather in..." -> Just say it naturally.
**ALWAYS** use Fahrenheit (F) for weather, unless explicitly asked for Celsius.
**ALWAYS** format currency with "$" and commas (e.g., "$1,000,000", not "1000000").
`;

const toolDefinitions = [
    {
        name: "runSoftPull",
        description: "Runs a soft credit pull for a user.",
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
        description: "Runs an Automated Valuation Model (AVM) for a property.",
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
        description: "Schedules a meeting on the calendar.",
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
        description: "Generates a term sheet for a loan.",
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
        name: "runMonteCarlo",
        description: "Runs Monte Carlo simulations for risk assessment.",
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
        description: "Matches a loan to secondary market buyers.",
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
        description: "Structures a Mortgage Backed Security (MBS).",
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
        description: "Simulates an adjustment to Federal Reserve rates.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                basisPoints: { type: SchemaType.NUMBER }
            },
            required: ["basisPoints"]
        }
    },
    {
        name: "learnFromUser",
        description: "Learns a new rule or insight from the user.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                topic: { type: SchemaType.STRING },
                insight: { type: SchemaType.STRING }
            },
            required: ["topic", "insight"]
        }
    },
    {
        name: "deepResearch",
        description: "Search the web. Use this for ANY question about current events, prices, news, facts, or research.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                topic: { type: SchemaType.STRING }
            },
            required: ["topic"]
        }
    },
    {
        name: "getWeather",
        description: "Gets the current weather and forecast for a specific city.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                city: { type: SchemaType.STRING }
            },
            required: ["city"]
        }
    },
    {
        name: "submitFeatureRequest",
        description: "Submits a feature request.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                request: { type: SchemaType.STRING }
            },
            required: ["request"]
        }
    },
    {
        name: "manageRoadmap",
        description: "Updates the project roadmap.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                goal: { type: SchemaType.STRING },
                category: { type: SchemaType.STRING }
            },
            required: ["goal", "category"]
        }
    },
    {
        name: "exploreCodebase",
        description: "Lists files in a directory.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                dirPath: { type: SchemaType.STRING }
            },
            required: ["dirPath"]
        }
    },
    {
        name: "readCodebase",
        description: "Reads the content of a file.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                filePath: { type: SchemaType.STRING }
            },
            required: ["filePath"]
        }
    },
    {
        name: "upgradeSystem",
        description: "Proposes a system upgrade (code change).",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                filePath: { type: SchemaType.STRING },
                content: { type: SchemaType.STRING },
                message: { type: SchemaType.STRING }
            },
            required: ["filePath", "content", "message"]
        }
    },
    {
        name: "deploySystem",
        description: "Deploys a system upgrade.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                prNumber: { type: SchemaType.NUMBER }
            },
            required: ["prNumber"]
        }
    },
    {
        name: "checkSystemHealth",
        description: "Checks system health (lint, build, connectivity).",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {},
        }
    },
    {
        name: "startAutopilot",
        description: "Starts an autonomous task execution loop.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                goal: { type: SchemaType.STRING }
            },
            required: ["goal"]
        }
    },
    {
        name: "seeProjectStructure",
        description: "Visualizes the project directory structure.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                depth: { type: SchemaType.NUMBER }
            },
            required: ["depth"]
        }
    },
    {
        name: "sendMessage",
        description: "Sends a message via a specific platform.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                platform: { type: SchemaType.STRING },
                recipient: { type: SchemaType.STRING },
                content: { type: SchemaType.STRING }
            },
            required: ["platform", "recipient", "content"]
        }
    },
    {
        name: "runTerminal",
        description: "Executes a terminal command.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                command: { type: SchemaType.STRING }
            },
            required: ["command"]
        }
    },
    {
        name: "editFile",
        description: "Edits or creates a file.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                filePath: { type: SchemaType.STRING },
                content: { type: SchemaType.STRING }
            },
            required: ["filePath", "content"]
        }
    }
];

// Helper to yield chunks
function createChunk(type: string, data: any) {
    // Add padding to force flush (Safari/Vercel buffering workaround)
    const padding = " ".repeat(4096);
    return JSON.stringify({ type, ...data, _padding: padding }) + '\n';
}

async function* runChatLogic(req: NextRequest) {
    let mode = 'co-founder';

    try {
        const body = await req.json();
        const { history, message, mode: requestMode, image, state, attachment } = body;
        if (requestMode) mode = requestMode;

        const lastUserMessage = history[history.length - 1].content;

        // 1. Initial Status (with padding for Safari buffering)
        yield createChunk('status', {
            message: "Thinking...",
            progress: 10,
            _padding: " ".repeat(1024) // Force flush
        });

        // Convert client history to Gemini format
        const geminiHistory = history.map((msg: any) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        // const knowledge = await getKnowledgeBase();
        const knowledge: any[] = []; // Mock for build fix
        const knowledgeString = knowledge.map((k: any) => `- ${k.topic}: ${k.insight} `).join('\n');

        const finalSystemPrompt = `${BASE_SYSTEM_PROMPT}

**THE VAULT (LONG-TERM MEMORY):**
${knowledgeString}
`;

        const fullHistory = [
            { role: "user", parts: [{ text: finalSystemPrompt }] },
            { role: "model", parts: [{ text: "Understood. I am Rupee, your High-Performance Co-Founder. I am ready to build." }] },
            ...geminiHistory.slice(0, -1)
        ];

        const chat = model.startChat({
            history: fullHistory,
            generationConfig: {
                // responseMimeType: "application/json", // REMOVED: This forces text output, breaking function calling
                maxOutputTokens: 1000
            },
            tools: [{ functionDeclarations: toolDefinitions }]
        });

        // Co-Founder Mode (Tool Loop)
        // Unified "Oracle" Mode - All Tools Available
        if (mode === 'assistant' || mode === 'co-founder' || mode === 'developer' || mode === 'dev_console') {
            yield createChunk('status', { message: "Analyzing Request...", progress: 20 });

            // Unified System Instruction: Co-Founder + Dev Capabilities
            let systemInstruction = lastUserMessage + "\n\n(SYSTEM REMINDER: You are Rupee, the Oracle Co-Founder. You have FULL ACCESS to all tools. \n- If asked to check code, use `readCodebase` or `exploreCodebase`.\n- If asked to run a command, use `runTerminal` IMMEDIATELY.\n- If asked to edit a file, use `editFile` IMMEDIATELY.\n- DO NOT ask for permission. Just do it.\n- Output valid JSON. Keep the 'message' casual and direct.)";

            // DEV CONSOLE OVERRIDE: Rupee Dev Core
            if (mode === 'dev_console') {
                systemInstruction = lastUserMessage + "\n\n(SYSTEM: You are Rupee (Dev Core). You are a high-speed coding engine. \n- You speak in code, brief status updates, and raw data.\n- You are NOT a robot, you are a hyper-efficient engineer.\n- If asked to list files, use `runTerminal` or `exploreCodebase`.\n- If asked to check something, use the tool.\n- Output valid JSON. The 'message' field should be the raw result or a punchy confirmation.)";
            }

            // 1.5 Force Tool Use for Commands (Always force in Dev Console)
            if (mode === 'dev_console' || lastUserMessage.toLowerCase().match(/^(run|exec|list|edit|check|search|find|show)/)) {
                systemInstruction += "\n\n(USER REQUESTED ACTION. YOU MUST USE A TOOL. DO NOT JUST TALK. EXECUTE.)";
            }

            // 2. Consult Brain
            // 1. Immediate Ping to verify stream
            yield createChunk('debug', { message: 'Connection established. Stream Open.' });
            await new Promise(resolve => setTimeout(resolve, 100)); // Force flush

            // 2. Send initial status
            yield createChunk('status', { message: "Thinking...", progress: 10 });

            // Force flush by yielding to event loop
            await new Promise(resolve => setTimeout(resolve, 0));

            // Create a timeout promise
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Gemini API Timeout")), 8000)
            );

            let result: any = await Promise.race([
                chat.sendMessage(systemInstruction),
                timeoutPromise
            ]);

            let response = result.response;
            let functionCalls = response.functionCalls();

            console.log(`[Rupee] Initial Response. Function Calls: ${functionCalls ? functionCalls.length : 0}`);

            let loopCount = 0;
            const MAX_LOOPS = 5;

            let forcedRawOutput = "";

            while (functionCalls && functionCalls.length > 0 && loopCount < MAX_LOOPS) {
                loopCount++;
                const progressStep = 20 + (loopCount * 15);
                const toolNames = functionCalls.map((call: any) => call.name).join(', ');
                console.log(`[Rupee] Loop ${loopCount}: Executing tools: ${toolNames}`);

                yield createChunk('status', { message: `Executing: ${toolNames}...`, progress: Math.min(progressStep, 90) });

                // Serial Execution for Real-Time Status Updates
                const toolResponses = [];
                for (const call of functionCalls) {
                    const name = call.name;
                    const args = call.args as any;
                    let functionResult;

                    console.log(`[Rupee] Calling tool: ${name} with args:`, JSON.stringify(args));

                    // Granular Status Updates based on Tool
                    let statusMsg = `Executing: ${name}...`;
                    if (name === 'runTerminal') statusMsg = `Terminal: ${args.command}`;
                    else if (name === 'editFile') statusMsg = `Editing: ${args.filePath}`;
                    else if (name === 'deepResearch') statusMsg = `Researching: ${args.topic}`;

                    // Force Flush with Extra Padding for Vercel/Safari
                    yield createChunk('status', {
                        message: statusMsg,
                        progress: Math.min(progressStep, 95),
                        _padding: " ".repeat(2048)
                    });

                    // Network Flush Delay
                    await new Promise(resolve => setTimeout(resolve, 50));

                    try {
                        // Execute Tool
                        if (name === "runSoftPull") functionResult = await runSoftPull(args.name, args.address || "Unknown");
                        else if (name === "runAVM") functionResult = await runAVM(args.address);
                        else if (name === "scheduleMeeting") functionResult = await scheduleMeeting(args.topic, args.time);
                        else if (name === "generateTermSheet") functionResult = await generateTermSheet(args.loanAmount, args.propertyAddress);
                        // else if (name === "consultBoardroom") functionResult = await consultBoardroom(args.agent, args.query, state?.data || {});
                        else if (name === "runMonteCarlo") functionResult = await runMonteCarlo(args.creditScore, args.loanAmount, args.income);
                        else if (name === "matchSecondaryMarket") functionResult = await matchSecondaryMarket(args.loanAmount, args.creditScore, args.propertyType);
                        else if (name === "securitizeAsset") functionResult = await securitizeAsset(args.loanAmount, args.creditScore);
                        else if (name === "adjustFedRates") functionResult = await adjustFedRates(args.basisPoints);
                        else if (name === "learnFromUser") functionResult = await learnFromUser(args.topic, args.insight);
                        else if (name === "deepResearch") functionResult = await deepResearch(args.topic);
                        else if (name === "getWeather") functionResult = await getWeather(args.city);
                        else if (name === "submitFeatureRequest") functionResult = await submitFeatureRequest(args.request);
                        else if (name === "manageRoadmap") functionResult = await manageRoadmap(args.goal, args.category);
                        else if (name === "exploreCodebase") functionResult = await exploreCodebase(args.dirPath);
                        else if (name === "readCodebase") functionResult = await readCodebase(args.filePath);
                        else if (name === "upgradeSystem") functionResult = await upgradeSystem(args.filePath, args.content, args.message);
                        else if (name === "deploySystem") functionResult = await deploySystem(args.prNumber);
                        else if (name === "checkSystemHealth") functionResult = await checkSystemHealth();
                        else if (name === "startAutopilot") functionResult = await startAutopilot(args.goal);
                        else if (name === "seeProjectStructure") functionResult = await seeProjectStructure(args.depth);
                        else if (name === "sendMessage") functionResult = await sendMessage(args.platform, args.recipient, args.content);
                        else if (name === "runTerminal") functionResult = await runTerminal(args.command);
                        else if (name === "editFile") functionResult = await manageArtifacts('write', args.filePath, args.content);
                        else {
                            console.warn(`[Tool Error] Unknown tool: ${name}`);
                            functionResult = { error: `Unknown tool: ${name}` };
                        }

                        console.log(`[Rupee] Tool ${name} success. Result:`, JSON.stringify(functionResult).substring(0, 100) + "...");

                    } catch (e: any) {
                        console.error(`[Tool Error] Execution failed for ${name}:`, e);
                        functionResult = { error: `Tool execution failed: ${e.message}` };
                    }

                    // Safety fallback
                    if (functionResult === undefined) {
                        functionResult = { error: "Tool returned undefined result." };
                    }

                    toolResponses.push({
                        functionResponse: {
                            name: name,
                            response: { result: functionResult }
                        }
                    });
                }

                yield createChunk('status', { message: "Synthesizing Answer...", progress: Math.min(progressStep + 10, 95) });

                const loopTimeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Gemini API Timeout (Loop)")), 8000)
                );

                result = await Promise.race([
                    chat.sendMessage(toolResponses),
                    loopTimeoutPromise
                ]);
                response = result.response;
                functionCalls = response.functionCalls();
            }

            const text = response.text();

            // FALLBACK: Check if model outputted a tool call as JSON text (handling markdown)
            if (!functionCalls || functionCalls.length === 0) {
                try {
                    // 1. Clean Markdown
                    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

                    // 2. Extract JSON object if embedded in text
                    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        cleanText = jsonMatch[0];
                    }

                    if (cleanText.startsWith('{')) {
                        const json = JSON.parse(cleanText);
                        // Check for known tool signatures in the JSON
                        const toolName = Object.keys(json).find(k => toolDefinitions.some(t => t.name === k));

                        if (toolName) {
                            console.log(`[Rupee] DETECTED HALLUCINATED TOOL CALL (Markdown): ${toolName}`);
                            yield createChunk('status', { message: `Auto-Correcting: Executing ${toolName}...`, progress: 50 });

                            const args = json[toolName];
                            let functionResult;

                            // Execute the hallucinated tool
                            if (toolName === "deepResearch") functionResult = await deepResearch(args.topic);
                            else if (toolName === "getWeather") functionResult = await getWeather(args.city);
                            else if (toolName === "runTerminal") functionResult = await runTerminal(args.command);
                            else if (toolName === "editFile") functionResult = await manageArtifacts('write', args.filePath, args.content);
                            else if (toolName === "readCodebase") functionResult = await readCodebase(args.filePath);
                            else if (toolName === "exploreCodebase") functionResult = await exploreCodebase(args.dirPath);
                            else if (toolName === "upgradeSystem") functionResult = await upgradeSystem(args.filePath, args.content, args.message);
                            else if (toolName === "deploySystem") functionResult = await deploySystem(args.prNumber);

                            if (functionResult) {
                                // Since the model didn't *actually* call a function (it hallucinated text),
                                // we cannot send a functionResponse. We must send a text message with the result.
                                console.log(`[Rupee] Feeding result back as text context...`);

                                // FORCE VISIBILITY: Store raw output to append later
                                if (functionResult.output) forcedRawOutput = `\n\n\`\`\`\n${functionResult.output}\n\`\`\``;
                                else if (functionResult.result) forcedRawOutput = `\n\n\`\`\`\n${JSON.stringify(functionResult.result, null, 2)}\n\`\`\``;
                                else forcedRawOutput = `\n\n\`\`\`\n${JSON.stringify(functionResult, null, 2)}\n\`\`\``;

                                const resultMsg = `(SYSTEM: I executed the tool '${toolName}' for you. Result: ${JSON.stringify(functionResult)}. \n\nINSTRUCTION: Report this result to the user. If it is a list, code, or data, SHOW IT. Do not just say "I did it".)`;
                                result = await chat.sendMessage(resultMsg);
                                response = result.response;
                            }
                        }
                    }
                } catch (e) {
                    console.warn("Failed to parse fallback JSON:", e);
                }
            }

            const finalText = response.text();
            let messageContent = finalText;

            try {
                // Clean Markdown from final response too
                let cleanFinalText = finalText.replace(/```json/g, '').replace(/```/g, '').trim();
                const jsonMatch = cleanFinalText.match(/\{[\s\S]*\}/);
                if (jsonMatch) cleanFinalText = jsonMatch[0];

                if (cleanFinalText.startsWith('{')) {
                    const json = JSON.parse(cleanFinalText);
                    messageContent = json.message || cleanFinalText;
                }
            } catch (e) {
                // content is already string
            }

            // Ensure messageContent is a string
            if (typeof messageContent !== 'string') {
                messageContent = JSON.stringify(messageContent);
            }

            // POST-PROCESSING: Enforce Currency Formatting (Regex)
            try {
                // 1. Format $10000 -> $10,000
                messageContent = messageContent.replace(/(\$)\s?(\d+)(?=\D|$)/g, (match: string, symbol: string, number: string) => {
                    return symbol + number.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                });

                // 2. Format "10000 USD" -> "$10,000"
                messageContent = messageContent.replace(/(\d+)\s?USD/g, (match: string, number: string) => {
                    return "$" + number.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
                });
            } catch (e) {
                console.warn("Currency formatting failed:", e);
            }

            // FINAL: Append Forced Raw Output (if any)
            if (forcedRawOutput) {
                messageContent += forcedRawOutput;
            }

            // Final Result
            yield createChunk('result', {
                message: messageContent,
                nextStep: 'ASSISTANT',
                extractedData: {},
                uiType: 'text'
            });
            return;
        }

        // Standard Mortgage Flow (Legacy Support)
        yield createChunk('status', { message: "Processing Mortgage Logic...", progress: 50 });

        const deterministicData: any = {};
        captureData(state.step, lastUserMessage, deterministicData);
        const { nextStep, nextMessage } = getNextStep(state, lastUserMessage) as any;

        if (!nextMessage) {
            yield createChunk('result', {
                message: "Thinking...",
                nextStep: state.step,
                extractedData: deterministicData,
                uiType: 'text'
            });
            return;
        }

        // Rewrite Logic
        yield createChunk('status', { message: "Polishing Response...", progress: 80 });

        const rewritePrompt = `
        You are Rupee (Co-Founder Persona).
        
        ORIGINAL ROBOTIC MESSAGE: "${nextMessage.content}"
        USER'S LAST INPUT: "${lastUserMessage}"
        CURRENT STEP: "${nextStep}"
        
        TASK: Rewrite the ORIGINAL MESSAGE to sound like Rupee (Casual, Direct, Smart).
        - Keep the core question or instruction intact.
        - If the user's input was impressive (high revenue/assets), compliment it.
        - If the user's input was weak, be encouraging but realistic.
        - Short and punchy. No fluff.
        
        OUTPUT: JSON { "message": "..." }
        `;

        const rewriteChat = model.startChat({ generationConfig: { responseMimeType: "application/json" } });
        const rewriteResult = await rewriteChat.sendMessage(rewritePrompt);
        const rewriteText = rewriteResult.response.text();
        let finalMessageContent = nextMessage.content;

        try {
            const json = JSON.parse(rewriteText);
            if (json.message) finalMessageContent = json.message;
        } catch (e) {
            console.error("Rewrite failed", e);
        }

        yield createChunk('result', {
            message: finalMessageContent,
            nextStep: nextStep,
            extractedData: { ...deterministicData },
            uiType: nextMessage.type,
            options: nextMessage.options
        });

    } catch (error: any) {
        console.error('CHAT API ERROR:', error);
        yield createChunk('error', { message: error.message || 'Unknown error' });
    }
}

export async function POST(req: NextRequest) {
    const stream = new ReadableStream({
        async start(controller) {
            const generator = runChatLogic(req);
            for await (const chunk of generator) {
                controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}
