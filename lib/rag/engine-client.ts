import type { RagDocument } from "@/lib/rag/types";

const DEFAULT_URL = process.env.RAG_ENGINE_URL?.trim() || "http://127.0.0.1:8765";

export type EngineWebHit = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

export type EngineRagHit = {
  id: string;
  title: string;
  source?: string;
  text: string;
  score: number;
};

export type EngineHealth = {
  ok: boolean;
  ollama?: boolean;
  embed_model?: string;
  search?: string;
  engine?: string;
  vision_model?: string | null;
  math_model?: string | null;
  sympy?: boolean;
  models?: string[];
};

export function ragEngineUrl(): string {
  return DEFAULT_URL.replace(/\/$/, "");
}

export async function engineHealth(signal?: AbortSignal): Promise<EngineHealth | null> {
  try {
    const response = await fetch(`${ragEngineUrl()}/health`, {
      signal: signal ?? AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as EngineHealth;
  } catch {
    return null;
  }
}

export async function engineSearch(query: string, maxResults = 5): Promise<EngineWebHit[]> {
  try {
    const response = await fetch(`${ragEngineUrl()}/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, max_results: maxResults }),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { results?: EngineWebHit[] };
    return json.results ?? [];
  } catch {
    return [];
  }
}

export async function engineIndexDocument(document: RagDocument): Promise<boolean> {
  try {
    const response = await fetch(`${ragEngineUrl()}/index`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: document.id,
        title: document.title,
        text: document.text,
        source: document.source ?? "usuario",
      }),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function engineQuery(
  query: string,
  options?: { topK?: number; web?: boolean },
): Promise<{ hits: EngineRagHit[]; web: EngineWebHit[]; embedBackend?: string } | null> {
  try {
    const response = await fetch(`${ragEngineUrl()}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        top_k: options?.topK ?? 4,
        web: options?.web ?? true,
      }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      hits?: EngineRagHit[];
      web?: EngineWebHit[];
      embed_backend?: string;
    };
    return {
      hits: json.hits ?? [],
      web: json.web ?? [],
      embedBackend: json.embed_backend,
    };
  } catch {
    return null;
  }
}
