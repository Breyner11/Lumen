import { ollamaChat } from "@/lib/ollama";

export type FileStudyResult = {
  applicable: boolean;
  answer: string;
  summary: string;
  keyIdeas: string[];
  studyQuestions: string[];
};

/** Resume un texto (PDF/DOCX/TXT ya extraído) con ideas clave y preguntas de estudio. */
export async function studyFromDocumentText(options: {
  title: string;
  text: string;
  model?: string;
}): Promise<FileStudyResult> {
  const title = options.title.trim() || "Documento";
  const text = options.text.trim().slice(0, 12_000);
  if (text.length < 40) {
    return {
      applicable: false,
      answer: "El archivo no tiene texto suficiente para resumir. Prueba con otro PDF, DOCX o TXT.",
      summary: "",
      keyIdeas: [],
      studyQuestions: [],
    };
  }

  const drafted = await ollamaChat({
    model: options.model,
    languageMode: "spanish",
    think: false,
    timeoutMs: 90_000,
    numPredict: 420,
    system: [
      "Eres Lumen, tutor de estudio. Responde SOLO en español.",
      "Devuelve exactamente este formato:",
      "RESUMEN:",
      "(2-4 frases)",
      "IDEAS:",
      "- idea 1",
      "- idea 2",
      "- idea 3",
      "PREGUNTAS:",
      "- pregunta 1",
      "- pregunta 2",
      "- pregunta 3",
      "Sin URLs. Sin inglés. Sin razonamiento visible.",
    ].join("\n"),
    prompt: [`Documento: ${title}`, "", text, "", "RESUMEN:"].join("\n"),
  });

  if (!drafted.ok) {
    const fallback = heuristicStudy(title, text);
    return { ...fallback, answer: `${fallback.answer}\n\n_Nota: el modelo no respondió a tiempo; usé un resumen local rápido._` };
  }

  const parsed = parseStudy(drafted.text, title, text);
  return parsed;
}

function parseStudy(raw: string, title: string, text: string): FileStudyResult {
  const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const summary =
    /RESUMEN:\s*([\s\S]*?)(?=IDEAS:|PREGUNTAS:|$)/i.exec(clean)?.[1]?.trim() ||
    clean.split("\n").find((l) => l.length > 40) ||
    "";
  const ideasBlock = /IDEAS:\s*([\s\S]*?)(?=PREGUNTAS:|$)/i.exec(clean)?.[1] || "";
  const questionsBlock = /PREGUNTAS:\s*([\s\S]*?)$/i.exec(clean)?.[1] || "";
  const keyIdeas = bulletLines(ideasBlock).slice(0, 6);
  const studyQuestions = bulletLines(questionsBlock).slice(0, 6);
  if (!summary || keyIdeas.length < 2) {
    return heuristicStudy(title, text);
  }
  const answer = [
    `**Resumen de «${title}»**`,
    "",
    summary,
    "",
    "**Ideas clave**",
    "",
    ...keyIdeas.map((idea) => `- ${idea}`),
    "",
    "**Preguntas de estudio**",
    "",
    ...studyQuestions.map((q) => `- ${q}`),
  ].join("\n");
  return { applicable: true, answer, summary, keyIdeas, studyQuestions };
}

function heuristicStudy(title: string, text: string): FileStudyResult {
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40)
    .slice(0, 6);
  const summary = sentences.slice(0, 2).join(" ") || text.slice(0, 280);
  const keyIdeas = sentences.slice(0, 4).map((s) => (s.length > 140 ? `${s.slice(0, 137)}…` : s));
  const studyQuestions = [
    `¿Cuál es la idea principal de «${title}»?`,
    "¿Qué conceptos conviene memorizar de este texto?",
    "¿Cómo explicarías este tema en tres frases?",
  ];
  const answer = [
    `**Resumen de «${title}»**`,
    "",
    summary,
    "",
    "**Ideas clave**",
    "",
    ...keyIdeas.map((idea) => `- ${idea}`),
    "",
    "**Preguntas de estudio**",
    "",
    ...studyQuestions.map((q) => `- ${q}`),
  ].join("\n");
  return { applicable: true, answer, summary, keyIdeas, studyQuestions };
}

function bulletLines(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length >= 8);
}
