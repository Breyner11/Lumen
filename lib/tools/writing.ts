import { sentences, STOPWORDS, words } from "@/lib/tools/spanish";

export function reviewWriting(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  const tokens = words(text);
  if (tokens.length < 12) {
    return {
      applicable: false,
      answer: "Pega el párrafo o el ensayo. Cuento palabras, oraciones y repeticiones, y te digo qué parte está más cargada.",
      notes: "",
    };
  }
  const parts = sentences(text);
  const sentenceCount = Math.max(parts.length, 1);
  const average = tokens.length / sentenceCount;
  const counts = new Map<string, number>();
  for (const word of tokens) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const repeats = [...counts.entries()]
    .filter(([, count]) => count >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const notes: string[] = [];
  if (average > 28) {
    notes.push(`Las oraciones promedian ${average.toFixed(0)} palabras. Parte en dos las que expliquen más de una idea.`);
  } else if (average < 10 && sentenceCount > 3) {
    notes.push("Las oraciones son muy cortas seguidas. Une las que formen una sola idea para que no suene telegráfico.");
  } else {
    notes.push(`El largo medio es de ${average.toFixed(0)} palabras por oración, cómodo para leer.`);
  }
  if (!/[.!?]$/.test(text)) {
    notes.push("El texto no cierra con punto, interrogación o exclamación.");
  }
  if (repeats.length) {
    notes.push(
      `Se repiten: ${repeats.map(([word, count]) => `${word} (${count})`).join(", ")}. Cambia alguna por un dato concreto.`,
    );
  }
  if (tokens.length > 120 && parts.length < 4) {
    notes.push("Para un texto de este tamaño ayudan tres bloques visibles: de qué trata, el desarrollo y el cierre.");
  }
  const answer = [
    `**${tokens.length} palabras** · ${sentenceCount} oraciones · unas ${Math.max(1, Math.round(tokens.length / 200))} min de lectura`,
    "",
    ...notes.map((note) => `- ${note}`),
  ].join("\n");
  return {
    applicable: true,
    answer,
    notes: `${tokens.length} palabras, ${sentenceCount} oraciones, promedio ${average.toFixed(0)}. ${notes.join(" ")}`,
  };
}
