import { researchBrief } from "@/lib/tools/research";
import { summarizeText } from "@/lib/tools/summarize";
import { STOPWORDS, words } from "@/lib/tools/spanish";

export async function studySession(input: string): Promise<{
  applicable: boolean;
  answer: string;
  notes: string;
}> {
  const text = input.trim();
  if (!text) {
    return {
      applicable: false,
      answer:
        "Dime el tema, la duda o pega los apuntes. Con un texto largo armo fichas; con una pregunta, te explico y te dejo cómo repasarlo.",
      notes: "",
    };
  }
  if (words(text).length >= 80) {
    const summary = summarizeText(text);
    const terms = topTerms(text, 4);
    const cards = terms.map(
      (term) => `- **${term}.** ¿Qué papel cumple en estos apuntes, y qué ejemplo lo muestra?`,
    );
    const answer = [
      "Leí los apuntes como material de estudio.",
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
      notes: `Términos: ${terms.join(", ")}.\n${summary.notes}`,
    };
  }

  // Short questions get a real explanation first (same engine as Investigar).
  if (
    words(text).length < 40 &&
    /^(expl[ií]came|qu[eé]\s+es|qu[eé]\s+significa|c[oó]mo\s+funciona|habla(?:me)?\s+de|por\s+qu[eé]|diferencia)/i.test(
      text,
    )
  ) {
    const researched = await researchBrief(text);
    if (researched.applicable) {
      const answer = [
        researched.answer,
        "",
        "**Para estudiarlo**",
        "",
        "1. Reescribe la idea central en una sola oración sin mirar.",
        "2. Da un ejemplo propio.",
        "3. Di con qué se confunde este tema.",
      ].join("\n");
      return { applicable: true, answer, notes: researched.notes };
    }
  }

  const topic = text.replace(/\s+/g, " ");
  const researched = await researchBrief(topic);
  if (researched.applicable) {
    const answer = [
      researched.answer,
      "",
      "**Plan de 25 minutos**",
      "",
      "1. Subraya la idea central.",
      "2. Inventa un ejemplo y un contraejemplo.",
      "3. Explícaselo a alguien en cinco oraciones.",
    ].join("\n");
    return { applicable: true, answer, notes: researched.notes };
  }

  const answer = [
    `**Sesión sobre:** ${topic}`,
    "",
    "1. Escribe con tus palabras qué crees que significa.",
    "2. Busca un ejemplo y un caso donde no se cumpla.",
    "3. Ciérralo explicándoselo a alguien que no vio la clase.",
    "",
    "**Preguntas**",
    "",
    `- ¿Qué problema resuelve «${clip(topic)}»?`,
    "- ¿Con qué se confunde?",
    "- ¿Qué dato tendrías que recordar en un examen?",
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
