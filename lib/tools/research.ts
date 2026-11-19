import { sourcesFromHits, type CitationImage, type CitationSource } from "@/lib/rag/citations";
import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument, RagHit } from "@/lib/rag/types";
import type { Lesson } from "@/lib/lessons";
import { detectAnswerStyle } from "@/lib/style";
import { rewriteAnswerStyle } from "@/lib/style-rewrite";
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
  {
    match: /^(qu[eé]\s+es\s+(una?\s+)?)?perreras?\b|\bperrera\b/,
    title: "Perrera",
    body: [
      "Una perrera es un lugar o instalación destinada a alojar perros, ya sea como refugio o albergue de animales, o como una caseta, jaula o transportín para mascotas.",
      "",
      "**Significados y usos principales**",
      "",
      "- **Refugio o albergue:** espacio donde se alojan, cuidan o recogen perros, especialmente abandonados o sin hogar.",
      "- **Caseta, jaula o guacal:** estructura o transportín para resguardar o trasladar a un perro en casa, exteriores o viaje.",
      "- **Vehículo de recogida:** en algunos contextos, el furgón o vehículo destinado a recoger perros.",
      "- **Usos coloquiales:** según la RAE, también puede referirse a un mal pagador o a una rabieta infantil.",
      "",
      "**Ejemplos de uso**",
      "",
      '- "Llevamos al perro en su perrera al veterinario."',
      '- "Construimos una perrera con techo en el patio para que tenga sombra."',
      '- "El albergue municipal funciona como refugio para perros rescatados."',
      "",
      "**Sinónimos y términos relacionados**",
      "",
      "- De alojamiento: albergue, refugio animal, canil, jaula.",
      "- De transporte o caseta: guacal, transportín, caseta para perro, recinto.",
    ].join("\n"),
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
  // Borrador anclado a fuentes (sin pasar por R1: más rápido y sin alucinaciones).
  const answer =
    style === "corto" || style === "natural" ? rewriteAnswerStyle(draft, style) : draft;

  return {
    applicable: true,
    answer,
    images: rag.images,
    sources,
    notes: "",
  };
}

/** Borrador informativo a partir de hits reales (evita alucinaciones del 1.5B). */
export function buildResearchDraft(
  question: string,
  hits: RagHit[],
  known?: { title: string; body: string },
): string {
  if (known || looksLikeDefinitionQuery(question)) {
    const definition = buildDefinitionDraft(question, hits, known);
    if (definition) return definition;
  }

  const heading = cleanQuestionHeading(question);
  const sections: string[] = heading ? [`**${heading}**`, ""] : [];

  const queryTerms = tokenizeQuery(question);
  const useful = hits
    .filter((hit) => hitLooksRelevant(hit, queryTerms))
    .map((hit) => ({
      title: cleanHitTitle(hit.chunk.title, hit.chunk.source),
      text: cleanHitText(hit.chunk.text),
    }))
    .filter((item) => item.text.length > 40 && !/^[a-záéíóúüñ]\s/.test(item.text.trim()))
    .slice(0, 6);

  if (useful.length) {
    sections.push("**Qué dicen las fuentes**", "");
    for (const item of useful) {
      sections.push(`- **${item.title}:** ${item.text}`);
    }
    sections.push("");
  }

  if (!useful.length) return "";

  sections.push(
    "**En resumen**",
    "",
    "Conviene contrastar los puntos anteriores con las fuentes enlazadas al final.",
  );

  return sections.join("\n");
}

/** Respuestas tipo diccionario: definición, significados, ejemplos y sinónimos. */
export function buildDefinitionDraft(
  question: string,
  hits: RagHit[],
  known?: { title: string; body: string },
): string {
  const term = extractTerm(question);
  const heading = known?.title || (term ? term.charAt(0).toUpperCase() + term.slice(1) : cleanQuestionHeading(question));
  if (!heading) return "";

  if (known?.body) {
    return [`**${heading}**`, "", known.body].join("\n");
  }

  const relevantHits = hits.filter((hit) => hitMentionsTerm(hit, term));
  const sentences = relevantHits
    .flatMap((hit) => splitUsefulSentences(cleanHitText(hit.chunk.text)))
    .filter((sentence) => isUsableDefinitionSentence(sentence, term));
  const unique = dedupeSentences(sentences).slice(0, 8);
  if (!unique.length) return "";

  const lead =
    unique.find((sentence) =>
      new RegExp(`\\b${escapeRegExp(term)}\\b.{0,40}\\b(es|son|designa|significa|se\\s+refiere)\\b`, "i").test(
        sentence,
      ),
    ) ||
    unique.find((sentence) => /\bes\s+un[a]?\b|\bse\s+trata\s+de\b|\bsignifica\b/i.test(sentence)) ||
    unique[0];
  const meanings = unique.filter((sentence) => sentence !== lead).slice(0, 4);
  const examples = unique
    .filter((sentence) => /[«"“]/.test(sentence) || /\bejemplo\b/i.test(sentence))
    .slice(0, 3);

  const sections = [
    `**${heading}**`,
    "",
    lead,
    "",
    "**Significados y usos principales**",
    "",
    ...(meanings.length ? meanings.map((sentence) => `- ${sentence}`) : [`- ${lead}`]),
  ];

  if (examples.length) {
    sections.push("", "**Ejemplos de uso**", "", ...examples.map((sentence) => `- ${sentence}`));
  }

  sections.push(
    "",
    "**En resumen**",
    "",
    `«${heading}» se entiende sobre todo a partir de las fuentes recuperadas; revisa los enlaces al final para ampliar.`,
  );

  return sections.join("\n");
}

export function looksLikeDefinitionQuery(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (/^(qu[eé]\s+es|significado\s+de|define|definici[oó]n\s+de|qu[eé]\s+significa)\b/i.test(q)) {
    return true;
  }
  // Una sola palabra o término corto (p. ej. «Perrera», «fotosíntesis»).
  const words = q.split(/\s+/);
  return words.length === 1 && q.length <= 28 && !/[¿?]/.test(q);
}

function extractTerm(question: string): string {
  const cleaned = question
    .replace(/^(qu[eé]\s+es\s+(una?\s+)?|significado\s+de\s+|definici[oó]n\s+de\s+|define\s+|qu[eé]\s+significa\s+)/i, "")
    .replace(/[¿?¡!.,;:]+/g, "")
    .trim();
  return cleaned.split(/\s+/).slice(0, 4).join(" ");
}

function splitUsefulSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isUsableDefinitionSentence(sentence: string, term: string): boolean {
  if (sentence.length < 40) return false;
  if (isDictionaryNoise(sentence)) return false;
  if (isTruncatedSentence(sentence)) return false;
  if (!sentenceMentionsTerm(sentence, term)) return false;
  return true;
}

function isTruncatedSentence(sentence: string): boolean {
  const text = sentence.trim();
  // Empieza a mitad de palabra: "n su territorio…"
  if (/^[a-záéíóúüñ]\s/.test(text)) return true;
  // Las definiciones útiles suelen empezar en mayúscula o comilla.
  if (!/^[A-ZÁÉÍÓÚÜÑ¿¡«"“0-9]/.test(text)) return true;
  // Corte típico de scrapes al final.
  if (/\b(el|la|los|las|de|del|con|para|y|o|un|una)\s*$/i.test(text) && text.length < 120) {
    return true;
  }
  return false;
}

function sentenceMentionsTerm(sentence: string, term: string): boolean {
  const t = normalizeText(term);
  if (t.length < 3) return false;
  const s = normalizeText(sentence);
  if (s.includes(t)) return true;
  const stem = t.replace(/(ciones|cion|ades|osos|osas|ares|eres|as|os|es|a|o|s)$/i, "");
  return stem.length >= 4 && s.includes(stem);
}

function hitMentionsTerm(hit: RagHit, term: string): boolean {
  const blob = `${hit.chunk.title} ${hit.chunk.text}`;
  return sentenceMentionsTerm(blob, term);
}

function tokenizeQuery(question: string): string[] {
  return normalizeText(question)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9áéíóúüñ]/gi, ""))
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token));
}

function hitLooksRelevant(hit: RagHit, terms: string[]): boolean {
  if (!terms.length) return true;
  const blob = normalizeText(`${hit.chunk.title} ${hit.chunk.text}`);
  const matched = terms.filter((term) => {
    if (blob.includes(term)) return true;
    const stem = term.replace(/(ciones|cion|ades|osos|osas|ares|eres|as|os|es|a|o|s)$/i, "");
    return stem.length >= 4 && blob.includes(stem);
  }).length;
  // Con varias palabras basta 1 coincidencia fuerte; evita tirar fuentes útiles.
  return matched >= 1;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STOP_WORDS = new Set([
  "que",
  "qué",
  "es",
  "una",
  "uno",
  "unos",
  "unas",
  "los",
  "las",
  "del",
  "con",
  "por",
  "para",
  "como",
  "sobre",
  "entre",
  "desde",
  "donde",
  "cual",
  "cuales",
  "este",
  "esta",
  "estos",
  "estas",
  "tiene",
  "tienen",
  "hay",
  "the",
  "and",
  "for",
]);

function isDictionaryNoise(sentence: string): boolean {
  return (
    /spanish\s+to\s+english|spanishdictionary|learn the meaning|pronunciation|injuries\.|conjugate|translation\s+-|©|all rights/i.test(
      sentence,
    ) || /^[-–—(]\s*/.test(sentence)
  );
}

function dedupeSentences(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
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
    .replace(/\|\s*Spanish to English Translation[^.]*/gi, " ")
    .replace(/SpanishDictionary\.com[^.]*/gi, " ")
    .replace(/Learn the meaning and usage of[^.]*/gi, " ")
    .replace(/\binjuries\b/gi, " ")
    .replace(/\([^)]{0,40}\)\s*[-–—]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
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
