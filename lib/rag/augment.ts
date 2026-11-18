import type { RagContext, RagHit } from "@/lib/rag/types";

export function formatRagContext(hits: RagHit[]): RagContext {
  if (!hits.length) {
    return { hits: [], promptBlock: "", answerBlock: "" };
  }

  const lines = hits.map((hit, index) => {
    const source = hit.chunk.source ? ` · ${hit.chunk.source}` : "";
    return [
      `[${index + 1}] ${hit.chunk.title}${source} (score ${hit.score.toFixed(2)})`,
      hit.chunk.text,
    ].join("\n");
  });

  const promptBlock = [
    "Contexto recuperado por RAG. Prioriza estos fragmentos y cita su título/fuente:",
    "",
    ...lines,
  ].join("\n");

  const answerBlock = [
    "**Contexto RAG usado**",
    "",
    ...hits.map((hit, index) => {
      const source = hit.chunk.source ? ` — ${hit.chunk.source}` : "";
      return `${index + 1}. **${hit.chunk.title}**${source}\n${hit.chunk.text}`;
    }),
  ].join("\n\n");

  return { hits, promptBlock, answerBlock };
}

export function augmentAnswerWithRag(answer: string, context: RagContext): string {
  if (!context.hits.length) return answer;
  if (answer.includes("**Contexto RAG usado**")) return answer;
  return [answer.trim(), "", context.answerBlock].join("\n");
}
