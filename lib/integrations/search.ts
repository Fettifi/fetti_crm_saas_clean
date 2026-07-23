export interface SearchResult {
    title: string;
    url: string;
    content: string;
}

// Heuristic: does this message need live web data? Used to deterministically
// trigger a search since the OpenAI brain doesn't auto-call the search tool.
export function needsWebSearch(message: string): boolean {
    return /\b(search|look ?up|google it|google|find online|on the web|look online|latest|current(ly)?|today|right now|as of now|recent(ly)?|news|headline|weather|stock|share price|price of|interest rate|mortgage rate|fed rate|who is|who won|what'?s happening|whats happening|trending|this week|this month|this year|202[4-9])\b/i.test(message || "");
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
    // Provider priority: Serper (Google, pay-as-you-go, unlimited) > Tavily > free DuckDuckGo.
    if (process.env.SERPER_API_KEY) {
        try { return await searchSerper(query); }
        catch (e) { console.error("Serper failed, falling back:", e); }
    }

    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
        // No keyed provider — use the free, no-key DuckDuckGo backend so Rupee
        // still has real internet access.
        return await searchDuckDuckGo(query);
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                api_key: apiKey,
                query: query,
                search_depth: "basic",
                include_answer: true,
                max_results: 5
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Search API error: ${response.statusText}`);
        }

        const data = await response.json();



        const results = data.results.map((result: any) => ({
            title: result.title,
            url: result.url,
            content: result.content
        }));

        if (data.answer) {
            results.unshift({
                title: "Direct Answer",
                url: "",
                content: data.answer
            });
        }

        return results;

    } catch (error) {
        console.error("Search failed:", error);
        // Fall back to free search if Tavily errors out.
        return await searchDuckDuckGo(query);
    }
}

// Serper.dev — Google search results, pay-as-you-go (effectively unlimited).
async function searchSerper(query: string): Promise<SearchResult[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
                "X-API-KEY": process.env.SERPER_API_KEY as string,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ q: query, num: 6 }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Serper API error: ${res.status}`);
        const data = await res.json();
        const results: SearchResult[] = [];
        if (data.answerBox) {
            const ab = data.answerBox;
            const content = ab.answer || ab.snippet || ab.snippetHighlighted?.join(" ") || "";
            if (content) results.push({ title: ab.title || "Direct Answer", url: ab.link || "", content });
        }
        if (data.knowledgeGraph?.description) {
            results.push({
                title: data.knowledgeGraph.title || "Knowledge",
                url: data.knowledgeGraph.descriptionLink || "",
                content: data.knowledgeGraph.description,
            });
        }
        for (const o of (data.organic || [])) {
            if (results.length >= 6) break;
            results.push({ title: o.title || "Result", url: o.link || "", content: o.snippet || "" });
        }
        return results.length ? results : [{ title: "No results", url: "", content: `No results for "${query}".` }];
    } finally {
        clearTimeout(timeoutId);
    }
}

// Free, no-API-key web search via DuckDuckGo's lite endpoint.
async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const res = await fetch("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query), {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" },
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const html = await res.text();
        const strip = (s: string) => s
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
            .replace(/&#x2F;/g, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
            .replace(/\s+/g, " ").trim();
        const grab = (re: RegExp, limit: number) => {
            const out: string[] = [];
            let m: RegExpExecArray | null;
            while ((m = re.exec(html)) && out.length < limit) out.push(strip(m[1]));
            return out;
        };
        const titles = grab(/<a[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g, 6);
        const snippets = grab(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g, 6);
        const results: SearchResult[] = [];
        const n = Math.min(5, Math.max(titles.length, snippets.length));
        for (let i = 0; i < n; i++) {
            results.push({ title: titles[i] || "Result", url: "", content: snippets[i] || titles[i] || "" });
        }
        return results.length ? results : [{ title: "No results", url: "", content: `No web results found for "${query}".` }];
    } catch (e) {
        console.error("DuckDuckGo search failed:", e);
        return [{ title: "Search unavailable", url: "", content: "Live web search is temporarily unavailable." }];
    }
}

// ---------------------------------------------------------------- Places ---

export interface PlaceResult {
    name: string;
    address: string;
    phone: string | null;
    website: string | null;
    category: string | null;
    rating: number | null;
}

// Google Maps/Places reverse lookup via Serper. Businesses are indexed by phone
// number on Maps, so querying the number itself is the single highest-precision
// "who owns this number" source there is — a hit gives name + street address.
// Serper-only (no fallback provider does places); returns [] without a key.
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
    if (!process.env.SERPER_API_KEY) return [];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch("https://google.serper.dev/places", {
            method: "POST",
            headers: {
                "X-API-KEY": process.env.SERPER_API_KEY as string,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ q: query, num: 5 }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Serper places error: ${res.status}`);
        const data = await res.json();
        return (data.places || []).slice(0, 5).map((p: any) => ({
            name: String(p.title || ""),
            address: String(p.address || ""),
            phone: p.phoneNumber ? String(p.phoneNumber) : null,
            website: p.website ? String(p.website) : null,
            category: p.category ? String(p.category) : null,
            rating: typeof p.rating === "number" ? p.rating : null,
        })).filter((p: PlaceResult) => p.name);
    } catch (e) {
        clearTimeout(timeoutId);
        console.error("Serper places failed:", e);
        return [];
    }
}
