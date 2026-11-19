import { ollamaChat } from "@/lib/ollama";
import {
  stripCitationBlocks,
  type CitationImage,
  type CitationSource,
} from "@/lib/rag/citations";
import { detectAnswerStyle, styleInstruction, type AnswerStyle } from "@/lib/style";
import type { ChatTurn } from "@/lib/types";

export const OLLAMA_WARMUP_MESSAGE =
  "Iniciando modelo DeepSeek en Ollama, intenta de nuevo en unos segundos";

export type PolishResult = {
  text: string;
  thinking?: string;
  images: CitationImage[];
  sources: CitationSource[];
  ok: boolean;
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

  const internal = stripRawContextMarkers(seed).slice(0, 5000);
  const drafted = await ollamaChat({
    languageMode: "spanish",
    system: [
      "Eres Taller, un asistente todoterreno.",
      "Responde SIEMPRE en español natural y correcto, sin importar si las fuentes o documentos están en inglés u otro idioma.",
      "La ÚNICA excepción es cuando el usuario pida explícitamente traducir un texto.",
      "No copies fragmentos crudos ni encabezados tipo «Contexto recuperado», «Según la memoria local y la web» o «Web · …».",
      "No listes scores, ids de chunks ni bloques [1] [2] de recuperación.",
      "Redacta una respuesta limpia y bien estructurada: subtítulos en negrita, listas con viñetas y párrafos cortos.",
      styleInstruction(style),
    ].join("\n"),
    prompt: [
      `Pregunta del usuario:\n${options.question}`,
      "",
      "Material interno (NO lo vuelques crudo; úsalo solo para redactar):",
      internal || "(sin material adicional)",
      "",
      "Entrega solo la respuesta final al usuario.",
    ].join("\n"),
  });

  if (!drafted.ok || !drafted.text.trim()) {
    console.error(
      "[taller/polish] Ollama no redactó la respuesta:",
      drafted.error || "respuesta vacía",
      { model: drafted.model },
    );
    // Nunca volcar recuperación cruda. Si el material ya era una respuesta limpia
    // (p. ej. lección aprendida), la reutilizamos; si no, pedimos reintentar.
    const clean = stripRawContextMarkers(internal);
    if (!clean || looksLikeRawRetrieval(clean)) {
      return {
        text: OLLAMA_WARMUP_MESSAGE,
        images,
        sources,
        ok: false,
      };
    }
    return {
      text: clean.slice(0, 4000),
      images,
      sources,
      ok: false,
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
