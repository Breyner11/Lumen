import { sourcesFromHits, type CitationImage, type CitationSource } from "@/lib/rag/citations";
import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument } from "@/lib/rag/types";
import type { Lesson } from "@/lib/lessons";
import { polishAnswer } from "@/lib/tools/polish";
import type { ChatTurn } from "@/lib/types";

type ToolResult = {
  applicable: boolean;
  answer: string;
  notes: string;
  thinking?: string;
  images: CitationImage[];
  sources: CitationSource[];
};

const KNOWN: Array<{ match: RegExp; title: string; body: string }> = [
  {
    match: /metodolog[ií]a\s+de\s+(?:la\s+)?investigaci[oó]n|metodolog[ií]a\s+investigativa/,
    title: "Metodología de investigación",
    body: "Es el conjunto de criterios, pasos y técnicas para plantear un problema, recoger información, analizarla y llegar a conclusiones de forma ordenada y comprobable. Incluye problema, objetivos, enfoque, diseño, población/muestra, técnicas, análisis, ética y límites.",
  },
  {
    match: /investigaci[oó]n\s+cient[ií]fica/,
    title: "Investigación científica",
    body: "Es un proceso sistemático para producir conocimiento confiable: pregunta, revisión, método, datos y contraste con la evidencia.",
  },
  {
    match: /\bhip[oó]tesis\b/,
    title: "Hipótesis",
    body: "Es una respuesta provisional a la pregunta de investigación, formulada de modo que se pueda poner a prueba con datos.",
  },
  {
    match: /agua\s+hierve|ebullici[oó]n.*bogot|bogot.*ebullici[oó]n|hierve.*altitud|altitud.*hierve/,
    title: "Por qué el agua hierve a menor temperatura en Bogotá",
    body: "Porque la presión atmosférica baja con la altitud. A menor presión, el agua alcanza el punto de ebullición con menos calor. A nivel del mar hierve cerca de 100 °C; en Bogotá (unos 2.600 m) suele hervir alrededor de 90–92 °C.",
  },
];

export async function researchBrief(
  input: string,
  options?: { documents?: RagDocument[]; lessons?: Lesson[]; messages?: ChatTurn[] },
): Promise<ToolResult> {
  const question = input.trim().replace(/\s+/g, " ");
  if (question.length < 3) {
    return {
      applicable: false,
      answer: "Escribe la pregunta para investigarla con fuentes y memoria local.",
      notes: "",
      images: [],
      sources: [],
    };
  }

  const lower = question.toLowerCase();
  const known = KNOWN.find((item) => item.match.test(lower));
  const rag = await runRagPipeline({
    query: question,
    activity: "investigar",
    documents: options?.documents,
    lessons: options?.lessons,
    includeLiveSources: true,
  });

  // Solo para Ollama: nunca se muestra al usuario.
  const internal = [
    known ? `Dato del taller — ${known.title}: ${known.body}` : "",
    rag.promptBlock || rag.answerBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const sources =
    rag.sources.length > 0
      ? rag.sources
      : sourcesFromHits(
          rag.hits.map((hit) => ({
            title: hit.chunk.title,
            source: hit.chunk.source,
          })),
        );

  if (!internal && !rag.images.length) {
    return {
      applicable: false,
      answer: [
        `No recuperé material útil para «${question}».`,
        "",
        "Prueba a reformular o carga un documento en el botón +.",
      ].join("\n"),
      notes: "",
      images: [],
      sources: [],
    };
  }

  const polished = await polishAnswer({
    question,
    context: internal,
    messages: options?.messages,
    images: rag.images,
    sources,
  });

  if (!polished.ok && known) {
    return {
      applicable: true,
      answer: `**${known.title}**\n\n${known.body}`,
      images: polished.images,
      sources: polished.sources,
      notes: "",
    };
  }

  return {
    applicable: true,
    answer: polished.text,
    thinking: polished.thinking,
    images: polished.images,
    sources: polished.sources,
    notes: "",
  };
}
