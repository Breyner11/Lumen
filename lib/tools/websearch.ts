import { engineSearch, type EngineWebHit } from "@/lib/rag/engine-client";

export type WebHit = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

/** Prefer the Python DuckDuckGo engine; fall back to DDG HTML if the engine is down. */
export async function searchWeb(query: string, maxResults = 5): Promise<WebHit[]> {
  const fromEngine = await engineSearch(query, maxResults);
  if (fromEngine.length) {
    return fromEngine.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      source: item.source || "DuckDuckGo",
    }));
  }
  return searchDuckDuckGoHtml(query, maxResults);
}

async function searchDuckDuckGoHtml(query: string, maxResults: number): Promise<WebHit[]> {
  try {
    const url = new URL("https://html.duckduckgo.com/html/");
    const body = new URLSearchParams({ q: query });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "TallerBot/1.0 (educational; +https://taller.apps.grok.bot)",
      },
      body,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "follow",
    });
    if (!response.ok) return [];
    const html = await response.text();
    return parseDdgHtml(html, maxResults);
  } catch {
    return [];
  }
}

function parseDdgHtml(html: string, maxResults: number): WebHit[] {
  const hits: WebHit[] = [];
  const block = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)?/gi;
  for (const match of html.matchAll(block)) {
    const href = decodeDdgRedirect(match[1] ?? "");
    const title = stripTags(match[2] ?? "").trim();
    const snippet = stripTags(match[3] ?? "").trim();
    if (!title || !href) continue;
    hits.push({
      title,
      url: href,
      snippet,
      source: "DuckDuckGo",
    });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

function decodeDdgRedirect(href: string): string {
  try {
    if (href.includes("uddg=")) {
      const parsed = new URL(href, "https://duckduckgo.com");
      return parsed.searchParams.get("uddg") || href;
    }
    return href.startsWith("http") ? href : `https:${href}`;
  } catch {
    return href;
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function webHitsToSourceShape(hits: WebHit[] | EngineWebHit[]) {
  return hits.map((hit) => ({
    source: hit.source || "DuckDuckGo",
    title: hit.title,
    summary: hit.snippet || hit.title,
    url: hit.url,
    kind: "encyclopedia" as const,
  }));
}
