// Multi-brain model layer with a Gemini-SDK-shaped interface, so the existing
// chat route (model.startChat(...).sendMessage(...) → response.text() /
// response.functionCalls()) keeps working unchanged across providers.
//
// "Best brain for the job, both always available":
//   - Agentic / tool-using turns (Rupee)  → CLAUDE (claude-opus-4-8) when
//     ANTHROPIC_API_KEY is set; else OpenAI gpt-4o; else Gemini; else mock.
//   - Plain text turns (apply funnel)      → OpenAI gpt-4o-mini (cheap/fast);
//     else Claude; else Gemini; else mock.
// Both Claude and OpenAI do REAL tool-calling here, so all of Rupee's tools fire.
// To switch Rupee to her Claude brain: add ANTHROPIC_API_KEY to .env.local.
import { GoogleGenerativeAI } from "@google/generative-ai";

const anthropicKey = process.env.ANTHROPIC_API_KEY;
const openaiKey = process.env.OPENAI_API_KEY;
const geminiKey = process.env.GEMINI_API_KEY;

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";        // cheap text path
const OPENAI_AGENT_MODEL = process.env.OPENAI_AGENT_MODEL || "gpt-4o"; // tool-calling path
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

type Part = { text?: string };
type HistoryMsg = { role: string; parts?: Part[] };
type StartChatOpts = {
  history?: HistoryMsg[];
  generationConfig?: { maxOutputTokens?: number; responseMimeType?: string };
  tools?: unknown;
};
type GeminiResponse = { response: { text: () => string; functionCalls: () => unknown[] } };

// --- shared helpers ---------------------------------------------------------

// JSON-Schema-ify a Gemini parameter schema: lowercase every `type` (Gemini's
// SchemaType enums may be upper- or lower-case; OpenAI/Anthropic want lowercase).
function normalizeSchema(s: any): any {
  if (Array.isArray(s)) return s.map(normalizeSchema);
  if (s && typeof s === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === "type" && typeof v === "string") out[k] = v.toLowerCase();
      else out[k] = normalizeSchema(v);
    }
    return out;
  }
  return s;
}

// Pull the flat function-declaration list out of the Gemini `tools` shape
// ([{ functionDeclarations: [...] }]).
function extractDeclarations(tools: unknown): any[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((t: any) => (t && Array.isArray(t.functionDeclarations) ? t.functionDeclarations : []));
}

function safeParse(s: string): any {
  try { return JSON.parse(s || "{}"); } catch { return {}; }
}

// Stream a Claude response via SSE, calling onDelta(text) as words arrive, and
// return the fully-assembled content block array (text + tool_use) so the rest
// of the agent loop works exactly as it does for the non-streaming path.
async function streamAnthropic(reqBody: any, onDelta: (t: string) => void): Promise<any[]> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ ...reqBody, stream: true }),
  });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({} as any));
    throw new Error(j?.error?.message || `Anthropic HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const blocks: any[] = [];
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: any;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === "content_block_start") {
        blocks[ev.index] = { ...ev.content_block };
        if (blocks[ev.index].type === "tool_use") blocks[ev.index]._json = "";
        if (blocks[ev.index].type === "text" && blocks[ev.index].text === undefined) blocks[ev.index].text = "";
      } else if (ev.type === "content_block_delta") {
        const b = blocks[ev.index];
        if (!b) continue;
        if (ev.delta?.type === "text_delta") { b.text = (b.text || "") + ev.delta.text; onDelta(ev.delta.text); }
        else if (ev.delta?.type === "input_json_delta") { b._json = (b._json || "") + ev.delta.partial_json; }
      } else if (ev.type === "content_block_stop") {
        const b = blocks[ev.index];
        if (b && b.type === "tool_use") { try { b.input = JSON.parse(b._json || "{}"); } catch { b.input = {}; } delete b._json; }
      }
    }
  }
  return blocks.filter(Boolean).map((b: any) => { if (b.type === "tool_use") { const { _json, ...rest } = b; return rest; } return b; });
}

// --- Anthropic (Claude) — Rupee's brain ------------------------------------

function anthropicHistoryToMessages(history: HistoryMsg[] = []) {
  // Map Gemini-shaped history to Anthropic messages (text only here; tool
  // round-trips are handled live inside sendMessage).
  return history
    .map((m) => ({
      role: m.role === "model" ? "assistant" : "user",
      content: (m.parts || []).map((p) => p.text || "").join("\n"),
    }))
    .filter((m) => m.content && m.content.trim().length > 0);
}

function makeAnthropicModel() {
  return {
    startChat(opts: StartChatOpts = {}) {
      const messages: any[] = anthropicHistoryToMessages(opts.history);
      const decls = extractDeclarations(opts.tools);
      const anthropicTools = decls.map((d) => ({
        name: d.name,
        description: d.description || "",
        input_schema: normalizeSchema(d.parameters) || { type: "object", properties: {} },
      }));
      const hasTools = anthropicTools.length > 0;
      const maxTokens = hasTools ? 8192 : Math.max(opts.generationConfig?.maxOutputTokens || 1024, 1024);
      let lastToolUses: { id: string; name: string }[] = [];

      return {
        async sendMessage(input: string | unknown[], opts: { onDelta?: (t: string) => void } = {}): Promise<GeminiResponse> {
          if (typeof input === "string") {
            messages.push({ role: "user", content: input });
          } else {
            // Gemini-shaped tool responses → Anthropic tool_result blocks,
            // matched to the prior turn's tool_use ids by name.
            const used = new Set<string>();
            const blocks = lastToolUses
              .map((tu) => {
                const fr = (input as any[]).find(
                  (x) => x?.functionResponse?.name === tu.name && !used.has(tu.id)
                );
                used.add(tu.id);
                const result = fr?.functionResponse?.response?.result ?? {};
                return {
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: typeof result === "string" ? result : JSON.stringify(result),
                };
              })
              .filter(Boolean);
            messages.push({ role: "user", content: blocks });
            lastToolUses = [];
          }

          const reqBody: any = {
            model: CLAUDE_MODEL,
            max_tokens: maxTokens,
            messages,
            ...(hasTools ? { tools: anthropicTools, tool_choice: { type: "auto" } } : {}),
          };
          let content: any[] = [];
          try {
            if (opts.onDelta) {
              content = await streamAnthropic(reqBody, opts.onDelta);
            } else {
              const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "x-api-key": anthropicKey as string,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify(reqBody),
              });
              const json = await res.json();
              if (!res.ok) throw new Error(json?.error?.message || `Anthropic HTTP ${res.status}`);
              content = Array.isArray(json.content) ? json.content : [];
            }
            messages.push({ role: "assistant", content });
            lastToolUses = content
              .filter((b: any) => b.type === "tool_use")
              .map((b: any) => ({ id: b.id, name: b.name }));
          } catch (err) {
            console.error("[brain/anthropic] error:", err);
            content = [{ type: "text", text: JSON.stringify({ message: "My Claude brain hit a snag reaching the API. Try again in a sec.", nextStep: "ERROR", uiType: "text" }) }];
          }

          return {
            response: {
              text: () => content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n"),
              functionCalls: () =>
                content
                  .filter((b: any) => b.type === "tool_use")
                  .map((b: any) => ({ name: b.name, args: b.input || {} })),
            },
          };
        },
      };
    },
  };
}

// --- OpenAI — fallback brain + voice ---------------------------------------

function geminiHistoryToOpenAI(history: HistoryMsg[] = []) {
  return history.map((m) => ({
    role: m.role === "model" ? "assistant" : m.role === "system" ? "system" : "user",
    content: (m.parts || []).map((p) => p.text || "").join("\n"),
  }));
}

function makeOpenAIModel() {
  return {
    startChat(opts: StartChatOpts = {}) {
      const messages: any[] = geminiHistoryToOpenAI(opts.history);
      const wantJson = opts.generationConfig?.responseMimeType === "application/json";
      const decls = extractDeclarations(opts.tools);
      const openaiTools = decls.map((d) => ({
        type: "function",
        function: {
          name: d.name,
          description: d.description || "",
          parameters: normalizeSchema(d.parameters) || { type: "object", properties: {} },
        },
      }));
      const hasTools = openaiTools.length > 0;
      const useModel = hasTools ? OPENAI_AGENT_MODEL : OPENAI_MODEL;
      const maxTokens = hasTools ? 4096 : opts.generationConfig?.maxOutputTokens || 1000;
      let lastToolCalls: { id: string; name: string }[] = [];

      return {
        async sendMessage(input: string | unknown[]): Promise<GeminiResponse> {
          if (typeof input === "string") {
            messages.push({ role: "user", content: input });
          } else {
            const used = new Set<string>();
            for (const tc of lastToolCalls) {
              const fr = (input as any[]).find(
                (x) => x?.functionResponse?.name === tc.name && !used.has(tc.id)
              );
              used.add(tc.id);
              const result = fr?.functionResponse?.response?.result ?? {};
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: typeof result === "string" ? result : JSON.stringify(result),
              });
            }
            lastToolCalls = [];
          }

          let content = "";
          let toolCalls: any[] = [];
          try {
            const res = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
              body: JSON.stringify({
                model: useModel,
                messages,
                max_tokens: maxTokens,
                ...(hasTools ? { tools: openaiTools, tool_choice: "auto" } : {}),
                ...(wantJson && !hasTools ? { response_format: { type: "json_object" } } : {}),
              }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
            const msg = json.choices?.[0]?.message ?? {};
            content = msg.content ?? "";
            toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
            messages.push(msg);
            lastToolCalls = toolCalls.map((tc: any) => ({ id: tc.id, name: tc.function?.name }));
          } catch (err) {
            console.error("[brain/openai] error:", err);
            content = JSON.stringify({ message: "I had trouble reaching my reasoning engine just now. Please try again.", nextStep: "ERROR", uiType: "text" });
          }

          return {
            response: {
              text: () => content || "",
              functionCalls: () =>
                toolCalls.map((tc: any) => ({ name: tc.function?.name, args: safeParse(tc.function?.arguments) })),
            },
          };
        },
      };
    },
  };
}

// --- dispatcher: pick the best available brain per turn --------------------

const anthropicModel = anthropicKey ? makeAnthropicModel() : null;
const openaiModel = openaiKey ? makeOpenAIModel() : null;
const geminiModel = geminiKey ? new GoogleGenerativeAI(geminiKey).getGenerativeModel({ model: "gemini-2.0-flash" }) : null;

const mockModel = {
  startChat: () => ({
    sendMessage: async () => ({
      response: {
        text: () => JSON.stringify({ message: "I'm offline — no AI key (ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY) is configured.", nextStep: "ERROR", uiType: "text" }),
        functionCalls: () => [] as unknown[],
      },
    }),
  }),
};

if (!anthropicModel && !openaiModel && !geminiModel) {
  console.warn("[brain] No ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY. Using mock brain.");
}

const model: any = {
  startChat(opts: StartChatOpts = {}) {
    const hasTools = extractDeclarations(opts.tools).length > 0;
    if (hasTools) {
      // Agentic / Rupee: Claude first, then gpt-4o, then Gemini.
      if (anthropicModel) return anthropicModel.startChat(opts);
      if (openaiModel) return openaiModel.startChat(opts);
    } else {
      // Plain text (apply funnel): cheap/fast OpenAI first, then Claude.
      if (openaiModel) return openaiModel.startChat(opts);
      if (anthropicModel) return anthropicModel.startChat(opts);
    }
    if (geminiModel) return (geminiModel as any).startChat(opts);
    return mockModel.startChat();
  },
};

export { model };
