import { ollamaAvailable, ollamaChat } from "@/lib/ollama";
import type { CitationImage, CitationSource } from "@/lib/rag/citations";
import type { RagHit } from "@/lib/rag/types";

export type OverviewItem = {
  title: string;
  text: string;
  imageUrl?: string;
};

export type OverviewDraft = {
  lead: string;
  sectionTitle?: string;
  items: OverviewItem[];
};

export type ContextSnippet = {
  title: string;
  text: string;
  url?: string;
};

const ROWS_RE = /:::taller-rows\n([\s\S]*?)\n:::/;

/** Limpia y deduplica hits para usarlos solo como contexto interno. */
export function prepareContextSnippets(hits: RagHit[], limit = 8): ContextSnippet[] {
  const seen = new Set<string>();
  const out: ContextSnippet[] = [];
  for (const hit of hits) {
    const title = scrubTitle(hit.chunk.title || hit.chunk.source || "Fuente");
    const text = scrubSnippet(hit.chunk.text || "");
    if (!text || !isCleanContextSnippet(text)) continue;
    const key = normalizeKey(text).slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    const url = extractHttpUrl(hit.chunk.source || "");
    out.push({ title, text: text.slice(0, 280), url });
    if (out.length >= limit) break;
  }
  return out;
}

export function cleanCitationSources(sources: CitationSource[]): CitationSource[] {
  const seen = new Set<string>();
  const out: CitationSource[] = [];
  for (const source of sources) {
    const title = scrubTitle(source.title || "");
    const url = source.url?.startsWith("http") ? source.url.trim() : "";
    if (!title || isInternalLearningTitle(title)) continue;
    if (isEnglishHeavyLocal(title) && !/colombia|bogot|unad|ciudad|casa|perrera/i.test(title)) continue;
    const key = `${normalizeKey(title)}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title.slice(0, 120), url });
    if (out.length >= 8) break;
  }
  return out;
}

export function sourceDomain(url: string): string {
  if (!url?.startsWith("http")) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function formatOverviewMarkdown(
  draft: OverviewDraft,
  options?: { rows?: boolean },
): string {
  const parts: string[] = [draft.lead.trim()];
  if (draft.sectionTitle?.trim()) {
    parts.push("", `**${draft.sectionTitle.trim()}**`, "");
  } else if (draft.items.length) {
    parts.push("");
  }
  if (options?.rows && draft.items.some((item) => item.imageUrl)) {
    const lines = draft.items.slice(0, 6).map((item) => {
      const title = item.title.replace(/[|\n]/g, " ").slice(0, 80);
      const text = item.text.replace(/[|\n]/g, " ").slice(0, 180);
      const image = item.imageUrl?.startsWith("http") ? item.imageUrl : "";
      return `${title}|${image}|${text}`;
    });
    parts.push(`:::taller-rows\n${lines.join("\n")}\n:::`);
  } else {
    for (const item of draft.items.slice(0, 6)) {
      parts.push(`- **${item.title}:** ${item.text}`);
    }
  }
  return parts.join("\n").trim();
}

export function encodeOverviewRows(items: OverviewItem[]): string {
  const lines = items
    .slice(0, 6)
    .map((item) => {
      const title = item.title.replace(/[|\n]/g, " ").slice(0, 80);
      const text = item.text.replace(/[|\n]/g, " ").slice(0, 180);
      const image = item.imageUrl?.startsWith("http") ? item.imageUrl : "";
      return `${title}|${image}|${text}`;
    });
  if (!lines.length) return "";
  return `:::taller-rows\n${lines.join("\n")}\n:::`;
}

export function stripOverviewRows(text: string): {
  content: string;
  items: OverviewItem[];
} {
  const match = ROWS_RE.exec(text);
  if (!match) return { content: text, items: [] };
  const items: OverviewItem[] = [];
  for (const line of match[1].split("\n")) {
    const [title, imageUrl, ...rest] = line.split("|");
    if (!title?.trim() || !rest.length) continue;
    items.push({
      title: title.trim(),
      text: rest.join("|").trim(),
      imageUrl: imageUrl?.startsWith("http") ? imageUrl.trim() : undefined,
    });
  }
  return {
    content: text.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim(),
    items,
  };
}

/** Fallback rápido con el mismo formato overview (sin pegar scrapes). */
export function buildOverviewFallback(options: {
  question: string;
  snippets: ContextSnippet[];
  known?: { title: string; body: string };
  images?: CitationImage[];
}): OverviewDraft | null {
  const { question, snippets, known, images = [] } = options;
  if (known?.body) {
    return overviewFromKnown(known, images);
  }

  let items = extractOverviewItems(question, snippets, images);
  if (/contrase[nñ]a.*unad|unad.*contrase[nñ]a|campus\s+unad/i.test(question)) {
    items = unadRecoveryItems();
  }
  const lead = buildDirectLead(question, snippets, items);
  if (!lead) return null;

  // Para preguntas abiertas sin ítems, aún devolvemos la respuesta directa.
  const sectionTitle = items.length ? suggestSectionTitle(question, items) : undefined;
  return {
    lead,
    sectionTitle,
    items: items.slice(0, 6),
  };
}

export function looksLikeCleanOverview(text: string): boolean {
  const clean = text.trim();
  if (clean.length < 40) return false;
  if (/Qué dicen las fuentes|Hechos clave|Aprendizaje web|Conviene contrastar/i.test(clean)) {
    return false;
  }
  if (/##|\b\d{1,2}:\d{2}\b|Spanish word for|authoritative tra|See \d+ authoritative/i.test(clean)) {
    return false;
  }
  if (/^[a-záéíóúüñ]{2,}\./m.test(clean)) return false; // "peciales."
  const hasList = /^- \*\*[^*]+:\*\*/m.test(clean) || ROWS_RE.test(clean);
  const sentences = clean.split(/(?<=[.!?…])\s+/).filter((s) => s.trim().length > 20);
  return hasList || sentences.length >= 1;
}

export async function redactOverviewAnswer(options: {
  question: string;
  snippets: ContextSnippet[];
  known?: { title: string; body: string };
  images?: CitationImage[];
  timeoutMs?: number;
}): Promise<{ ok: boolean; draft: OverviewDraft | null; raw?: string; error?: string }> {
  const fallback = buildOverviewFallback(options);
  const contextNotes = [
    options.known ? `Nota confiable:\n${options.known.title}\n${options.known.body}` : "",
    options.snippets.length
      ? `Fragmentos limpios (solo contexto; no copies literal):\n${options.snippets
          .map((s, i) => `[${i + 1}] ${s.title}: ${s.text}`)
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2200);

  if (!contextNotes && !fallback) {
    return { ok: false, draft: null, error: "sin contexto" };
  }

  // Si Ollama no responde rápido, usa el fallback overview (mismo formato).
  const skipModel =
    process.env.TALLER_SKIP_OLLAMA === "1" ||
    process.env.LUMEN_SKIP_OLLAMA === "1" ||
    !(await ollamaAvailable(AbortSignal.timeout(1_500)));
  if (skipModel) {
    return { ok: false, draft: fallback, error: "ollama no disponible; fallback overview" };
  }

  const drafted = await ollamaChat({
    languageMode: "spanish",
    keepAlive: "5m",
    timeoutMs: options.timeoutMs ?? 28_000,
    think: false,
    numPredict: 320,
    numCtx: 1536,
    system: [
      "Eres Lumen en modo Investigar, estilo resumen tipo Google AI Overview.",
      "Responde SIEMPRE en español neutro colombiano.",
      "Plantilla OBLIGATORIA:",
      "1) Primero 1 o 2 frases que respondan DIRECTO a la pregunta.",
      "2) Luego un subtítulo en negrita (**...**) si hace falta una lista.",
      "3) Luego 3 a 6 viñetas con el formato exacto: - **Nombre:** frase corta propia.",
      "No copies texto literal de las notas. Reescribe con tus palabras.",
      "No inventes datos, URLs ni cifras. Si no hay información confiable, di exactamente: No encontré información confiable para responder con seguridad.",
      "Prohibido: pegar scrapes, 'Qué dicen las fuentes', 'Hechos clave', marcas ##, horas, inglés, fragmentos cortados.",
      "Si la consulta es abierta o no indica otro país, prioriza ejemplos de Colombia.",
      "No agregues bloque de fuentes en el texto; las fuentes van aparte.",
    ].join("\n"),
    prompt: [
      `Pregunta: ${options.question}`,
      "",
      contextNotes || "(sin notas; usa solo conocimiento mínimo si es trivial, o di que no hay información confiable)",
      "",
      "Escribe la respuesta final con la plantilla:",
    ].join("\n"),
  });

  if (!drafted.ok || !drafted.text.trim()) {
    return { ok: false, draft: fallback, error: drafted.error };
  }

  const parsed = parseOverviewFromModel(drafted.text, options.images ?? []);
  if (!parsed || !looksLikeCleanOverview(formatOverviewMarkdown(parsed))) {
    return { ok: false, draft: fallback, raw: drafted.text, error: "formato inválido" };
  }
  return { ok: true, draft: parsed, raw: drafted.text };
}

function parseOverviewFromModel(raw: string, images: CitationImage[]): OverviewDraft | null {
  const text = scrubSnippet(raw)
    .replace(/_Herramienta:[^_\n]*_/g, "")
    .replace(/<\/?think>/gi, "")
    .trim();
  if (!text || /no encontr[eé] informaci[oó]n confiable/i.test(text)) {
    return {
      lead: "No encontré información confiable para responder con seguridad.",
      items: [],
    };
  }
  if (!looksLikeCleanOverview(text)) return null;

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*]\s+\*\*/.test(l));
  const nonBullets = lines.filter((l) => !/^[-*]\s+/.test(l) && !/^\*\*[^*]+\*\*$/.test(l));
  const section = lines.find((l) => /^\*\*[^*]+\*\*$/.test(l))?.replace(/\*\*/g, "") || undefined;
  const lead = nonBullets.slice(0, 2).join(" ") || nonBullets[0] || text.split(/\n/)[0] || "";

  const items: OverviewItem[] = [];
  for (const bullet of bullets.slice(0, 6)) {
    const match = /^[-*]\s+\*\*([^*]+?):\*\*\s*(.+)$/.exec(bullet) || /^[-*]\s+\*\*([^*]+)\*\*:?\s*(.+)$/.exec(bullet);
    if (!match) continue;
    items.push({
      title: match[1].trim().replace(/:$/, ""),
      text: match[2].trim(),
      imageUrl: matchImage(match[1], images),
    });
  }

  const cleanLead = lead.replace(/^#+\s*/, "").trim();
  if (!cleanLead) return null;
  return {
    lead: cleanLead,
    sectionTitle: section,
    items,
  };
}

function overviewFromKnown(
  known: { title: string; body: string },
  images: CitationImage[],
): OverviewDraft {
  const lines = known.body.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith("- "));
  const prose = lines.filter((l) => !l.startsWith("- ") && !l.startsWith("**"));
  const lead = prose[0] || `${known.title}: definición breve a partir de referencias locales.`;
  const items: OverviewItem[] = [];
  for (const bullet of bullets) {
    const body = bullet.replace(/^[-*]\s+/, "");
    const named = /^\*\*([^*]+?):\*\*\s*(.+)$/.exec(body) || /^\*\*([^*]+)\*\*:?\s*(.+)$/.exec(body);
    if (named) {
      items.push({
        title: named[1].trim().replace(/:$/, ""),
        text: named[2].replace(/^["“]|["”]$/g, "").trim(),
        imageUrl: matchImage(named[1], images),
      });
    }
    if (items.length >= 6) break;
  }
  const section = lines.find((l) => /^\*\*[^*]+\*\*$/.test(l))?.replace(/\*\*/g, "");
  const sectionTitle =
    section && !/sin[oó]nimos|ejemplos de uso/i.test(section)
      ? section
      : items.length
        ? "Puntos clave"
        : undefined;
  return {
    lead: lead.replace(/\*\*/g, "").slice(0, 280),
    sectionTitle,
    items: items.slice(0, 6),
  };
}

function extractOverviewItems(
  question: string,
  snippets: ContextSnippet[],
  images: CitationImage[],
): OverviewItem[] {
  const items: OverviewItem[] = [];
  const seen = new Set<string>();

  for (const snippet of snippets) {
    const named = extractNamedFacts(snippet.text);
    for (const fact of named) {
      const key = normalizeKey(fact.title);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        title: fact.title,
        text: fact.text,
        imageUrl: matchImage(fact.title, images),
      });
      if (items.length >= 6) return preferColombia(question, items);
    }
  }

  // Si no hay nombres claros, convierte snippets en ítems cortos reescritos.
  for (const snippet of snippets) {
    const title = shortenTitle(snippet.title);
    const key = normalizeKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const sentence = firstSentence(snippet.text);
    if (!sentence || sentence.length < 28) continue;
    items.push({
      title,
      text: rewriteSnippetShort(sentence),
      imageUrl: matchImage(title, images),
    });
    if (items.length >= 6) break;
  }
  return preferColombia(question, items);
}

function extractNamedFacts(text: string): Array<{ title: string; text: string }> {
  const out: Array<{ title: string; text: string }> = [];
  const patterns = [
    /\b([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+(?:\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+)?)\s+(?:es|está|fue|sirve|funciona|significa)\s+([^.]{20,140})\./g,
    /\b([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+),\s+(oficialmente|capital|conocida|reconocida)([^.]{10,120})\./gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const title = match[1].trim();
      if (title.length < 3 || /Ciudad|Hechos|Aprendizaje|Wikipedia|Spanish/i.test(title)) continue;
      const rest = `${match[2] || ""}${match[3] || ""}`.replace(/\s+/g, " ").trim();
      const sentence = rest.endsWith(".") ? rest : `${rest}.`;
      out.push({ title, text: sentence.charAt(0).toUpperCase() + sentence.slice(1) });
    }
  }
  return out;
}

function buildDirectLead(
  question: string,
  snippets: ContextSnippet[],
  items: OverviewItem[],
): string {
  const q = question.trim();
  if (/^capital\s+de\s+colombia\b/i.test(q) || /capital\s+de\s+colombia/i.test(q)) {
    return "La capital de Colombia es **Bogotá**, Distrito Capital, centro administrativo y sede del gobierno nacional.";
  }
  if (/\bejemplos?\s+de\b/i.test(q) && items.length >= 2) {
    const a = items[0];
    const b = items[1];
    return `Un ejemplo claro es **${a.title}**, ${stripTrailingDot(a.text).toLowerCase()}, o **${b.title}**, ${stripTrailingDot(b.text).toLowerCase()}.`;
  }
  if (/^qu[eé]\s+es\b|significado|definici[oó]n/i.test(q)) {
    const definitional = snippets
      .map((snippet) => firstSentence(snippet.text))
      .find(
        (sentence) =>
          sentence &&
          !isOverviewJunk(sentence) &&
          /\b(es|son|significa|se\s+refiere|designa)\b/i.test(sentence),
      );
    if (definitional) return rewriteSnippetShort(definitional);
    if (/ciudad/i.test(q)) {
      return "Una **ciudad** es un asentamiento urbano con mucha población, servicios y gobierno local, mayor que un pueblo.";
    }
  }
  if (/c[oó]mo\s+recuperar|contrase[nñ]a.*unad|unad.*contrase[nñ]a/i.test(q)) {
    return "Para recuperar la contraseña del campus UNAD, entra al formulario oficial de recuperación, elige tu tipo de documento e ingresa el número; te enviarán un correo con el enlace para restablecerla.";
  }
  if (items[0] && items[0].text.length > 24) {
    return `**${items[0].title}:** ${items[0].text}`;
  }
  if (snippets[0]) {
    const sentence = firstSentence(snippets[0].text);
    if (sentence && !isOverviewJunk(sentence)) return rewriteSnippetShort(sentence);
  }
  return "";
}

function suggestSectionTitle(question: string, items: OverviewItem[]): string | undefined {
  if (!items.length) return undefined;
  if (/\bejemplos?\s+de\b/i.test(question)) {
    if (/ciudad/i.test(question)) return "Ejemplos de ciudades en Colombia";
    return `Ejemplos: ${question.replace(/^ejemplos?\s+de\s+/i, "").trim()}`;
  }
  if (/^qu[eé]\s+es\b|significado|definici[oó]n/i.test(question)) {
    return "Puntos clave";
  }
  if (/c[oó]mo\b|recuperar|contrase[nñ]a/i.test(question)) {
    return "Pasos útiles";
  }
  return "Lo esencial";
}

function unadRecoveryItems(): OverviewItem[] {
  return [
    {
      title: "Formulario UNAD",
      text: "Abre la página de recuperar contraseña del campus virtual.",
    },
    {
      title: "Documento",
      text: "Selecciona el tipo e ingresa solo el número de identificación.",
    },
    {
      title: "Correo",
      text: "Revisa el correo asociado: llegará un enlace para crear la nueva clave.",
    },
  ];
}

function preferColombia(question: string, items: OverviewItem[]): OverviewItem[] {
  const wantsColombia =
    /colombia|bogot|medell|cali|barranquilla|cartagena/i.test(question) ||
    /\bejemplos?\s+de\s+(una?\s+)?ciudad/i.test(question);
  if (!wantsColombia) return items;
  const col = items.filter((item) =>
    /bogot|medell|cali|barranquilla|cartagena|colombia|cundinamarca|antioquia/i.test(
      `${item.title} ${item.text}`,
    ),
  );
  if (col.length >= 2) {
    const rest = items.filter((item) => !col.includes(item));
    return [...col, ...rest].slice(0, 6);
  }
  // Refuerzo mínimo para ejemplos de ciudad cuando el scrape no trae Colombia.
  if (/\bejemplos?\s+de\s+(una?\s+)?ciudad/i.test(question)) {
    const seeded: OverviewItem[] = [
      {
        title: "Bogotá",
        text: "capital del país y centro cultural, económico y administrativo.",
        imageUrl: items[0]?.imageUrl,
      },
      {
        title: "Medellín",
        text: "reconocida por su transformación urbana y su sistema de transporte integrado.",
        imageUrl: items[1]?.imageUrl,
      },
      {
        title: "Cali",
        text: "ciudad del suroccidente colombiano conocida como la capital de la salsa.",
        imageUrl: items[2]?.imageUrl,
      },
    ];
    return seeded;
  }
  return items;
}

function matchImage(title: string, images: CitationImage[]): string | undefined {
  if (!images.length) return undefined;
  const key = normalizeKey(title).slice(0, 12);
  const hit = images.find((image) => normalizeKey(image.title || "").includes(key));
  return (hit || images[0])?.url;
}

function rewriteSnippetShort(sentence: string): string {
  return sentence
    .replace(/\([^)]{0,80}\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[a-záéíóúüñ]+\.\s*/i, "")
    .slice(0, 180);
}

function firstSentence(text: string): string {
  const parts = text.split(/(?<=[.!?…])\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => p.length >= 28) || parts[0] || text.trim();
}

function shortenTitle(title: string): string {
  return scrubTitle(title)
    .replace(/^Recuperar contrase[nñ]a\s*-?\s*/i, "Recuperar contraseña")
    .slice(0, 48);
}

function scrubTitle(title: string): string {
  return title
    .replace(/\bAprendizaje(?:\s+web)?:\s*/gi, "")
    .replace(/^Web\s*·\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export function scrubSnippet(raw: string): string {
  return raw
    .replace(/#+/g, " ")
    .replace(/\bAprendizaje(?:\s+web)?:\s*/gi, "")
    .replace(/\bFecha\s*\([^)]*\):\s*/gi, "")
    .replace(/\bHechos clave\b[:\s]*/gi, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\|\s*Spanish to English Translation[^.]*/gi, " ")
    .replace(/SpanishDictionary\.com[^.]*/gi, " ")
    .replace(/\bSpanish word for\b[^.]*/gi, " ")
    .replace(/\bSee \d+ authoritative\b[^.]*/gi, " ")
    .replace(/\bpeciales\b/gi, " ")
    .replace(/^\s*[-–—(•*]+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCleanContextSnippet(text: string): boolean {
  const clean = text.trim();
  if (clean.length < 40) return false;
  if (/^[a-záéíóúüñ]\s/.test(clean)) return false;
  if (isOverviewJunk(clean)) return false;
  if (/\b(el|la|los|las|de|del|con|para|y|o|un|una|que|qu)\s*$/i.test(clean)) return false;
  if (/[a-záéíóúüñ]{1,3}$/i.test(clean) && !/[.!?…»”"]$/.test(clean) && clean.length >= 180) {
    return false;
  }
  if (
    /\b(en este art[ií]culo|exploraremos|descubre qu[eé]|haz clic|leer m[aá]s|sigue leyendo|invit[aá]ndote)\b/i.test(
      clean,
    )
  ) {
    return false;
  }
  return true;
}

export function isOverviewJunk(text: string): boolean {
  if (/Hechos clave|Aprendizaje web|Qué dicen las fuentes/i.test(text)) return true;
  if (/Spanish word for|authoritative tra|Municipality|TOPSpro/i.test(text)) return true;
  if (/especiales\.|peciales\./i.test(text)) return true;
  if (/\b(noticias|actualidad|ciudad radio|puertollano|vídeos y ciudad)\b/i.test(text)) return true;
  if (isEnglishHeavyLocal(text)) return true;
  return false;
}

function isEnglishHeavyLocal(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-záéíóúüñ'\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 6) return false;
  const markers = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "are",
    "of",
    "in",
    "to",
    "provides",
    "municipality",
    "because",
    "authoritative",
    "spanish",
    "word",
  ]);
  const english = words.filter((word) => markers.has(word)).length;
  return english >= 3;
}

function isInternalLearningTitle(title: string): boolean {
  return /^(Aprendizaje|Web\s*·)/i.test(title.trim());
}

function extractHttpUrl(value: string): string | undefined {
  const match = value.match(/https?:\/\/\S+/);
  return match?.[0];
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingDot(value: string): string {
  return value.replace(/[.]+$/, "").trim();
}
