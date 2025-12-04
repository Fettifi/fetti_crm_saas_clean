export interface SearchResult {
    title: string;
    url: string;
    content: string;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
    const apiKey = process.env.TAVILY_API_KEY;

    if (!apiKey) {
        console.warn("TAVILY_API_KEY is missing. Returning simulated results.");
        return [
            {
                title: "Simulation: Search Key Missing",
                url: "https://tavily.com",
                content: `[SYSTEM MESSAGE]: Real-time search is disabled because TAVILY_API_KEY is missing in .env. Please add it to enable live web access. For now, I am simulating a search for: "${query}".`
            }
        ];
    }

    try {
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
            })
        });

        if (!response.ok) {
            throw new Error(`Search API error: ${response.statusText}`);
        }

        const data = await response.json();

        return data.results.map((result: any) => ({
            title: result.title,
            url: result.url,
            content: result.content
        }));

    } catch (error) {
        console.error("Search failed:", error);
        return [
            {
                title: "Search Failed",
                url: "",
                content: "An error occurred while searching the web."
            }
        ];
    }
}
