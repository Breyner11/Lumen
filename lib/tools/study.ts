import { researchBrief } from "@/lib/tools/research";
import { summarizeText } from "@/lib/tools/summarize";
import { STOPWORDS, words } from "@/lib/tools/spanish";

const STUDY_TOPICS: Array<{ match: RegExp; title: string; body: string }> = [
  {
    match: /fotos[ií]ntesis/,
    title: "Fotosíntesis",
    body: [
      "Las plantas convierten **luz, agua y CO₂** en azúcares y liberan oxígeno.",
      "",
      "1. La clorofila captura luz en las hojas.",
      "2. El agua llega por la raíz; el CO₂, por los estomas.",
      "3. Se forma glucosa (alimento) y se suelta O₂.",
      "",
      "Sin luz, el proceso se detiene o baja mucho: por eso una planta en un closet se debilita.",
    ].join("\n"),
  },
  {
    match: /fracci[oó]n(?:es)?\s+equivalente|equivalente(?:s)?\s+frac/,
    title: "Fracciones equivalentes",
    body: [
      "Dos fracciones son equivalentes si representan **la misma cantidad**, aunque se escriban distinto (1/2 = 2/4 = 3/6).",
      "",
      "Se obtienen multiplicando o dividiendo numerador y denominador por el mismo número distinto de cero.",
    ].join("\n"),
  },
];

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

  const lower = text.toLowerCase();
  const known = STUDY_TOPICS.find((item) => item.match.test(lower));
  if (known) {
    return {
      applicable: true,
      answer: [
        `**${known.title}**`,
        "",
        known.body,
        "",
        studyPlan(known.title),
      ].join("\n"),
      notes: `Explicación de estudio: ${known.title}`,
    };
  }

  // How to study X → concrete plan, optionally with a short explanation.
  if (/c[oó]mo\s+estudiar|plan\s+de\s+estudio|tengo\s+examen|repasar|para\s+(?:el\s+)?examen/.test(lower)) {
    const topic =
      text
        .replace(/^.*?(?:sobre|de|del|en)\s+/i, "")
        .replace(/[?¿!.]+$/g, "")
        .trim() || text;
    const researched = await researchBrief(topic);
    const lead = researched.applicable
      ? researched.answer.split("\n").slice(0, 12).join("\n")
      : `Tema: **${topic}**.`;
    return {
      applicable: true,
      answer: [
        lead,
        "",
        "**Plan para estudiar (hoy)**",
        "",
        "1. 10 min: escribe lo que ya crees saber, sin mirar apuntes.",
        "2. 25 min: lee o mira una explicación y marca 5 ideas clave.",
        "3. 15 min: hazte 5 preguntas y respóndelas en voz alta.",
        "4. 5 min: anota lo que todavía no podrías explicar.",
        "",
        "Si el examen es mañana, prioriza las 5 ideas y un ejemplo por idea; no intentes releer todo.",
      ].join("\n"),
      notes: researched.notes || `Plan de estudio para «${topic}».`,
    };
  }

  // Absurd / clearly fictional topics: answer honestly without forcing bad wiki hits.
  if (isPlayfulOrAbsurd(lower)) {
    return {
      applicable: true,
      answer: [
        `**Tema:** ${text}`,
        "",
        "Eso suena a mezcla creativa, no a un concepto de clase. Aun así se puede estudiar el truco:",
        "",
        "1. Separa lo real de lo inventado (por ejemplo, «matemáticas» sí; «unicornio rosa que vuela» no como especie).",
        "2. Escoge la parte útil (definir, comparar, inventar un problema).",
        "3. Cierra con una pregunta que sí se pueda calificar.",
        "",
        "**Ejemplo de ficha**",
        "",
        `- Invento: ${clip(text, 80)}`,
        "- Parte seria que sí estudiarías: ________________",
        "- Pregunta de examen posible: ________________",
      ].join("\n"),
      notes: "Tema creativo/absurdo: plan de estudio sin fuentes forzadas.",
    };
  }

  if (
    words(text).length < 40 &&
    /^(expl[ií]came|qu[eé]\s+es|qu[eé]\s+significa|c[oó]mo\s+funciona|habla(?:me)?\s+de|por\s+qu[eé]|diferencia)/i.test(
      text,
    )
  ) {
    const researched = await researchBrief(text);
    if (researched.applicable) {
      return {
        applicable: true,
        answer: [researched.answer, "", studyPlan(clip(text, 60))].join("\n"),
        notes: researched.notes,
      };
    }
  }

  const researched = await researchBrief(text);
  if (researched.applicable) {
    return {
      applicable: true,
      answer: [researched.answer, "", studyPlan(clip(text, 60))].join("\n"),
      notes: researched.notes,
    };
  }

  const topic = text.replace(/\s+/g, " ");
  return {
    applicable: true,
    answer: [
      `**Sesión sobre:** ${topic}`,
      "",
      "1. Escribe con tus palabras qué crees que significa.",
      "2. Busca un ejemplo y un caso donde no se cumpla.",
      "3. Explícaselo a alguien en cinco oraciones.",
      "",
      studyPlan(topic),
    ].join("\n"),
    notes: "",
  };
}

function studyPlan(topic: string): string {
  return [
    "**Para fijarlo**",
    "",
    `- Reescribe «${clip(topic, 70)}» en una oración.`,
    "- Da un ejemplo propio y un contraejemplo.",
    "- Di con qué se confunde este tema.",
  ].join("\n");
}

function isPlayfulOrAbsurd(lower: string): boolean {
  return /unicornio|drag[oó]n|pl[aá]tano\s+que|gato\s+robot|vuela\s+con|rosa\s+que|marciano|pizza\s+hablante|absurdo/.test(
    lower,
  );
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

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
