import { sentences, STOPWORDS, words } from "@/lib/tools/spanish";

function scoreSentences(parts: string[]): { sentence: string; score: number }[] {
  const frequencies = new Map<string, number>();
  for (const sentence of parts) {
    for (const word of words(sentence)) {
      if (word.length < 3 || STOPWORDS.has(word)) continue;
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    }
  }
  return parts.map((sentence, index) => {
    const unique = new Set(words(sentence).filter((word) => word.length >= 3 && !STOPWORDS.has(word)));
    let score = 0;
    for (const word of unique) score += frequencies.get(word) ?? 0;
    if (index === 0) score += 2;
    return { sentence, score };
  });
}

export function summarizeText(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  const parts = sentences(text);
  const wordCount = words(text).length;
  if (wordCount < 40 || parts.length < 3) {
    const answer = [
      "El texto todavía es corto para un resumen extractivo.",
      "",
      `Tiene ${wordCount} palabras. Pega un apunte, un artículo o varias oraciones y separo las ideas que más se repiten, sin parafrasearlas.`,
    ].join("\n");
    return { applicable: false, answer, notes: "" };
  }

  const minutes = Math.max(1, Math.round(wordCount / 200));
  const ranked = scoreSentences(parts)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(5, parts.length));
  const chosen = new Set(ranked.map((item) => item.sentence));
  const ordered = parts.filter((sentence) => chosen.has(sentence));
  const bullets = ordered.map((sentence) => `- ${sentence}`).join("\n");
  const answer = [
    `**${ordered.length} ideas** de un texto de ${wordCount} palabras (lectura de unos ${minutes} min).`,
    "",
    "No reescribo el texto: estas son las oraciones que concentran los términos que más se repiten.",
    "",
    bullets,
  ].join("\n");
  return {
    applicable: true,
    answer,
    notes: `Resumen extractivo (${wordCount} palabras):\n${bullets}`,
  };
}
