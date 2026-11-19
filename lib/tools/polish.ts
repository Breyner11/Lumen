import { ollamaChat } from "@/lib/ollama";
import { appendCitations, stripCitationBlocks, type CitationImage, type CitationSource } from "@/lib/rag/citations";
import { detectAnswerStyle, styleInstruction, type AnswerStyle } from "@/lib/style";
import type { ChatTurn } from "@/lib/types";

/**
 * Redacta una respuesta limpia en español con deepseek-r1:1.5b
 * usando el contexto recuperado solo como material interno.
 */
export async function polishAnswer(options: {
  question: string;
  context: string;
  messages?: ChatTurn[];
  style?: AnswerStyle;
  images?: CitationImage[];
  sources?: CitationSource[];
  languageMode?: "spanish" | "translate";
}): Promise<string> {
  const { images: existingImages, sources: existingSources, content: seed } = stripCitationBlocks(
    options.context,
  );
  const images = options.images?.length ? options.images : existingImages;
  const sources = options.sources?.length ? options.sources : existingSources;
  const style = options.style ?? detectAnswerStyle(options.messages ?? []);

  if (options.languageMode === "translate") {
    return appendCitations(seed || options.context, { images, sources });
  }

  const drafted = await ollamaChat({
    languageMode: "spanish",
    system: [
      "Eres Taller, un asistente todoterreno.",
      "Responde SIEMPRE en español natural y correcto, sin importar si las fuentes o documentos están en inglés u otro idioma.",
      "La ÚNICA excepción es cuando el usuario pida explícitamente traducir un texto.",
      "No copies fragmentos crudos ni encabezados tipo «Según la memoria local y la web» o «Web · …».",
      "Redacta una respuesta limpia y bien estructurada: subtítulos en negrita, listas con viñetas y párrafos cortos.",
      styleInstruction(style),
    ].join("\n"),
    prompt: [
      `Pregunta del usuario:\n${options.question}`,
      "",
      "Material interno (NO lo vuelques crudo; úsalo para redactar):",
      seed.slice(0, 5000) || "(sin material adicional)",
      "",
      "Entrega solo la respuesta final al usuario.",
    ].join("\n"),
  });

  const body =
    drafted.ok && drafted.text.trim()
      ? drafted.thinking
        ? `<think>${drafted.thinking}</think>\n\n${drafted.text.trim()}`
        : drafted.text.trim()
      : fallbackFromContext(options.question, seed);

  return appendCitations(body, { images, sources });
}

function fallbackFromContext(question: string, context: string): string {
  const lines = context
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(":::") && !/según la memoria|web ·/i.test(line))
    .slice(0, 8);
  if (!lines.length) {
    return `**${question}**\n\nNo pude redactar con el modelo local. Revisa Ollama (\`deepseek-r1:1.5b\`) o reformula la pregunta.`;
  }
  return [`**${question}**`, "", ...lines.map((line) => (line.startsWith("-") ? line : `- ${line}`))].join(
    "\n",
  );
}
