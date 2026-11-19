import {
  appendCitations,
  sourcesFromHits,
  type CitationImage,
  type CitationSource,
} from "@/lib/rag/citations";
import type { RagContext, RagHit } from "@/lib/rag/types";

export function formatRagContext(
  hits: RagHit[],
  images: CitationImage[] = [],
): RagContext {
  if (!hits.length) {
    return { hits: [], promptBlock: "", answerBlock: "", sources: [], images };
  }

  const sources = sourcesFromHits(
    hits.map((hit) => ({
      title: hit.chunk.title,
      source: hit.chunk.source,
      url: hit.chunk.source?.match(/https?:\/\/\S+/)?.[0],
    })),
  );

  const lines = hits.map((hit, index) => {
    const source = hit.chunk.source ? ` · ${hit.chunk.source}` : "";
    return [
      `[${index + 1}] ${hit.chunk.title}${source} (score ${hit.score.toFixed(2)})`,
      hit.chunk.text.slice(0, 400),
    ].join("\n");
  });

  const promptBlock = [
    "Contexto recuperado por RAG. Prioriza estos fragmentos y cita su título/fuente:",
    "",
    ...lines,
  ].join("\n");

  // Respuesta visible: resumen corto, sin volcar fragmentos crudos.
  const answerBlock = hits
    .slice(0, 3)
    .map((hit) => {
      const snippet = hit.chunk.text.replace(/\s+/g, " ").trim().slice(0, 220);
      return `- **${hit.chunk.title}**: ${snippet}${snippet.length >= 220 ? "…" : ""}`;
    })
    .join("\n");

  return { hits, promptBlock, answerBlock, sources, images: images.slice(0, 3) };
}

export function augmentAnswerWithRag(answer: string, context: RagContext): string {
  if (!context.hits.length && !context.images.length && !context.sources.length) return answer;
  const clean = answer
    .replace(/\*\*Contexto RAG usado\*\*[\s\S]*$/m, "")
    .replace(/\*\*Fuentes consultadas\*\*[\s\S]*$/m, "")
    .trim();
  const withSummary =
    context.answerBlock && !clean.includes(context.answerBlock.slice(0, 40))
      ? [clean, "", "**En resumen (memoria / web)**", "", context.answerBlock].join("\n")
      : clean;
  return appendCitations(withSummary, {
    images: context.images,
    sources: context.sources.length
      ? context.sources
      : sourcesFromHits(
          context.hits.map((hit) => ({
            title: hit.chunk.title,
            source: hit.chunk.source,
          })),
        ),
  });
}

export function citationPayload(
  sources: CitationSource[],
  images: CitationImage[] = [],
): string {
  return appendCitations("", { sources, images }).trim();
}
