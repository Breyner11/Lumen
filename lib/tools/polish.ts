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

const MAX_INTERNAL_CHARS = 1600;

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
}): Promise<PolishResult> {
  const { images: existingImages, sources: existingSources, content: seed } = stripCitationBlocks(
    options.context,
  );
  const images = (options.images?.length ? options.images : existingImages).slice(0, 3);
  const sources = (options.sources?.length ? options.sources : existingSources).slice(0, 12);
  const style = options.style ?? detectAnswerStyle(options.messages ?? []);

  if (options.languageMode === "translate") {
    return {
      text: seed || stripRawContextMarkers(options.context),
      images,
      sources,
      ok: true,
    };
  }

  const internal = stripRawContextMarkers(seed).slice(0, MAX_INTERNAL_CHARS);
  const drafted = await ollamaChat({
    languageMode: "spanish",
    keepAlive: "5m",
    timeoutMs: 180_000,
    think: false,
    system: [
      "Eres Taller, un asistente todoterreno.",
      "Responde SIEMPRE en español natural y correcto.",
      "Sé breve: máximo 120-180 palabras, con subtítulos en negrita y viñetas si ayudan.",
      "No copies fragmentos crudos ni encabezados de recuperación.",
      "No listes scores ni bloques [1] [2].",
      styleInstruction(style === "informativo" ? "informativo" : style === "corto" ? "corto" : "default"),
    ].join("\n"),
    prompt: [
      `Pregunta:\n${options.question}`,
      "",
      "Notas internas (úsalas, no las copies):",
      internal || "(sin notas)",
      "",
      "Respuesta final breve:",
    ].join("\n"),
  });

  if (!drafted.ok || !drafted.text.trim()) {
    console.error(
      "[taller/polish] Ollama no redactó la respuesta:",
      drafted.error || "respuesta vacía",
      { model: drafted.model },
    );
    // Solo usamos resumen local si hay viñetas útiles (answerBlock), no texto de recuperación cruda.
    const fallback = draftFromInternal(options.question, internal);
    if (fallback && /^- /m.test(internal)) {
      return {
        text: fallback,
        images,
        sources,
        ok: false,
        error: drafted.error,
      };
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
  if (!clean || looksLikeRawRetrieval(clean) && !/- /.test(clean)) {
    // Intenta sacar viñetas o frases útiles.
  }
  const bullets = clean
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\s*\[\d+\]/.test(line) && !/score\s+\d/i.test(line))
    .map((line) => line.replace(/^\s*[-*]\s*/, ""))
    .filter((line) => line.length > 20)
    .slice(0, 5);
  if (!bullets.length) return "";
  return [
    `**${question}**`,
    "",
    ...bullets.map((line) => (line.startsWith("-") ? line : `- ${line}`)),
    "",
    "_Resumen a partir de las fuentes (el modelo local tardó demasiado)._",
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

function looksLikeRawRetrieval(text: string): boolean {
  return (
    /Contexto recuperado|Material interno para redactar/i.test(text) ||
    /según la memoria local y la web/i.test(text) ||
    /^\s*\[\d+\]\s+.+\(score\s+\d/m.test(text) ||
    /^\s*\[\d+\]\s+Aprendizaje\b/m.test(text)
  );
}
