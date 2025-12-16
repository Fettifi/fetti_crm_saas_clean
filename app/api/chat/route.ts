import { NextRequest, NextResponse } from 'next/server';
import { model } from '@/lib/gemini';
import { ConversationState, captureData, getNextStep, Message } from '@/lib/apply/conversation-logic';
import { getKnowledgeBase } from '@/lib/integrations/god-mode';
import { BASE_SYSTEM_PROMPT } from '@/lib/ai/prompts';
import { toolDefinitions, executeTool } from '@/lib/ai/tools';
import { SchemaType } from '@google/generative-ai';



// Helper to yield chunks
function createChunk(type: string, data: Record<string, unknown>) {
    // Add padding to force flush (Safari/Vercel buffering workaround)
    const padding = " ".repeat(4096);
    return JSON.stringify({ type, ...data, _padding: padding }) + '\n';
}

async function* runChatLogic(req: NextRequest) {
    let mode = 'co-founder';

    yield createChunk('debug', { message: 'Route handler started. Reading body...' });

    try {
        const rawBody = await req.text();
        yield createChunk('debug', { message: `Body read (${rawBody.length} bytes)` });

        if (!rawBody) throw new Error("Empty request body");

        const body = JSON.parse(rawBody);
        const { history, message, mode: requestMode, image, state, attachment } = body;
        if (requestMode) mode = requestMode;

        const lastUserMessage = history.length > 0 ? history[history.length - 1].content : message;

        if (!lastUserMessage) {
            throw new Error("No message content found in history or request body.");
        }

        // 1. Initial Status (with padding for Safari buffering)
        yield createChunk('status', {
            message: "Thinking...",
            progress: 10,
            _padding: " ".repeat(1024) // Force flush
        });

        // Convert client history to Gemini format
        const geminiHistory = history.map((msg: Message) => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        }));

        const knowledge = await getKnowledgeBase();
        // const knowledge: any[] = []; // Mock for build fix
        const knowledgeString = knowledge.map((k: { topic: string; insight: string }) => `- ${k.topic}: ${k.insight} `).join('\n');

        const finalSystemPrompt = `${BASE_SYSTEM_PROMPT}

**THE VAULT (LONG-TERM MEMORY):**
${knowledgeString}

**MEMORY PROTOCOL:**
*   **Remember Everything**: If the user states a preference, rule, or fact, use \`learnFromUser\` to save it.
*   **Consolidate**: Do not create duplicate topics. If you learn something new about an existing topic (e.g., "Pricing"), update the EXISTING topic with a consolidated insight.
*   **Be Proactive**: Don't wait for "save this". If it's important, save it.
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
            // REMOVED: Repetitive system injection. We trust the BASE_SYSTEM_PROMPT in history.
            let systemInstruction = lastUserMessage;

            // DEV CONSOLE OVERRIDE: Rupee Dev Core (Still needs explicit instruction as it's a mode switch)
            if (mode === 'dev_console') {
                systemInstruction = lastUserMessage + "\n\n(SYSTEM: You are Rupee (Dev Core). You are a high-speed coding engine. \n- You speak in code, brief status updates, and raw data.\n- You are NOT a robot, you are a hyper-efficient engineer.\n- If asked to list files, use `runTerminal` or `exploreCodebase`.\n- If asked to check something, use the tool.\n- Output valid JSON. The 'message' field should be the raw result or a punchy confirmation.)";
            }

            // 1.5 Force Tool Use for Commands (Always force in Dev Console)
            if (mode === 'dev_console' || lastUserMessage.toLowerCase().match(/^(run|exec|list|edit|check|search|find|show|add|create|make|update|delete|remove|install)/)) {
                systemInstruction += "\n\n(USER REQUESTED ACTION. YOU MUST USE A TOOL. DO NOT JUST TALK. EXECUTE. \nCRITICAL: If you use a tool, DO NOT output a JSON message. The system will handle the output. JUST CALL THE FUNCTION.)";
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
                setTimeout(() => reject(new Error("Gemini API Timeout")), 60000)
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
                        functionResult = await executeTool(name, args);
                        console.log(`[Rupee] Tool ${name} success. Result:`, JSON.stringify(functionResult).substring(0, 100) + "...");

                        toolResponses.push({
                            functionResponse: {
                                name: name,
                                response: { result: functionResult }
                            }
                        });

                    } catch (e: any) {
                        console.error(`[Tool Error] Execution failed for ${name}:`, e);
                        toolResponses.push({
                            functionResponse: {
                                name: name,
                                response: { result: { error: `Tool execution failed: ${e.message}` } }
                            }
                        });
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
                    setTimeout(() => reject(new Error("Gemini API Timeout (Loop)")), 60000)
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
                            functionResult = await executeTool(toolName, args);

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
                    if (json.message) {
                        messageContent = json.message;
                    } else if (json.status) {
                        // Fallback: Use 'status' as message if 'message' is missing
                        console.log("[Rupee] JSON missing 'message', using 'status' fallback.");
                        messageContent = json.status;
                    } else if (json.response) {
                        // Fallback: Use 'response' as message
                        messageContent = json.response;
                    } else {
                        // If no known field, return the whole JSON as a code block
                        messageContent = "```json\n" + JSON.stringify(json, null, 2) + "\n```";
                    }
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
