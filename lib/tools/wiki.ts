import { isRelevant } from "@/lib/tools/relevance";

export type WikiHit = {
  title: string;
  extract: string;
  url: string;
  description?: string;
};

const UA = "TallerBot/1.0 (https://taller.apps.grok.bot; educational assistant)";

export async function lookupWikipedia(question: string): Promise<WikiHit | null> {
  const query = searchQuery(question);
  if (query.length < 2) return null;

  try {
    const searchUrl = new URL("https://es.wikipedia.org/w/api.php");
    searchUrl.searchParams.set("action", "query");
    searchUrl.searchParams.set("list", "search");
    searchUrl.searchParams.set("srsearch", query);
    searchUrl.searchParams.set("srlimit", "8");
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("utf8", "1");
    searchUrl.searchParams.set("origin", "*");

    const searchRes = await fetch(searchUrl, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!searchRes.ok) return null;
    const searchJson = (await searchRes.json()) as {
      query?: { search?: Array<{ title: string; snippet?: string }> };
    };
    const candidates = searchJson.query?.search ?? [];
    if (!candidates.length) return null;

    for (const candidate of candidates.slice(0, 5)) {
      if (!isRelevant(question, candidate.title, candidate.snippet ?? "")) continue;
      const summary = await pageSummary(candidate.title);
      if (!summary?.extract || summary.extract.length < 40) continue;
      if (!isRelevant(question, summary.title, `${summary.description ?? ""} ${summary.extract}`)) {
        continue;
      }
      return summary;
    }
    return null;
  } catch {
    return null;
  }
}

async function pageSummary(title: string): Promise<WikiHit | null> {
  const url = `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    type?: string;
    title?: string;
    extract?: string;
    description?: string;
    content_urls?: { desktop?: { page?: string } };
  };
  if (data.type === "disambiguation") return null;
  if (!data.title || !data.extract) return null;
  return {
    title: data.title,
    extract: data.extract.trim(),
    description: data.description,
    url: data.content_urls?.desktop?.page ?? `https://es.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
  };
}

export function searchQuery(question: string): string {
  return question
    .replace(/[¿?¡!.,;:]+/g, " ")
    .replace(
      /^(dónde|donde|qué|que|quién|quien|cuándo|cuando|cómo|como|cuál|cual|cuáles|cuales|por\s+qu[eé])\s+/i,
      "",
    )
    .replace(
      /^(se\s+)?(ubica|encuentra|localiza|halla|está|esta|es|significa|fue|viven?|queda|quedan|ocurre|pasa)\s+(la|el|los|las|en|a|al)?\s*/i,
      "",
    )
    .replace(/^(la|el|los|las|un|una|unos|unas)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function formatWikiAnswer(hit: WikiHit, question: string): string {
  return [
    `**${hit.title}**`,
    hit.description ? `_${hit.description}_` : "",
    "",
    hit.extract,
    "",
    `Fuente: [Wikipedia](${hit.url})`,
    "",
    `Pregunta original: «${question.trim()}»`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
