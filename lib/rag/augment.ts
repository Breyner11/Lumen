import {
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

  // Solo para Ollama (contexto interno). Nunca se muestra en el chat.
  const promptBlock = ["Material interno para redactar:", "", ...lines].join("\n");

  const answerBlock = hits
    .slice(0, 5)
    .map((hit) => {
      const snippet = hit.chunk.text.replace(/\s+/g, " ").trim().slice(0, 280);
      return `- ${hit.chunk.title}: ${snippet}`;
    })
    .join("\n");

  return { hits, promptBlock, answerBlock, sources, images: images.slice(0, 3) };
}

/** @deprecated Prefer polishAnswer; se mantiene por compatibilidad mínima. */
export function augmentAnswerWithRag(answer: string, context: RagContext): string {
  if (!context.hits.length && !context.images.length && !context.sources.length) return answer;
  return answer.trim();
}

export function citationPayload(
  sources: CitationSource[],
  images: CitationImage[] = [],
): { sources: CitationSource[]; images: CitationImage[] } {
  return { sources, images };
}
