import { lookupWikipedia, searchQuery, type WikiHit } from "@/lib/tools/wiki";

export type SourceHit = {
  source: string;
  title: string;
  summary: string;
  url: string;
  kind: "encyclopedia" | "structured" | "paper" | "book";
  year?: number;
};

const UA = "TallerBot/1.0 (https://taller.apps.grok.bot; educational research assistant)";
const MAIL = "mailto:taller@apps.grok.bot";

export async function gatherSources(question: string): Promise<SourceHit[]> {
  const query = searchQuery(question) || question.trim();
  if (query.length < 2) return [];

  const settled = await Promise.allSettled([
    fromWikipedia(question),
    fromWikidata(query),
    fromOpenAlex(query),
    fromCrossref(query),
    fromEuropePmc(query),
    fromOpenLibrary(query),
  ]);

  const hits: SourceHit[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") hits.push(...result.value);
  }
  return dedupe(hits).slice(0, 12);
}

async function fromWikipedia(question: string): Promise<SourceHit[]> {
  const wiki = await lookupWikipedia(question);
  if (!wiki) return [];
  return [wikiToHit(wiki)];
}

function wikiToHit(wiki: WikiHit): SourceHit {
  return {
    source: "Wikipedia",
    title: wiki.title,
    summary: wiki.description ? `${wiki.description}. ${wiki.extract}` : wiki.extract,
    url: wiki.url,
    kind: "encyclopedia",
  };
}

async function fromWikidata(query: string): Promise<SourceHit[]> {
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.searchParams.set("action", "wbsearchentities");
  searchUrl.searchParams.set("search", query);
  searchUrl.searchParams.set("language", "es");
  searchUrl.searchParams.set("uselang", "es");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("limit", "3");
  searchUrl.searchParams.set("origin", "*");

  const searchRes = await fetch(searchUrl, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!searchRes.ok) return [];
  const searchJson = (await searchRes.json()) as {
    search?: Array<{ id: string; label?: string; description?: string; concepturi?: string }>;
  };
  const first = searchJson.search?.[0];
  if (!first?.id) return [];

  const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${first.id}.json`;
  const entityRes = await fetch(entityUrl, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!entityRes.ok) return [];
  const entityJson = (await entityRes.json()) as {
    entities?: Record<
      string,
      {
        labels?: Record<string, { value: string }>;
        descriptions?: Record<string, { value: string }>;
        claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
      }
    >;
  };
  const entity = entityJson.entities?.[first.id];
  if (!entity) return [];

  const label = entity.labels?.es?.value ?? entity.labels?.en?.value ?? first.label ?? first.id;
  const description =
    entity.descriptions?.es?.value ?? entity.descriptions?.en?.value ?? first.description ?? "";
  const facts = await extractWikidataFacts(entity.claims ?? {});
  const summary = [description, ...facts].filter(Boolean).join(". ");
  if (!summary) return [];

  return [
    {
      source: "Wikidata",
      title: label,
      summary,
      url: first.concepturi?.replace("http://", "https://") ?? `https://www.wikidata.org/wiki/${first.id}`,
      kind: "structured",
    },
  ];
}

async function extractWikidataFacts(
  claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>,
): Promise<string[]> {
  const facts: string[] = [];
  const countryId = entityIdFromClaim(claims.P17);
  const placeId = entityIdFromClaim(claims.P131);
  const coords = coordsFromClaim(claims.P625);
  const inception = timeFromClaim(claims.P571);

  const ids = [countryId, placeId].filter(Boolean) as string[];
  const labels = ids.length ? await resolveEntityLabels(ids) : {};

  if (countryId && labels[countryId]) facts.push(`País: ${labels[countryId]}`);
  if (placeId && labels[placeId]) facts.push(`Ubicación administrativa: ${labels[placeId]}`);
  if (coords) facts.push(`Coordenadas: ${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}`);
  if (inception) facts.push(`Fecha aproximada: ${inception}`);
  return facts;
}

function entityIdFromClaim(
  claims?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>,
): string | null {
  const value = claims?.[0]?.mainsnak?.datavalue?.value;
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: string }).id;
  return typeof id === "string" ? id : null;
}

function coordsFromClaim(
  claims?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>,
): { lat: number; lon: number } | null {
  const value = claims?.[0]?.mainsnak?.datavalue?.value;
  if (!value || typeof value !== "object") return null;
  const lat = (value as { latitude?: number }).latitude;
  const lon = (value as { longitude?: number }).longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return { lat, lon };
}

function timeFromClaim(
  claims?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>,
): string | null {
  const value = claims?.[0]?.mainsnak?.datavalue?.value;
  if (!value || typeof value !== "object") return null;
  const time = (value as { time?: string }).time;
  if (typeof time !== "string") return null;
  // +[-]YYYY-MM-DD...
  const match = time.match(/^([+-]?\d+)-/);
  if (!match) return null;
  const year = Number(match[1]);
  if (!Number.isFinite(year)) return null;
  return year < 0 ? `${Math.abs(year)} a. C.` : `${year}`;
}

async function resolveEntityLabels(ids: string[]): Promise<Record<string, string>> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.searchParams.set("action", "wbgetentities");
  url.searchParams.set("ids", ids.join("|"));
  url.searchParams.set("props", "labels");
  url.searchParams.set("languages", "es|en");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) return {};
  const json = (await res.json()) as {
    entities?: Record<string, { labels?: Record<string, { value: string }> }>;
  };
  const out: Record<string, string> = {};
  for (const id of ids) {
    const labels = json.entities?.[id]?.labels;
    const label = labels?.es?.value ?? labels?.en?.value;
    if (label) out[id] = label;
  }
  return out;
}

async function fromOpenAlex(query: string): Promise<SourceHit[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", "3");
  url.searchParams.set("sort", "relevance_score:desc");
  url.searchParams.set(
    "select",
    "id,title,publication_year,doi,authorships,primary_location,abstract_inverted_index",
  );

  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": `${UA} ${MAIL}` },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: Array<{
      id?: string;
      title?: string;
      publication_year?: number;
      doi?: string;
      authorships?: Array<{ author?: { display_name?: string } }>;
      primary_location?: { landing_page_url?: string; source?: { display_name?: string } };
      abstract_inverted_index?: Record<string, number[]>;
    }>;
  };

  return (json.results ?? [])
    .filter((item) => item.title)
    .map((item) => {
      const authors = (item.authorships ?? [])
        .slice(0, 3)
        .map((a) => a.author?.display_name)
        .filter(Boolean)
        .join(", ");
      const abstract = invertAbstract(item.abstract_inverted_index).slice(0, 280);
      const doiUrl = item.doi ? (item.doi.startsWith("http") ? item.doi : `https://doi.org/${item.doi.replace(/^https?:\/\/doi\.org\//, "")}`) : "";
      const urlHit =
        item.primary_location?.landing_page_url ||
        doiUrl ||
        item.id?.replace("https://openalex.org/", "https://openalex.org/") ||
        "https://openalex.org/";
      const summary = [authors && `Autores: ${authors}`, abstract].filter(Boolean).join(". ");
      return {
        source: "OpenAlex",
        title: item.title!,
        summary: summary || "Trabajo académico indexado en OpenAlex.",
        url: urlHit,
        kind: "paper" as const,
        year: item.publication_year,
      };
    });
}

function invertAbstract(index?: Record<string, number[]>): string {
  if (!index) return "";
  const slots: Array<{ word: string; pos: number }> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) slots.push({ word, pos });
  }
  return slots
    .sort((a, b) => a.pos - b.pos)
    .map((slot) => slot.word)
    .join(" ");
}

async function fromCrossref(query: string): Promise<SourceHit[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query);
  url.searchParams.set("rows", "3");
  url.searchParams.set("select", "DOI,title,author,published-print,published-online,abstract,URL,container-title");

  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": `${UA} ${MAIL}` },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    message?: {
      items?: Array<{
        DOI?: string;
        title?: string[];
        author?: Array<{ family?: string; given?: string }>;
        abstract?: string;
        URL?: string;
        "container-title"?: string[];
        "published-print"?: { "date-parts"?: number[][] };
        "published-online"?: { "date-parts"?: number[][] };
      }>;
    };
  };

  return (json.message?.items ?? [])
    .filter((item) => item.title?.[0])
    .map((item) => {
      const authors = (item.author ?? [])
        .slice(0, 3)
        .map((a) => [a.given, a.family].filter(Boolean).join(" "))
        .filter(Boolean)
        .join(", ");
      const year =
        item["published-print"]?.["date-parts"]?.[0]?.[0] ??
        item["published-online"]?.["date-parts"]?.[0]?.[0];
      const venue = item["container-title"]?.[0];
      const abstract = stripTags(item.abstract ?? "").slice(0, 280);
      const doi = item.DOI ? `https://doi.org/${item.DOI}` : item.URL || "https://www.crossref.org/";
      return {
        source: "Crossref",
        title: item.title![0],
        summary: [authors && `Autores: ${authors}`, venue && `En: ${venue}`, abstract]
          .filter(Boolean)
          .join(". "),
        url: doi,
        kind: "paper" as const,
        year: typeof year === "number" ? year : undefined,
      };
    });
}

async function fromEuropePmc(query: string): Promise<SourceHit[]> {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageSize", "3");
  url.searchParams.set("resultType", "lite");

  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    resultList?: {
      result?: Array<{
        title?: string;
        authorString?: string;
        pubYear?: string;
        doi?: string;
        pmid?: string;
        journalTitle?: string;
      }>;
    };
  };

  return (json.resultList?.result ?? [])
    .filter((item) => item.title)
    .map((item) => {
      const urlHit = item.doi
        ? `https://doi.org/${item.doi}`
        : item.pmid
          ? `https://europepmc.org/article/MED/${item.pmid}`
          : "https://europepmc.org/";
      return {
        source: "Europe PMC",
        title: item.title!,
        summary: [item.authorString && `Autores: ${item.authorString}`, item.journalTitle && `Revista: ${item.journalTitle}`]
          .filter(Boolean)
          .join(". "),
        url: urlHit,
        kind: "paper" as const,
        year: item.pubYear ? Number(item.pubYear) : undefined,
      };
    });
}

async function fromOpenLibrary(query: string): Promise<SourceHit[]> {
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "3");
  url.searchParams.set("fields", "key,title,author_name,first_publish_year,edition_count");

  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    docs?: Array<{
      key?: string;
      title?: string;
      author_name?: string[];
      first_publish_year?: number;
    }>;
  };

  return (json.docs ?? [])
    .filter((item) => item.title && item.key)
    .map((item) => ({
      source: "Open Library",
      title: item.title!,
      summary: `Autores: ${(item.author_name ?? []).slice(0, 3).join(", ") || "varios"}.`,
      url: `https://openlibrary.org${item.key}`,
      kind: "book" as const,
      year: item.first_publish_year,
    }));
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function dedupe(hits: SourceHit[]): SourceHit[] {
  const seen = new Set<string>();
  const out: SourceHit[] = [];
  for (const hit of hits) {
    const key = `${hit.source}:${hit.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  // Prefer encyclopedia/structured first, then papers, then books.
  const rank = { encyclopedia: 0, structured: 1, paper: 2, book: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

export function formatMultiSourceAnswer(question: string, hits: SourceHit[], lead?: string): string {
  const encyclopedia = hits.find((hit) => hit.kind === "encyclopedia");
  const structured = hits.find((hit) => hit.kind === "structured");
  const papers = hits.filter((hit) => hit.kind === "paper").slice(0, 4);
  const books = hits.filter((hit) => hit.kind === "book").slice(0, 2);

  const sections: string[] = [];
  sections.push(`**Pregunta:** ${question}`);
  sections.push("");

  if (lead) {
    sections.push(lead);
    sections.push("");
  } else if (encyclopedia) {
    sections.push(`**Respuesta (Wikipedia):** ${encyclopedia.title}`);
    sections.push("");
    sections.push(encyclopedia.summary.slice(0, 900));
    sections.push("");
  } else if (structured) {
    sections.push(`**Datos (Wikidata):** ${structured.title}`);
    sections.push("");
    sections.push(structured.summary);
    sections.push("");
  } else if (papers[0]) {
    sections.push("No hay una ficha enciclopédica clara; estos son trabajos indexados sobre el tema:");
    sections.push("");
  }

  if (structured && encyclopedia) {
    sections.push(`**Datos comprobables (Wikidata):** ${structured.summary}`);
    sections.push("");
  }

  if (papers.length) {
    sections.push("**Artículos y trabajos indexados**");
    sections.push("");
    for (const paper of papers) {
      const year = paper.year ? ` (${paper.year})` : "";
      sections.push(`- **${paper.title}**${year} — ${paper.source}`);
      if (paper.summary) sections.push(`  ${paper.summary.slice(0, 220)}`);
      sections.push(`  ${paper.url}`);
    }
    sections.push("");
  }

  if (books.length) {
    sections.push("**Libros (Open Library)**");
    sections.push("");
    for (const book of books) {
      const year = book.year ? ` (${book.year})` : "";
      sections.push(`- **${book.title}**${year} — ${book.summary} ${book.url}`);
    }
    sections.push("");
  }

  sections.push("**Fuentes consultadas**");
  sections.push("");
  const uniqueSources = [...new Set(hits.map((hit) => hit.source))];
  for (const source of uniqueSources) {
    const sample = hits.find((hit) => hit.source === source);
    sections.push(`- ${source}${sample ? `: ${sample.url}` : ""}`);
  }
  sections.push("");
  sections.push(
    "_Solo se muestran fuentes con enlace. Si dos bases discrepan, prioriza el artículo académico con DOI o la ficha de Wikidata/Wikipedia._",
  );

  return sections.join("\n");
}
