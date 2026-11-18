import { STOPWORDS, words } from "@/lib/tools/spanish";

export type SparseVector = Map<string, number>;

/** Builds a TF (term-frequency) sparse vector with light IDF from a shared corpus. */
export function embedText(text: string, idf?: Map<string, number>): SparseVector {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  const total = tokens.length || 1;
  const vector: SparseVector = new Map();
  for (const [token, count] of counts) {
    const tf = count / total;
    const weight = idf?.get(token) ?? 1;
    vector.set(token, tf * weight);
  }
  return vector;
}

export function buildIdf(corpus: string[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const text of corpus) {
    const unique = new Set(tokenize(text));
    for (const token of unique) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const n = Math.max(1, corpus.length);
  const idf = new Map<string, number>();
  for (const [token, df] of documentFrequency) {
    idf.set(token, Math.log((n + 1) / (df + 1)) + 1);
  }
  return idf;
}

export function cosineSimilarity(a: SparseVector, b: SparseVector): number {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  const [shorter, longer] = a.size < b.size ? [a, b] : [b, a];
  for (const [token, value] of shorter) {
    const other = longer.get(token);
    if (other) dot += value * other;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function tokenize(text: string): string[] {
  return words(text).filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}
