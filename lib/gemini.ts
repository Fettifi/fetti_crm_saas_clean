// Provider-agnostic chat "model" with a Gemini-SDK-shaped interface, so the
// existing chat route (which calls model.startChat(...).sendMessage(...) and
// response.text() / response.functionCalls()) keeps working unchanged.
//
// Preference order:
//   1. OpenAI (via REST fetch, no SDK dependency) when OPENAI_API_KEY is set
//   2. Google Gemini SDK when GEMINI_API_KEY is set
//   3. Mock (clearly states the brain is offline)
//
// The apply/mortgage funnel only needs text generation, which this fully
// supports. Native tool-calling (the "co-founder" dev agent) is Gemini-only;
// on the OpenAI path functionCalls() returns [] so the agent degrades to
// talking instead of crashing.
import { GoogleGenerativeAI } from "@google/generative-ai";

const openaiKey = process.env.OPENAI_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

type Part = { text?: string };
type HistoryMsg = { role: string; parts?: Part[] };
type StartChatOpts = {
  history?: HistoryMsg[];
  generationConfig?: { maxOutputTokens?: number; responseMimeType?: string };
  tools?: unknown;
};

function geminiHistoryToOpenAI(history: HistoryMsg[] = []) {
  return history.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role === "system" ? "system" : "user",
    content: (m.parts || []).map((p) => p.text || "").join("\n"),
  }));
}

function makeOpenAIModel() {
  return {
    startChat(opts: StartChatOpts = {}) {
      const messages = geminiHistoryToOpenAI(opts.history);
      const wantJson = opts.generationConfig?.responseMimeType === "application/json";
      const maxTokens = opts.generationConfig?.maxOutputTokens || 1000;

      return {
        async sendMessage(input: string | unknown[]) {
          if (typeof input === "string") {
            messages.push({ role: "user", content: input });
          } else {
            // tool-response array (Gemini shape) — fold into a user note
            messages.push({ role: "user", content: "Tool results: " + JSON.stringify(input) });
          }
          let content = "";
          try {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openaiKey}`,
              },
              body: JSON.stringify({
                model: OPENAI_MODEL,
                messages,
                max_tokens: maxTokens,
                ...(wantJson ? { response_format: { type: "json_object" } } : {}),
              }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
            content = json.choices?.[0]?.message?.content ?? "";
            messages.push({ role: "assistant", content });
          } catch (err) {
            console.error("[aiModel/openai] error:", err);
            content = JSON.stringify({
              message: "I had trouble reaching my reasoning engine just now. Please try again.",
              nextStep: "ERROR",
              uiType: "text",
            });
          }
          return {
            response: {
              text: () => content,
              functionCalls: () => [] as unknown[],
            },
          };
        },
      };
    },
  };
}

let model: any;

if (openaiKey) {
  model = makeOpenAIModel();
} else if (geminiKey) {
  const genAI = new GoogleGenerativeAI(geminiKey);
  model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
} else {
  console.warn("No OPENAI_API_KEY or GEMINI_API_KEY. Using mock model.");
  model = {
    startChat: () => ({
      sendMessage: async () => ({
        response: {
          text: () =>
            JSON.stringify({
              message:
                "I am currently offline because no AI key (OPENAI_API_KEY or GEMINI_API_KEY) is configured.",
              nextStep: "ERROR",
              uiType: "text",
            }),
          functionCalls: () => [],
        },
      }),
    }),
  };
}

export { model };
