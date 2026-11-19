import { ollamaChat } from "@/lib/ollama";

export type TutorPack = {
  applicable: boolean;
  answer: string;
  quiz: Array<{ q: string; a: string }>;
  flashcards: Array<{ front: string; back: string }>;
  weeklyPlan: string[];
};

/** Genera quiz, tarjetas y plan semanal a partir de un tema o texto de archivo. */
export async function buildTutorPack(options: {
  topicOrText: string;
  model?: string;
}): Promise<TutorPack> {
  const source = options.topicOrText.trim().slice(0, 10_000);
  if (source.length < 8) {
    return {
      applicable: false,
      answer: "Indica un tema o pega el texto del archivo para armar el tutor de estudio.",
      quiz: [],
      flashcards: [],
      weeklyPlan: [],
    };
  }

  const drafted = await ollamaChat({
    model: options.model,
    languageMode: "spanish",
    think: false,
    timeoutMs: 90_000,
    numPredict: 520,
    system: [
      "Eres Lumen, tutor de estudio. Solo español.",
      "Devuelve exactamente:",
      "QUIZ:",
      "P1|pregunta|respuesta corta",
      "P2|...",
      "TARJETAS:",
      "T1|anverso|reverso",
      "PLAN:",
      "- día 1: ...",
      "- día 2: ...",
      "Sin URLs. Sin inglés. Sin razonamiento.",
    ].join("\n"),
    prompt: [`Material / tema:\n${source}`, "", "QUIZ:"].join("\n"),
  });

  if (!drafted.ok) {
    return heuristicTutor(source);
  }
  return parseTutor(drafted.text, source);
}

function parseTutor(raw: string, source: string): TutorPack {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const quizBlock = /QUIZ:\s*([\s\S]*?)(?=TARJETAS:|PLAN:|$)/i.exec(text)?.[1] || "";
  const cardsBlock = /TARJETAS:\s*([\s\S]*?)(?=PLAN:|$)/i.exec(text)?.[1] || "";
  const planBlock = /PLAN:\s*([\s\S]*?)$/i.exec(text)?.[1] || "";

  const quiz: TutorPack["quiz"] = [];
  for (const line of quizBlock.split("\n")) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length >= 3 && parts[1] && parts[2]) {
      quiz.push({ q: parts[1]!, a: parts[2]! });
    }
  }
  const flashcards: TutorPack["flashcards"] = [];
  for (const line of cardsBlock.split("\n")) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length >= 3 && parts[1] && parts[2]) {
      flashcards.push({ front: parts[1]!, back: parts[2]! });
    }
  }
  const weeklyPlan = planBlock
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length >= 8)
    .slice(0, 7);

  if (quiz.length < 2 || flashcards.length < 2 || weeklyPlan.length < 3) {
    return heuristicTutor(source);
  }

  const answer = formatTutorAnswer(guessTitle(source), quiz, flashcards, weeklyPlan);
  return { applicable: true, answer, quiz, flashcards, weeklyPlan };
}

function heuristicTutor(source: string): TutorPack {
  const title = guessTitle(source);
  const quiz = [
    { q: `¿Cuál es la idea central de «${title}»?`, a: "La idea que organiza el resto del material." },
    { q: "Nombra dos conceptos clave del tema.", a: "Depende del material; elige los más repetidos." },
    { q: "¿Cómo lo explicarías en tres frases?", a: "Contexto, mecanismo o definición, y un ejemplo." },
  ];
  const flashcards = [
    { front: title, back: source.slice(0, 160) },
    { front: "Concepto 1", back: "Define con tus palabras tras releer el material." },
    { front: "Ejemplo", back: "Busca un caso concreto en el texto o en clase." },
  ];
  const weeklyPlan = [
    "Lunes: lectura completa y subrayado de ideas.",
    "Martes: convertir ideas en 5 flashcards.",
    "Miércoles: quiz sin mirar apuntes.",
    "Jueves: explicar el tema en voz alta (3 minutos).",
    "Viernes: repaso espaciado de tarjetas difíciles.",
    "Sábado: mini ensayo o mapa mental.",
    "Domingo: descanso activo + checklist de dudas para el SAI/tutor.",
  ];
  return {
    applicable: true,
    answer: formatTutorAnswer(title, quiz, flashcards, weeklyPlan) + "\n\n_Nota: plan local de respaldo._",
    quiz,
    flashcards,
    weeklyPlan,
  };
}

function formatTutorAnswer(
  title: string,
  quiz: TutorPack["quiz"],
  flashcards: TutorPack["flashcards"],
  weeklyPlan: string[],
): string {
  return [
    `**Tutor de estudio · ${title}**`,
    "",
    "**Quiz**",
    "",
    ...quiz.map((item, i) => `${i + 1}. ${item.q}\n   _Respuesta:_ ${item.a}`),
    "",
    "**Tarjetas de memoria**",
    "",
    ...flashcards.map((card) => `- **${card.front}:** ${card.back}`),
    "",
    "**Plan semanal**",
    "",
    ...weeklyPlan.map((day) => `- ${day}`),
  ].join("\n");
}

function guessTitle(source: string): string {
  const first = source.split(/\n/)[0]?.trim() || "Tema";
  return first.slice(0, 80);
}

export function looksLikeTutorRequest(input: string): boolean {
  return /\b(tutor|quiz|flashcards?|tarjetas\s+de\s+memoria|plan\s+semanal|ayúdame\s+a\s+estudiar)\b/i.test(
    input,
  );
}
