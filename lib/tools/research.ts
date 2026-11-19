import { sourcesFromHits, type CitationImage, type CitationSource } from "@/lib/rag/citations";
import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument, RagHit } from "@/lib/rag/types";
import type { Lesson } from "@/lib/lessons";
import { detectAnswerStyle } from "@/lib/style";
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

  const sources =
    rag.sources.length > 0
      ? rag.sources
      : sourcesFromHits(
          rag.hits.map((hit) => ({
            title: hit.chunk.title,
            source: hit.chunk.source,
          })),
        );

  const draft = buildResearchDraft(question, rag.hits, known);
  if (!draft && !rag.images.length) {
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

  const style = detectAnswerStyle(options?.messages ?? []);
  const researchStyle = style === "corto" || style === "natural" ? style : "informativo";

  const polished = await polishAnswer({
    question,
    context: draft,
    messages: options?.messages,
    style: researchStyle,
    images: rag.images,
    sources,
    mode: "research",
  });

  // Si R1 inventa poco o falla, preferimos el borrador estructurado con las fuentes reales.
  const answer =
    polished.ok && looksSubstantive(polished.text, researchStyle) ? polished.text : draft || polished.text;

  return {
    applicable: true,
    answer,
    thinking: polished.thinking,
    images: polished.images,
    sources: polished.sources,
    notes: "",
  };
}

/** Borrador informativo a partir de hits reales (evita alucinaciones del 1.5B). */
export function buildResearchDraft(
  question: string,
  hits: RagHit[],
  known?: { title: string; body: string },
): string {
  const sections: string[] = [`**${question}**`, ""];

  if (known) {
    sections.push(`**${known.title}**`, "", known.body, "");
  }

  const useful = hits
    .map((hit) => ({
      title: hit.chunk.title.replace(/\s+/g, " ").trim(),
      text: hit.chunk.text.replace(/\s+/g, " ").trim().slice(0, 320),
      source: hit.chunk.source,
    }))
    .filter((item) => item.text.length > 40)
    .slice(0, 6);

  if (useful.length) {
    sections.push("**Qué dicen las fuentes**", "");
    for (const item of useful) {
      sections.push(`- **${item.title}:** ${item.text}`);
    }
    sections.push("");
  }

  if (!known && !useful.length) return "";

  sections.push(
    "**En resumen**",
    "",
    known
      ? `Lo esencial: ${known.body.slice(0, 220)}`
      : "Conviene contrastar los puntos anteriores con las fuentes enlazadas al final.",
  );

  return sections.join("\n");
}

function looksSubstantive(text: string, style: string): boolean {
  const clean = text.replace(/_Herramienta:[^_\n]*_/g, "").trim();
  const minChars = style === "corto" ? 120 : 380;
  const minLines = style === "corto" ? 2 : 6;
  if (clean.length < minChars) return false;
  if (clean.split("\n").filter((line) => line.trim()).length < minLines) return false;
  // Señales de basura del modelo pequeño.
  if (/guerres|caminarones|guantes de la carrera|guanacos/i.test(clean)) return false;
  if (/Respuesta:\s*$/m.test(clean) && clean.length < 200) return false;
  return true;
}
