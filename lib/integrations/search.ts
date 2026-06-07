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
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
        // No Tavily key — use the free, no-key DuckDuckGo backend so Rupee still
        // has real internet access. (Add TAVILY_API_KEY for higher-quality results.)
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
