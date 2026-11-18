import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument } from "@/lib/rag/types";
import type { Lesson } from "@/lib/lessons";

type ToolResult = { applicable: boolean; answer: string; notes: string };

const KNOWN: Array<{ match: RegExp; title: string; body: string }> = [
  {
    match: /metodolog[ií]a\s+de\s+(?:la\s+)?investigaci[oó]n|metodolog[ií]a\s+investigativa/,
    title: "Metodología de investigación",
    body: [
      "Es el **conjunto de criterios, pasos y técnicas** que usas para plantear un problema, recoger información, analizarla y llegar a conclusiones de forma ordenada y comprobable.",
      "",
      "Incluye problema, objetivos, enfoque, diseño, población/muestra, técnicas, análisis, ética y límites.",
    ].join("\n"),
  },
  {
    match: /investigaci[oó]n\s+cient[ií]fica/,
    title: "Investigación científica",
    body: [
      "Es un proceso **sistemático** para producir conocimiento confiable: pregunta, revisión, método, datos y contraste con la evidencia.",
    ].join("\n"),
  },
  {
    match: /\bhip[oó]tesis\b/,
    title: "Hipótesis",
    body: [
      "Es una **respuesta provisional** a la pregunta de investigación, formulada de modo que se pueda poner a prueba con datos.",
    ].join("\n"),
  },
  {
    match: /agua\s+hierve|ebullici[oó]n.*bogot|bogot.*ebullici[oó]n|hierve.*altitud|altitud.*hierve/,
    title: "Por qué el agua hierve a menor temperatura en Bogotá",
    body: [
      "Porque **la presión atmosférica baja con la altitud**. A menor presión, el agua alcanza el punto de ebullición con menos calor.",
      "",
      "A nivel del mar hierve cerca de **100 °C**. En Bogotá (unos 2.600 m) suele hervir alrededor de **90–92 °C**.",
    ].join("\n"),
  },
];

export async function researchBrief(
  input: string,
  options?: { documents?: RagDocument[]; lessons?: Lesson[] },
): Promise<ToolResult> {
  const question = input.trim().replace(/\s+/g, " ");
  if (question.length < 3) {
    return {
      applicable: false,
      answer:
        "Escribe la pregunta. Uso RAG sobre tus documentos y bases verificables (Wikipedia, Wikidata, OpenAlex, Crossref, Europe PMC, Open Library).",
      notes: "",
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

  if (known && !rag.hits.length) {
    return {
      applicable: true,
      answer: [`**${known.title}**`, "", known.body].join("\n"),
      notes: `${known.title}: explicación del taller.`,
    };
  }

  if (rag.hits.length) {
    const lead = known ? [`**${known.title}**`, "", known.body, ""].join("\n") : "";
    const answer = [
      `**Pregunta:** ${question}`,
      "",
      lead,
      "Respuesta con **RAG** (recuperación + generación local):",
      "",
      rag.answerBlock,
      "",
      "_Los fragmentos se eligieron por similitud TF-IDF/coseno sobre el índice. Revisa siempre el enlace o la fuente._",
    ].join("\n");
    return {
      applicable: true,
      answer,
      notes: rag.promptBlock.slice(0, 4000),
    };
  }

  return {
    applicable: false,
    answer: [
      `No recuperé fragmentos útiles para «${question}».`,
      "",
      "Prueba a reformular, o carga un apunte en **Conocimiento RAG** para indexarlo.",
    ].join("\n"),
    notes: "",
  };
}
