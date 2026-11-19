import { formatOllamaErrorForUser, ollamaChat } from "@/lib/ollama";
import {
  stripCitationBlocks,
  type CitationImage,
  type CitationSource,
} from "@/lib/rag/citations";
import { detectAnswerStyle, styleInstruction, type AnswerStyle } from "@/lib/style";
import type { ChatTurn } from "@/lib/types";

/** @deprecated Prefer formatOllamaErrorForUser; se mantiene por tests antiguos. */
export const OLLAMA_WARMUP_MESSAGE =
  "Iniciando modelo DeepSeek en Ollama, intenta de nuevo en unos segundos";

export type PolishResult = {
  text: string;
  thinking?: string;
  images: CitationImage[];
  sources: CitationSource[];
  ok: boolean;
  error?: string;
};

/**
 * Redacta una respuesta limpia en español con deepseek-r1:1.5b.
 * El contexto recuperado solo viaja a Ollama como material interno.
 * Nunca se vuelca crudo al usuario.
 */
export async function polishAnswer(options: {
  question: string;
  context: string;
  messages?: ChatTurn[];
  style?: AnswerStyle;
  images?: CitationImage[];
  sources?: CitationSource[];
  languageMode?: "spanish" | "translate";
  /** research = respuesta más completa; chat = equilibrada; corto vía style. */
  mode?: "research" | "chat";
}): Promise<PolishResult> {
  const { images: existingImages, sources: existingSources, content: seed } = stripCitationBlocks(
    options.context,
  );
  const images = (options.images?.length ? options.images : existingImages).slice(0, 3);
  const sources = (options.sources?.length ? options.sources : existingSources).slice(0, 12);
  const style = options.style ?? detectAnswerStyle(options.messages ?? []);
  const mode = options.mode ?? "chat";

  if (options.languageMode === "translate") {
    return {
      text: seed || stripRawContextMarkers(options.context),
      images,
      sources,
      ok: true,
    };
  }

  const maxChars = mode === "research" ? 2200 : style === "corto" ? 1000 : 1600;
  const numPredict = style === "corto" ? 180 : mode === "research" || style === "informativo" ? 420 : 320;
  const internal = stripRawContextMarkers(seed).slice(0, maxChars);

  const lengthRule =
    style === "corto"
      ? "Sé breve: 2–5 viñetas o hasta ~80 palabras."
      : mode === "research" || style === "informativo"
        ? "Sé informativo pero compacto: 2–4 subtítulos y viñetas. Máximo ~220 palabras."
        : "Respuesta clara y útil: 80–160 palabras, con subtítulos o viñetas si ayudan.";

  const drafted = await ollamaChat({
    languageMode: "spanish",
    keepAlive: "5m",
    timeoutMs: 60_000,
    think: false,
    numPredict,
    numCtx: 1536,
    system: [
      "Eres Taller, un asistente todoterreno.",
      "Responde SIEMPRE en español natural y correcto.",
      lengthRule,
      "Usa solo hechos de las notas internas. Si faltan datos, dilo; no inventes nombres, cifras ni listas ficticias.",
      "Markdown limpio: **subtítulo** sin espacios raros dentro de los asteriscos.",
      "No copies encabezados de recuperación ni bloques [1] [2].",
      styleInstruction(style),
    ].join("\n"),
    prompt: [
      `Pregunta del usuario:\n${options.question}`,
      "",
      "Borrador / notas internas (mejora la redacción; no inventes fuera de esto):",
      internal || "(sin notas)",
      "",
      style === "corto" ? "Entrega la versión corta:" : "Entrega la respuesta final bien estructurada:",
    ].join("\n"),
  });

  if (!drafted.ok || !drafted.text.trim()) {
    console.error(
      "[taller/polish] Ollama no redactó la respuesta:",
      drafted.error || "respuesta vacía",
      { model: drafted.model },
    );
    const fallback = draftFromInternal(options.question, internal);
    if (fallback && (internal.includes("**") || /^- /m.test(internal))) {
      return {
        text: fallback,
        images,
        sources,
        ok: false,
        error: drafted.error,
      };
    }
    // Si el contexto ya es un borrador estructurado, úsalo tal cual.
    if (internal.includes("**") && internal.length > 200) {
      return { text: internal, images, sources, ok: false, error: drafted.error };
    }
    return {
      text: formatOllamaErrorForUser(drafted.error, drafted.model),
      images,
      sources,
      ok: false,
      error: drafted.error,
    };
  }

  return {
    text: drafted.text.trim(),
    thinking: drafted.thinking,
    images,
    sources,
    ok: true,
  };
}

/** Resume limpio a partir del material recuperado si Ollama falla/timeout. */
export function draftFromInternal(question: string, context: string): string {
  const clean = stripRawContextMarkers(context);
  if (clean.includes("**") && clean.length > 160) return clean;
  const bullets = clean
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\s*\[\d+\]/.test(line) && !/score\s+\d/i.test(line))
    .map((line) => line.replace(/^\s*[-*]\s*/, ""))
    .filter((line) => line.length > 20)
    .slice(0, 8);
  if (!bullets.length) return "";
  return [
    `**${question}**`,
    "",
    "**Qué dicen las fuentes**",
    "",
    ...bullets.map((line) => (line.startsWith("-") ? line : `- ${line}`)),
  ].join("\n");
}

function stripRawContextMarkers(text: string): string {
  return text
    .split("\n")
    .filter(
      (line) =>
        !/^\s*Contexto recuperado\./i.test(line) &&
        !/^\s*Material interno para redactar:/i.test(line) &&
        !/según la memoria local y la web/i.test(line) &&
        !line.startsWith(":::"),
    )
    .join("\n")
    .trim();
}
