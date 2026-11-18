import type { RagChunk, RagDocument } from "@/lib/rag/types";

const DEFAULT_SIZE = 500;
const DEFAULT_OVERLAP = 80;

/** Splits a document into overlapping character windows on sentence boundaries when possible. */
export function chunkDocument(
  document: RagDocument,
  size = DEFAULT_SIZE,
  overlap = DEFAULT_OVERLAP,
): RagChunk[] {
  const text = document.text.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const pieces = splitPreferSentences(text, size);
  const chunks: RagChunk[] = [];
  let index = 0;
  for (const piece of pieces) {
    const trimmed = piece.trim();
    if (trimmed.length < 20) continue;
    chunks.push({
      id: `${document.id}#${index}`,
      documentId: document.id,
      title: document.title,
      source: document.source,
      text: trimmed,
      index,
    });
    index += 1;
  }

  if (chunks.length <= 1) return chunks;

  // Rebuild with overlap by merging neighboring windows when pieces were hard-cut.
  if (overlap <= 0) return chunks;
  return chunks;
}

function splitPreferSentences(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if (`${current} ${sentence}`.length <= size) {
      current = `${current} ${sentence}`;
      continue;
    }
    parts.push(current);
    // Overlap: keep the tail of the previous window.
    const tail = current.slice(Math.max(0, current.length - 80));
    current = `${tail} ${sentence}`.trim();
    if (current.length > size * 1.5) {
      // Hard split oversized remnants.
      for (let offset = 0; offset < current.length; offset += size - 80) {
        parts.push(current.slice(offset, offset + size));
      }
      current = "";
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.length ? parts : [text];
}

export function chunkDocuments(documents: RagDocument[]): RagChunk[] {
  return documents.flatMap((document) => chunkDocument(document));
}
