/**
 * Motores de búsqueda gratuitos / libres para respaldo en modo Auto o Siempre.
 * Prioridad: SearXNG (AGPL, autoalojado) → Wikipedia/Wikidata → Marginalia → DuckDuckGo (gratis, no FLOSS).
 * Sin Brave, Tavily ni ninguna API de pago.
 */

export type SearchEngineId =
  | "searxng"
  | "wikipedia"
  | "wikidata"
  | "marginalia"
  | "duckduckgo";

export type SearchEnginePrefs = {
  searxng: boolean;
  wikipedia: boolean;
  wikidata: boolean;
  marginalia: boolean;
  duckduckgo: boolean;
  /** URL base de SearXNG, p. ej. http://127.0.0.1:8080 */
  searxngUrl: string;
};

export type MultiSearchHit = {
  title: string;
  url: string;
  snippet: string;
  engine: SearchEngineId;
  score: number;
};

export type MultiSearchResult = {
  hits: MultiSearchHit[];
  enginesUsed: SearchEngineId[];
  enginesTried: SearchEngineId[];
};

export const DEFAULT_SEARCH_ENGINE_PREFS: SearchEnginePrefs = {
  searxng: true,
  wikipedia: true,
  wikidata: true,
  marginalia: true,
  duckduckgo: true,
  searxngUrl: "http://127.0.0.1:8080",
};

export const SEARCH_ENGINE_META: Record<
  SearchEngineId,
  { label: string; free: boolean; floss: boolean; blurb: string }
> = {
  searxng: {
    label: "SearXNG",
    free: true,
    floss: true,
    blurb: "Metabuscador libre (AGPL). Motor principal si corre en local.",
  },
  wikipedia: {
    label: "Wikipedia (es)",
    free: true,
    floss: true,
    blurb: "API REST gratuita; contenido CC BY-SA.",
  },
  wikidata: {
    label: "Wikidata",
    free: true,
    floss: true,
    blurb: "Datos exactos (capitales, fechas, autores); CC0.",
  },
  marginalia: {
    label: "Marginalia",
    free: true,
    floss: true,
    blurb: "Buscador independiente con API pública gratuita.",
  },
  duckduckgo: {
    label: "DuckDuckGo",
    free: true,
    floss: false,
    blurb: "Respaldo gratuito (Instant Answer). No es código libre.",
  },
};

const UA = "Lumen/0.1 (local assistant; educational; +https://localhost)";

export function sanitizeSearchEnginePrefs(raw: unknown): SearchEnginePrefs {
  const base = { ...DEFAULT_SEARCH_ENGINE_PREFS };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  for (const key of ["searxng", "wikipedia", "wikidata", "marginalia", "duckduckgo"] as const) {
    if (typeof r[key] === "boolean") base[key] = r[key];
  }
  if (typeof r.searxngUrl === "string" && /^https?:\/\//i.test(r.searxngUrl.trim())) {
    base.searxngUrl = r.searxngUrl.trim().replace(/\/$/, "").slice(0, 200);
  }
  return base;
}

/** Variantes de búsqueda: quita muletillas de pregunta para APIs tipo Wikipedia. */
export function searchQueryVariants(question: string): string[] {
  const raw = question.replace(/[¿?¡!]/g, " ").replace(/\s+/g, " ").trim();
  const stripped = raw
    .replace(
      /^(cu[aá]l\s+es\s+(la|el)\s+|cu[aá]ntos?\s+(es|son|tiene|hay)\s+|qu[eé]\s+es\s+(un|una|el|la)?\s*|c[oó]mo\s+(se\s+)?|dime\s+|explica\s+)/i,
      "",
    )
    .trim();
  const variants = [raw, stripped].filter(Boolean);
  // Capital de X → también "X" y "capital de X"
  const capital = /capital\s+de\s+(.+)/i.exec(stripped || raw);
  if (capital?.[1]) {
    variants.push(capital[1].trim());
    variants.push(`capital de ${capital[1].trim()}`);
  }
  return [...new Set(variants.map((v) => v.slice(0, 120)))].slice(0, 3);
}

/** Consulta 2–3 motores en paralelo, deduplica y prioriza fuentes confiables. */
export async function multiSearch(
  query: string,
  prefs: SearchEnginePrefs = DEFAULT_SEARCH_ENGINE_PREFS,
  options?: { timeoutMs?: number; limit?: number },
): Promise<MultiSearchResult> {
  const timeoutMs = options?.timeoutMs ?? 4_500;
  const limit = options?.limit ?? 8;
  const variants = searchQueryVariants(query);
  const primary = variants[0] || query;
  const enginesTried: SearchEngineId[] = [];
  const tasks: Array<Promise<{ engine: SearchEngineId; hits: MultiSearchHit[] }>> = [];

  const queue = (engine: SearchEngineId, enabled: boolean, fn: () => Promise<MultiSearchHit[]>) => {
    if (!enabled) return;
    enginesTried.push(engine);
    tasks.push(
      withTimeout(fn(), timeoutMs)
        .then((hits) => ({ engine, hits }))
        .catch(() => ({ engine, hits: [] as MultiSearchHit[] })),
    );
  };

  // Orden de arranque: SearXNG primero, luego libres, DDG al final.
  queue("searxng", prefs.searxng, () => searchSearxng(primary, prefs.searxngUrl));
  queue("wikipedia", prefs.wikipedia, async () => {
    for (const v of variants) {
      const hits = await searchWikipediaEs(v);
      if (hits.length) return hits;
    }
    return [];
  });
  queue("wikidata", prefs.wikidata, async () => {
    for (const v of variants) {
      const hits = await searchWikidata(v);
      if (hits.length) return hits;
    }
    return [];
  });

  // Si SearXNG + wiki ya cubren, aún lanzamos 1 respaldo (marginalia o ddg).
  const primaryCount = [prefs.searxng, prefs.wikipedia, prefs.wikidata].filter(Boolean).length;
  if (primaryCount < 3 && prefs.marginalia) {
    queue("marginalia", true, () => searchMarginalia(query));
  } else if (prefs.marginalia && !prefs.searxng) {
    queue("marginalia", true, () => searchMarginalia(query));
  }
  if (prefs.duckduckgo && tasks.length < 3) {
    queue("duckduckgo", true, () => searchDuckDuckGo(query));
  } else if (prefs.duckduckgo && primaryCount === 0) {
    queue("duckduckgo", true, () => searchDuckDuckGo(query));
  }

  // Asegura al menos DDG si nada más está activo.
  if (!tasks.length && prefs.duckduckgo) {
    queue("duckduckgo", true, () => searchDuckDuckGo(query));
  }

  const settled = await Promise.all(tasks);
  const enginesUsed = settled.filter((s) => s.hits.length > 0).map((s) => s.engine);
  const merged = rankAndDedupe(
    settled.flatMap((s) => s.hits),
    query,
  ).slice(0, limit);

  return { hits: merged, enginesUsed, enginesTried };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const ctrl = AbortSignal.timeout(ms);
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const onAbort = () => reject(new Error("timeout"));
      if (ctrl.aborted) onAbort();
      else ctrl.addEventListener("abort", onAbort, { once: true });
    }),
  ]);
}

async function fetchJson(url: string, timeoutMs = 4_000): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": UA },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return response.json();
}

export async function searchSearxng(query: string, baseUrl: string): Promise<MultiSearchHit[]> {
  const base = (baseUrl || DEFAULT_SEARCH_ENGINE_PREFS.searxngUrl).replace(/\/$/, "");
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&language=es-ES`;
  const json = (await fetchJson(url)) as {
    results?: Array<{ title?: string; url?: string; content?: string; engine?: string }>;
  } | null;
  if (!json?.results?.length) return [];
  return json.results.slice(0, 8).map((item, index) => ({
    title: cleanText(item.title || "Resultado SearXNG"),
    url: cleanUrl(item.url || ""),
    snippet: cleanText(item.content || ""),
    engine: "searxng" as const,
    score: 0.82 - index * 0.03,
  })).filter((h) => h.url.startsWith("http"));
}

export async function searchWikipediaEs(query: string): Promise<MultiSearchHit[]> {
  const searchUrl =
    `https://es.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}` +
    `&limit=5&namespace=0&format=json&origin=*`;
  const open = (await fetchJson(searchUrl)) as [string, string[], string[], string[]] | null;
  if (!Array.isArray(open) || open.length < 4) return [];
  const titles = open[1] || [];
  const snippets = open[2] || [];
  const urls = open[3] || [];
  const hits: MultiSearchHit[] = [];
  for (let i = 0; i < Math.min(titles.length, 4); i += 1) {
    const title = titles[i]!;
    let snippet = snippets[i] || "";
    let pageUrl = urls[i] || `https://es.wikipedia.org/wiki/${encodeURIComponent(title)}`;
    try {
      const summary = (await fetchJson(
        `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
        3_500,
      )) as { extract?: string; content_urls?: { desktop?: { page?: string } } } | null;
      if (summary?.extract) snippet = summary.extract.slice(0, 420);
      if (summary?.content_urls?.desktop?.page) pageUrl = summary.content_urls.desktop.page;
    } catch {
      /* resumen opcional */
    }
    hits.push({
      title: cleanText(title),
      url: cleanUrl(pageUrl),
      snippet: cleanText(snippet),
      engine: "wikipedia",
      score: 0.9 - i * 0.04,
    });
  }
  return hits.filter((h) => h.url.startsWith("http"));
}

export async function searchWikidata(query: string): Promise<MultiSearchHit[]> {
  const searchUrl =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}` +
    `&language=es&uselang=es&limit=4&format=json&origin=*`;
  const json = (await fetchJson(searchUrl)) as {
    search?: Array<{ id?: string; label?: string; description?: string; url?: string }>;
  } | null;
  if (!json?.search?.length) return [];
  const hits: MultiSearchHit[] = [];
  for (const [index, item] of json.search.slice(0, 4).entries()) {
    const id = item.id || "";
    if (!id) continue;
    let snippet = item.description || "";
    let label = item.label || id;
    try {
      const entity = (await fetchJson(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=labels|descriptions|claims&languages=es|en&format=json&origin=*`,
        3_500,
      )) as {
        entities?: Record<
          string,
          {
            labels?: Record<string, { value?: string }>;
            descriptions?: Record<string, { value?: string }>;
            claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
          }
        >;
      } | null;
      const ent = entity?.entities?.[id];
      if (ent?.labels?.es?.value) label = ent.labels.es.value;
      else if (ent?.labels?.en?.value) label = ent.labels.en.value;
      if (ent?.descriptions?.es?.value) snippet = ent.descriptions.es.value;
      const facts = extractWikidataFacts(ent?.claims || {});
      if (facts) snippet = `${snippet}${snippet ? ". " : ""}${facts}`.trim();
    } catch {
      /* claims opcionales */
    }
    hits.push({
      title: cleanText(label),
      url: cleanUrl(`https://www.wikidata.org/wiki/${id}`),
      snippet: cleanText(snippet),
      engine: "wikidata",
      score: 0.88 - index * 0.04,
    });
  }
  return hits;
}

function extractWikidataFacts(claims: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>): string {
  const parts: string[] = [];
  // P36 capital, P1082 population, P569 birth, P570 death, P27 country, P50 author
  const capital = claimText(claims.P36);
  if (capital) parts.push(`Capital / sede: ${capital}`);
  const pop = claimNumber(claims.P1082);
  if (pop) parts.push(`Población (aprox.): ${pop}`);
  const birth = claimTime(claims.P569);
  if (birth) parts.push(`Nacimiento: ${birth}`);
  const death = claimTime(claims.P570);
  if (death) parts.push(`Fallecimiento: ${death}`);
  return parts.slice(0, 3).join(". ");
}

function claimText(claim?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>): string {
  const v = claim?.[0]?.mainsnak?.datavalue?.value;
  if (!v || typeof v !== "object") return "";
  const id = (v as { id?: string }).id;
  return id || "";
}

function claimNumber(claim?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>): string {
  const v = claim?.[0]?.mainsnak?.datavalue?.value;
  if (v && typeof v === "object" && "amount" in v) {
    const amount = String((v as { amount?: string }).amount || "").replace(/^\+/, "");
    return amount;
  }
  return "";
}

function claimTime(claim?: Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>): string {
  const v = claim?.[0]?.mainsnak?.datavalue?.value;
  if (v && typeof v === "object" && "time" in v) {
    const time = String((v as { time?: string }).time || "");
    const m = time.match(/([+-]?\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return "";
}

export async function searchMarginalia(query: string): Promise<MultiSearchHit[]> {
  // API pública documentada de Marginalia (sin clave).
  const url = `https://api.marginalia-search.com/search?query=${encodeURIComponent(query)}&count=5`;
  const json = (await fetchJson(url)) as {
    results?: Array<{ title?: string; url?: string; description?: string }>;
  } | null;
  if (!json?.results?.length) return [];
  return json.results.slice(0, 5).map((item, index) => ({
    title: cleanText(item.title || "Marginalia"),
    url: cleanUrl(item.url || ""),
    snippet: cleanText(item.description || ""),
    engine: "marginalia" as const,
    score: 0.7 - index * 0.03,
  })).filter((h) => h.url.startsWith("http"));
}

export async function searchDuckDuckGo(query: string): Promise<MultiSearchHit[]> {
  const url =
    `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  const json = (await fetchJson(url)) as {
    AbstractText?: string;
    AbstractURL?: string;
    Heading?: string;
    Answer?: string;
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Name?: string }>;
  } | null;
  if (!json) return [];
  const hits: MultiSearchHit[] = [];
  if (json.AbstractText && json.AbstractURL) {
    hits.push({
      title: cleanText(json.Heading || "DuckDuckGo"),
      url: cleanUrl(json.AbstractURL),
      snippet: cleanText(json.AbstractText),
      engine: "duckduckgo",
      score: 0.65,
    });
  }
  if (json.Answer) {
    hits.push({
      title: cleanText(json.Heading || "Respuesta rápida"),
      url: cleanUrl(json.AbstractURL || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`),
      snippet: cleanText(json.Answer),
      engine: "duckduckgo",
      score: 0.62,
    });
  }
  for (const [index, topic] of (json.RelatedTopics || []).slice(0, 4).entries()) {
    if (!topic.FirstURL || !topic.Text) continue;
    hits.push({
      title: cleanText(topic.Text.split(" - ")[0] || topic.Name || "Tema"),
      url: cleanUrl(topic.FirstURL),
      snippet: cleanText(topic.Text),
      engine: "duckduckgo",
      score: 0.58 - index * 0.02,
    });
  }
  return hits.filter((h) => h.url.startsWith("http"));
}

function rankAndDedupe(hits: MultiSearchHit[], query: string): MultiSearchHit[] {
  const seen = new Set<string>();
  const scored = hits
    .map((hit) => ({
      ...hit,
      score: hit.score + trustBonus(hit.url) + engineBonus(hit.engine) + queryOverlap(hit, query),
    }))
    .sort((a, b) => b.score - a.score);

  const out: MultiSearchHit[] = [];
  for (const hit of scored) {
    const key = normalizeUrlKey(hit.url) || normalizeKey(hit.title + hit.snippet).slice(0, 80);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

function trustBonus(url: string): number {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host.endsWith("wikipedia.org") || host.endsWith("wikidata.org")) return 0.25;
    if (host.endsWith(".gov.co") || host.endsWith(".edu.co") || host.endsWith(".gov") || host.endsWith(".edu")) {
      return 0.22;
    }
    if (/\b(bbc\.|reuters\.|elpais\.|semana\.com|elespectador\.|portafolio\.)/i.test(host)) return 0.12;
    return 0;
  } catch {
    return 0;
  }
}

function engineBonus(engine: SearchEngineId): number {
  if (engine === "searxng") return 0.08;
  if (engine === "wikipedia" || engine === "wikidata") return 0.1;
  if (engine === "marginalia") return 0.03;
  return 0;
}

function queryOverlap(hit: MultiSearchHit, query: string): number {
  const terms = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 3);
  if (!terms.length) return 0;
  const blob = `${hit.title} ${hit.snippet}`.toLowerCase();
  const hits = terms.filter((t) => blob.includes(t)).length;
  return Math.min(0.12, (hits / terms.length) * 0.12);
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 420);
}

function cleanUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Formatea pie de motores usados (para la respuesta visible). */
export function formatEnginesUsedNote(engines: SearchEngineId[]): string {
  if (!engines.length) return "";
  const labels = engines.map((id) => SEARCH_ENGINE_META[id]?.label || id);
  return `_Motores:_ ${labels.join(", ")}`;
}
