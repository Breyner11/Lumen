import { chunkDocuments } from "@/lib/rag/chunk";
import { buildIdf, cosineSimilarity, embedText, type SparseVector } from "@/lib/rag/embed";
import type { RagChunk, RagDocument, RagHit } from "@/lib/rag/types";

export type RagIndex = {
  chunks: RagChunk[];
  vectors: SparseVector[];
  idf: Map<string, number>;
};

export function buildRagIndex(documents: RagDocument[]): RagIndex {
  const chunks = chunkDocuments(documents);
  const idf = buildIdf(chunks.map((chunk) => chunk.text));
  const vectors = chunks.map((chunk) => embedText(`${chunk.title}\n${chunk.text}`, idf));
  return { chunks, vectors, idf };
}

export function searchRagIndex(index: RagIndex, query: string, topK = 4, minScore = 0.08): RagHit[] {
  if (!query.trim() || index.chunks.length === 0) return [];
  const queryVector = embedText(query, index.idf);
  const scored: RagHit[] = [];
  for (let i = 0; i < index.chunks.length; i += 1) {
    const score = cosineSimilarity(queryVector, index.vectors[i]!);
    if (score < minScore) continue;
    scored.push({ chunk: index.chunks[i]!, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
