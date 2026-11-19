import type { CitationImage, CitationSource } from "@/lib/rag/citations";

export type RagDocument = {
  id: string;
  title: string;
  text: string;
  source?: string;
  createdAt: number;
};

export type RagChunk = {
  id: string;
  documentId: string;
  title: string;
  source?: string;
  text: string;
  index: number;
};

export type RagHit = {
  chunk: RagChunk;
  score: number;
};

export type RagContext = {
  hits: RagHit[];
  promptBlock: string;
  answerBlock: string;
  sources: CitationSource[];
  images: CitationImage[];
};
