import { ragEngineUrl } from "@/lib/rag/engine-client";

export type LinkAnalysis = {
  ok: boolean;
  kind?: string;
  title?: string;
  text?: string;
  url?: string;
  facts?: string[];
  apa?: string;
  ieee?: string;
  error?: string;
  indexed?: boolean;
};

const URL_RE = /https?:\/\/[^\s<>\")\]]+/gi;

export function extractUrls(text: string): string[] {
  return text.match(URL_RE) ?? [];
}

export async function analyzeAndLearnLink(url: string): Promise<LinkAnalysis | null> {
  try {
    const response = await fetch(`${ragEngineUrl()}/links/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, learn: true }),
      signal: AbortSignal.timeout(90_000),
      cache: "no-store",
    });
    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
      return { ok: false, error: json.detail || json.error || "No pude analizar el enlace." };
    }
    return (await response.json()) as LinkAnalysis;
  } catch {
    return null;
  }
}

export function formatLinkAnswer(result: LinkAnalysis): string {
  if (!result.ok) {
    return `**No pude analizar el enlace**\n\n${result.error || "Error desconocido."}`;
  }
  const kindLabel =
    result.kind === "youtube"
      ? "YouTube"
      : result.kind === "github"
        ? "GitHub"
        : result.kind === "reference"
          ? "Referencia"
          : "Enlace";
  return [
    `_Herramienta: ${kindLabel}_`,
    "",
    `**${result.title || result.url}**`,
    result.url ? `[Abrir](${result.url})` : "",
    "",
    (result.text || "").slice(0, 3500),
    result.apa ? `\n**APA:** ${result.apa}` : "",
    result.ieee ? `\n**IEEE:** ${result.ieee}` : "",
    result.indexed ? "\n_Indexado en la memoria local del motor._" : "",
  ]
    .filter(Boolean)
    .join("\n");
}
