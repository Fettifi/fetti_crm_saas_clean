import { SchemaType } from '@google/generative-ai';
import {
    runSoftPull, runAVM, scheduleMeeting, generateTermSheet, runMonteCarlo,
    matchSecondaryMarket, securitizeAsset, adjustFedRates, learnFromUser,
    deepResearch, getWeather, submitFeatureRequest, manageRoadmap,
    getKnowledgeBase, readCodebase, exploreCodebase, upgradeSystem,
    deploySystem, checkSystemHealth, startAutopilot, seeProjectStructure,
    sendMessage, runTerminal, manageArtifacts
} from '@/lib/integrations/god-mode';

export const toolDefinitions = [
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

export interface ToolResult {
    error?: string;
    [key: string]: any; // Allow flexible return values for now, but error is standard
}

export async function executeTool(name: string, args: Record<string, any>): Promise<ToolResult | any> {
    try {
        if (name === "runSoftPull") return await runSoftPull(args.name, args.address || "Unknown");
        if (name === "runAVM") return await runAVM(args.address);
        if (name === "scheduleMeeting") return await scheduleMeeting(args.topic, args.time);
        if (name === "generateTermSheet") return await generateTermSheet(args.loanAmount, args.propertyAddress);
        if (name === "runMonteCarlo") return await runMonteCarlo(args.creditScore, args.loanAmount, args.income);
        if (name === "matchSecondaryMarket") return await matchSecondaryMarket(args.loanAmount, args.creditScore, args.propertyType);
        if (name === "securitizeAsset") return await securitizeAsset(args.loanAmount, args.creditScore);
        if (name === "adjustFedRates") return await adjustFedRates(args.basisPoints);
        if (name === "learnFromUser") return await learnFromUser(args.topic, args.insight);
        if (name === "deepResearch") return await deepResearch(args.topic);
        if (name === "getWeather") return await getWeather(args.city);
        if (name === "submitFeatureRequest") return await submitFeatureRequest(args.request);
        if (name === "manageRoadmap") return await manageRoadmap(args.goal, args.category);
        if (name === "exploreCodebase") return await exploreCodebase(args.dirPath);
        if (name === "readCodebase") return await readCodebase(args.filePath);
        if (name === "upgradeSystem") return await upgradeSystem(args.filePath, args.content, args.message);
        if (name === "deploySystem") return await deploySystem(args.prNumber);
        if (name === "checkSystemHealth") return await checkSystemHealth();
        if (name === "startAutopilot") return await startAutopilot(args.goal);
        if (name === "seeProjectStructure") return await seeProjectStructure(args.depth);
        if (name === "sendMessage") return await sendMessage(args.platform, args.recipient, args.content);
        if (name === "runTerminal") return await runTerminal(args.command);
        if (name === "editFile") return await manageArtifacts('write', args.filePath, args.content);

        console.warn(`[Tool Error] Unknown tool: ${name}`);
        return { error: `Unknown tool: ${name}` };
    } catch (e: any) {
        console.error(`[Tool Error] Execution failed for ${name}:`, e);
        return { error: `Tool execution failed: ${e.message}` };
    }
}
