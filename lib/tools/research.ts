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

  // El 1.5B suele acortar o rellenar; preferimos el borrador anclado a hits si el polish no aporta.
  const answer = chooseResearchAnswer(polished.text, draft, researchStyle, polished.ok);

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
  const heading = cleanQuestionHeading(question);
  const sections: string[] = heading ? [`**${heading}**`, ""] : [];

  if (known) {
    sections.push(`**${known.title}**`, "", known.body, "");
  }

  const useful = hits
    .map((hit) => ({
      title: cleanHitTitle(hit.chunk.title, hit.chunk.source),
      text: cleanHitText(hit.chunk.text),
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

function cleanQuestionHeading(question: string): string {
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length < 3) return "";
  if (q.length <= 72) return q.charAt(0).toUpperCase() + q.slice(1);
  return `${q.slice(0, 69).trim()}…`;
}

function cleanHitTitle(rawTitle: string, source?: string): string {
  let title = rawTitle.replace(/\s+/g, " ").trim();
  title = title.replace(/^Aprendizaje(?:\s+web)?:\s*/i, "");
  title = title.split(/\s+Fecha\s*\(/i)[0]?.trim() || title;
  title = title.split(/\s*##\s*/)[0]?.trim() || title;
  if (/^https?:\/\//i.test(title) && source) {
    try {
      title = new URL(source).hostname.replace(/^www\./, "");
    } catch {
      /* keep */
    }
  }
  if (title.length > 56) title = `${title.slice(0, 53).trim()}…`;
  return title || "Fuente";
}

function cleanHitText(raw: string): string {
  return raw
    .replace(/^#+\s*/gm, "")
    .replace(/\bAprendizaje(?:\s+web)?:\s*/gi, "")
    .replace(/\bFecha\s*\([^)]*\):\s*/gi, "")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

export function chooseResearchAnswer(
  polished: string,
  draft: string,
  style: string,
  polishOk: boolean,
): string {
  if (!draft) return polished;
  if (!polishOk || !looksSubstantive(polished, style) || isRepetitivePad(polished)) {
    return draft;
  }
  // Si el polish es mucho más corto que el borrador, conservar el borrador.
  if (style !== "corto" && polished.trim().length < draft.trim().length * 0.55) {
    return draft;
  }
  return polished;
}

function looksSubstantive(text: string, style: string): boolean {
  const clean = text.replace(/_Herramienta:[^_\n]*_/g, "").trim();
  const minChars = style === "corto" ? 120 : 380;
  const minLines = style === "corto" ? 2 : 6;
  if (clean.length < minChars) return false;
  if (clean.split("\n").filter((line) => line.trim()).length < minLines) return false;
  // Señales de basura del modelo pequeño.
  if (/guerres|caminarones|guantes de la carrera|guanacos|\bcaballos\b/i.test(clean)) return false;
  if (/Respuesta:\s*$/m.test(clean) && clean.length < 200) return false;
  return true;
}

/** R1 a veces enumera 10+ veces el mismo título de fuente sin aportar razas/hechos. */
function isRepetitivePad(text: string): boolean {
  const boldTitles = [...text.matchAll(/\*\*([^*]{3,80})\*\*/g)].map((m) => m[1].toLowerCase().trim());
  if (boldTitles.length < 5) return false;
  const counts = new Map<string, number>();
  for (const title of boldTitles) {
    counts.set(title, (counts.get(title) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  return max >= 4 && max / boldTitles.length >= 0.45;
}
