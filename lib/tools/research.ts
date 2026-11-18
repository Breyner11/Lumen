import { formatMultiSourceAnswer, gatherSources } from "@/lib/tools/sources";

type ToolResult = { applicable: boolean; answer: string; notes: string };

/** Known short explanations for frequent school/university questions. */
const KNOWN: Array<{ match: RegExp; title: string; body: string }> = [
  {
    match: /metodolog[ií]a\s+de\s+(?:la\s+)?investigaci[oó]n|metodolog[ií]a\s+investigativa/,
    title: "Metodología de investigación",
    body: [
      "Es el **conjunto de criterios, pasos y técnicas** que usas para plantear un problema, recoger información, analizarla y llegar a conclusiones de forma ordenada y comprobable.",
      "",
      "No es solo “el método” suelto: es la justificación de **por qué** eliges un enfoque (cualitativo, cuantitativo o mixto), **cómo** vas a obtener datos (encuestas, entrevistas, observación, documentos, experimentos) y **con qué reglas** vas a interpretarlos.",
      "",
      "**Partes habituales:** problema, objetivos, enfoque, diseño, población/muestra, técnicas, análisis, ética y límites.",
    ].join("\n"),
  },
  {
    match: /investigaci[oó]n\s+cient[ií]fica/,
    title: "Investigación científica",
    body: [
      "Es un proceso **sistemático** para producir conocimiento confiable: se parte de una pregunta, se revisa lo ya sabido, se elige un método, se recogen datos y se contrastan las conclusiones con la evidencia.",
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
    match: /\bvariable(?:s)?\b.*investig|\binvestig.*\bvariable/,
    title: "Variables en investigación",
    body: [
      "Una **variable** es una característica que puede cambiar y que mides o describes en el estudio (edad, nota, motivación, temperatura).",
      "",
      "En diseños con causa y efecto suele hablarse de variable **independiente** y **dependiente**.",
    ].join("\n"),
  },
  {
    match: /agua\s+hierve|ebullici[oó]n.*bogot|bogot.*ebullici[oó]n|hierve.*altitud|altitud.*hierve/,
    title: "Por qué el agua hierve a menor temperatura en Bogotá",
    body: [
      "Porque **la presión atmosférica baja con la altitud**. A menor presión, el agua alcanza el punto de ebullición con menos calor.",
      "",
      "A nivel del mar hierve cerca de **100 °C**. En Bogotá (unos 2.600 m) suele hervir alrededor de **90–92 °C**, según la presión del día.",
    ].join("\n"),
  },
];

export async function researchBrief(input: string): Promise<ToolResult> {
  const question = input.trim().replace(/\s+/g, " ");
  if (question.length < 3) {
    return {
      applicable: false,
      answer:
        "Escribe la pregunta. Consulto Wikipedia, Wikidata, OpenAlex, Crossref, Europe PMC y Open Library, y te dejo solo lo que tenga enlace verificable.",
      notes: "",
    };
  }

  const lower = question.toLowerCase();
  const known = KNOWN.find((item) => item.match.test(lower));
  const hits = await gatherSources(question);

  if (known) {
    const lead = [`**${known.title}**`, "", known.body].join("\n");
    if (hits.length) {
      return {
        applicable: true,
        answer: formatMultiSourceAnswer(question, hits, lead),
        notes: `Taller + ${[...new Set(hits.map((hit) => hit.source))].join(", ")}`,
      };
    }
    return {
      applicable: true,
      answer: [`**Pregunta:** ${question}`, "", lead].join("\n"),
      notes: `${known.title}: explicación del taller.`,
    };
  }

  if (hits.length) {
    return {
      applicable: true,
      answer: formatMultiSourceAnswer(question, hits),
      notes: `Fuentes: ${[...new Set(hits.map((hit) => hit.source))].join(", ")}`,
    };
  }

  return {
    applicable: false,
    answer: [
      `No hallé fichas verificables para «${question}».`,
      "",
      "Probé Wikipedia, Wikidata, OpenAlex, Crossref, Europe PMC y Open Library.",
      "",
      "Reformula con el nombre propio o el término exacto (por ejemplo «Gran Pirámide de Guiza»).",
    ].join("\n"),
    notes: "",
  };
}
