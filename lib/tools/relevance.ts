import { STOPWORDS, words } from "@/lib/tools/spanish";

/** Meaningful tokens from a query, without stopwords. */
export function topicTokens(text: string): string[] {
  return words(text).filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

/** True when title/summary shares enough content with the question. */
export function isRelevant(question: string, title: string, summary = ""): boolean {
  const query = topicTokens(question);
  if (query.length === 0) return true;
  const haystack = new Set(topicTokens(`${title} ${summary}`));
  if (haystack.size === 0) return false;
  const hits = query.filter((token) => {
    if (haystack.has(token)) return true;
    // Soft match: token is prefix/suffix of a haystack word (piramide/pirámide already normalized).
    for (const word of haystack) {
      if (word.startsWith(token) || token.startsWith(word)) return true;
    }
    return false;
  }).length;
  const needed = query.length <= 2 ? 1 : Math.min(2, Math.ceil(query.length * 0.34));
  return hits >= needed;
}
