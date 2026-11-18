import { summarizeText } from "@/lib/tools/summarize";
import { STOPWORDS, words } from "@/lib/tools/spanish";

export function studySession(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  if (!text) {
    return {
      applicable: false,
      answer: "Dime el tema, la duda o pega los apuntes. Con un texto largo armo fichas; con una pregunta corta, un plan de tres bloques.",
      notes: "",
    };
  }
  if (words(text).length >= 80) {
    const summary = summarizeText(text);
    const terms = topTerms(text, 4);
    const cards = terms.map((term) => `- **${term}.** ¿Qué papel cumple en estos apuntes, y qué ejemplo lo muestra?`);
    const answer = [
      "Leí los apuntes como material de estudio, no como un examen ya resuelto.",
      "",
      summary.answer,
      "",
      "**Fichas para cerrar la sesión**",
      "",
      cards.join("\n"),
      "",
      "Responde cada ficha sin mirar el texto y después comprueba con la oración de origen.",
    ].join("\n");
    return {
      applicable: true,
      answer,
      notes: `Términos que más se repiten en los apuntes: ${terms.join(", ")}.\n${summary.notes}`,
    };
  }

  const topic = text.replace(/\s+/g, " ");
  const answer = [
    `**Sesión sobre:** ${topic}`,
    "",
    "Tres bloques de 25 minutos, con un corte de 5 entre ellos.",
    "",
    "1. Escribe con tus palabras qué crees que significa, antes de buscar la respuesta.",
    "2. Busca un ejemplo y un caso donde no se cumpla.",
    "3. Ciérralo explicándoselo a alguien que no vio la clase, en cinco oraciones.",
    "",
    "**Preguntas para no quedarte en la definición**",
    "",
    `- ¿Qué problema resuelve «${clip(topic)}»?`,
    "- ¿Con qué se confunde, y cómo los distingues?",
    "- ¿Qué dato tendrías que calcular o recordar en un examen?",
    "- ¿Qué parte todavía no podrías explicar sin mirar los apuntes?",
  ].join("\n");
  return { applicable: false, answer, notes: "" };
}

function topTerms(text: string, count: number): string[] {
  const frequencies = new Map<string, number>();
  for (const word of words(text)) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  }
  return [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([word]) => word);
}

function clip(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
