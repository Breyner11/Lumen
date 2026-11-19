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
export function prepareContextSnippets(
  hits: RagHit[],
  question = "",
  limit = 8,
): ContextSnippet[] {
  const terms = tokenizeQueryLocal(question);
  const ranked = [...hits].sort((a, b) => scoreHitForQuery(b, terms) - scoreHitForQuery(a, terms));
  const seen = new Set<string>();
  const out: ContextSnippet[] = [];
  for (const hit of ranked) {
    const rawTitle = hit.chunk.title || hit.chunk.source || "Fuente";
    if (isInternalLearningTitle(rawTitle) && !learningDocMatchesQuery(rawTitle, hit.chunk.text || "", terms)) {
      continue;
    }
    const title = scrubTitle(rawTitle);
    const text = scrubSnippet(hit.chunk.text || "");
    if (!text || !isCleanContextSnippet(text)) continue;
    if (isMarketingBlurb(text)) continue;
    const key = normalizeKey(text).slice(0, 100);
    if (seen.has(key)) continue;
    seen.add(key);
    const url = extractHttpUrl(hit.chunk.source || "") || extractHttpUrl(hit.chunk.text || "");
    out.push({ title, text: text.slice(0, 280), url });
    if (out.length >= limit) break;
  }
  return out;
}

export function cleanCitationSources(sources: CitationSource[]): CitationSource[] {
  const seen = new Set<string>();
  const withUrl: CitationSource[] = [];
  const withoutUrl: CitationSource[] = [];
  for (const source of sources) {
    const title = scrubTitle(source.title || "");
    const url = source.url?.startsWith("http") ? source.url.trim() : "";
    if (!title || isInternalLearningTitle(title)) continue;
    if (isEnglishHeavyLocal(title) && !/colombia|bogot|unad|ciudad|casa|perrera|fotos[ií]ntesis|imc/i.test(title)) {
      continue;
    }
    const key = `${normalizeKey(title)}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const row = { title: title.slice(0, 120), url };
    if (url) withUrl.push(row);
    else withoutUrl.push(row);
  }
  // Preferir siempre links reales.
  return [...withUrl, ...withoutUrl].slice(0, 8);
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

  const items = extractOverviewItems(question, snippets, images);
  const lead = buildDirectLead(question, snippets, items);
  if (!lead) return null;

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
  if (isModelReasoningDump(clean)) return false;
  if (/Qué dicen las fuentes|Hechos clave|Aprendizaje web|Conviene contrastar/i.test(clean)) {
    return false;
  }
  if (/##|\b\d{1,2}:\d{2}\b|Spanish word for|authoritative tra|See \d+ authoritative/i.test(clean)) {
    return false;
  }
  if (/^[a-záéíóúüñ]{2,}\./m.test(clean)) return false; // "peciales."
  if (/Te explicamos|guía definitiva|Top \d+ de/i.test(clean)) return false;
  const hasList = /^- \*\*[^*]+:\*\*/m.test(clean) || ROWS_RE.test(clean);
  if (!hasList) return false;
  const lead = clean.split(/\n\n|\n(?=\*\*)/)[0] || "";
  if (lead.length < 24) return false;
  if (/:\s*$/.test(lead) && lead.length < 80) return false; // título SEO truncado
  return true;
}

export function isModelReasoningDump(text: string): boolean {
  return /\b(I should|Wait,|seems to be|Bueno, tengo|Empezando por|The user|in the query|I need to|prioriza ejemplos de Colombia\.?\s*\[)/i.test(
    text,
  );
}

const OVERVIEW_SYSTEM = [
  "Eres Lumen. Redactas resúmenes tipo Google AI Overview.",
  "Idioma: español neutro colombiano. CERO inglés. CERO razonamiento visible.",
  "Devuelve SOLO el bloque final, empezando exactamente con la línea RESPUESTA:",
  "Plantilla tras RESPUESTA:",
  "1) 1 o 2 frases que contesten exactamente la pregunta.",
  "2) Un subtítulo **...**",
  "3) 3 a 6 viñetas con formato exacto: - **Nombre:** frase corta propia (no copies scrapes).",
  "No inventes. Si no sabes: RESPUESTA: No encontré información confiable para responder con seguridad.",
  "Prohibido: pensar en voz alta, pegar títulos SEO, 'Te explicamos', 'Qué dicen las fuentes', ##, horas, URLs inventadas.",
  "Ejemplo:",
  "RESPUESTA:",
  "La fotosíntesis es el proceso por el que las plantas fabrican alimento usando luz, agua y CO2.",
  "",
  "**Puntos clave**",
  "",
  "- **Luz:** aporta la energía para la reacción.",
  "- **Clorofila:** pigmento que captura la luz.",
  "- **Oxígeno:** se libera como subproducto.",
].join("\n");

export const OFFLINE_NOTE = "_Respondido sin internet_";
export const CONFIDENCE_NOTE_PREFIX = "_Nota de confianza:_";

export function appendOfflineFooter(answer: string, options?: { confidence?: string }): string {
  const parts = [answer.trim()];
  if (options?.confidence?.trim()) {
    parts.push("", `${CONFIDENCE_NOTE_PREFIX} ${options.confidence.trim()}`);
  }
  parts.push("", OFFLINE_NOTE);
  return parts.join("\n");
}

/** Respuesta overview solo con conocimiento del modelo (sin web ni fuentes inventadas). */
export async function redactOverviewFromKnowledge(options: {
  question: string;
  known?: { title: string; body: string };
  model?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; draft: OverviewDraft | null; raw?: string; error?: string; model?: string }> {
  if (options.known?.body) {
    return { ok: true, draft: overviewFromKnown(options.known, []) };
  }

  const skipModel =
    process.env.TALLER_SKIP_OLLAMA === "1" ||
    process.env.LUMEN_SKIP_OLLAMA === "1" ||
    !(await ollamaAvailable(AbortSignal.timeout(1_500)));
  if (skipModel) {
    return { ok: false, draft: null, error: "ollama no disponible" };
  }

  const drafted = await ollamaChat({
    model: options.model,
    languageMode: "spanish",
    keepAlive: "5m",
    timeoutMs: options.timeoutMs ?? 75_000,
    think: false,
    numPredict: 320,
    numCtx: 2048,
    system: [
      OVERVIEW_SYSTEM,
      "Usa tu conocimiento general. No cites URLs ni inventes fuentes.",
      "Si la pregunta pide datos muy recientes (noticias de hoy, precios al momento), di que no puedes verificarlos sin internet.",
      "Prioriza ejemplos de Colombia cuando el tema lo permita.",
    ].join("\n"),
    prompt: [`Pregunta: ${options.question}`, "", "RESPUESTA:"].join("\n"),
  });

  if (!drafted.ok || !drafted.text.trim()) {
    return { ok: false, draft: null, error: drafted.error, model: drafted.model };
  }

  let parsed =
    parseOverviewFromModel(drafted.text, []) || salvageOverviewFromLooseText(drafted.text);
  if (parsed && parsed.lead && parsed.items.length === 1) {
    parsed = {
      ...parsed,
      sectionTitle: parsed.sectionTitle || "Puntos clave",
      items: [
        parsed.items[0]!,
        {
          title: "Detalle",
          text: parsed.lead.length > 120 ? `${parsed.lead.slice(0, 117)}…` : parsed.lead,
        },
      ],
    };
  }
  if (!parsed || parsed.items.length < 2 || !parsed.lead) {
    return { ok: false, draft: null, raw: drafted.text, error: "formato inválido", model: drafted.model };
  }
  return { ok: true, draft: parsed, raw: drafted.text, model: drafted.model };
}

/** Recupera overview cuando el modelo se desvía un poco de la plantilla. */
function salvageOverviewFromLooseText(raw: string): OverviewDraft | null {
  const text = extractModelFinalAnswer(raw);
  if (!text || isModelReasoningDump(text)) return null;
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const bullets = lines.filter((l) => /^[-*•\d]+[.)]?\s+/.test(l));
  const leadLine =
    lines.find((l) => !/^[-*•\d]+[.)]?\s+/.test(l) && !/^\*\*/.test(l)) ||
    lines[0]!.replace(/\*\*/g, "");
  const items: OverviewItem[] = [];
  for (const bullet of bullets.slice(0, 6)) {
    const cleaned = bullet.replace(/^[-*•\d]+[.)]?\s+/, "").replace(/\*\*/g, "").trim();
    const named = /^([^:]{2,40}):\s*(.+)$/.exec(cleaned);
    if (named) {
      items.push({ title: named[1].trim(), text: named[2].trim() });
    } else if (cleaned.length >= 12) {
      const [title, ...rest] = cleaned.split(/\s+/);
      items.push({
        title: (title || "Punto").slice(0, 32),
        text: rest.join(" ") || cleaned,
      });
    }
  }
  if (!items.length) {
    // Parte el lead en frases si no hubo viñetas.
    const sentences = text
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.replace(/\*\*/g, "").trim())
      .filter((s) => s.length >= 20)
      .slice(0, 5);
    if (sentences.length >= 2) {
      return {
        lead: sentences[0]!,
        sectionTitle: "Puntos clave",
        items: sentences.slice(1).map((s, i) => ({ title: `Punto ${i + 1}`, text: s })),
      };
    }
    return null;
  }
  const lead =
    leadLine.replace(/\*\*/g, "").slice(0, 280) ||
    `${items[0]!.title}: ${items[0]!.text}`.slice(0, 280);
  return {
    lead,
    sectionTitle: "Puntos clave",
    items,
  };
}

export async function redactOverviewAnswer(options: {
  question: string;
  snippets: ContextSnippet[];
  known?: { title: string; body: string };
  images?: CitationImage[];
  timeoutMs?: number;
  model?: string;
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
    model: options.model,
    languageMode: "spanish",
    keepAlive: "5m",
    timeoutMs: options.timeoutMs ?? 45_000,
    think: false,
    numPredict: 280,
    numCtx: 2048,
    system: OVERVIEW_SYSTEM,
    prompt: [
      `Pregunta: ${options.question}`,
      "",
      contextNotes || "(sin notas útiles)",
      "",
      "RESPUESTA:",
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
  const text = extractModelFinalAnswer(raw);
  if (!text) return null;
  if (/no encontr[eé] informaci[oó]n confiable/i.test(text)) {
    return {
      lead: "No encontré información confiable para responder con seguridad.",
      items: [],
    };
  }
  const hasBullets = /^[-*•]\s+\*\*/m.test(text) || /^[-*•]\s+[^*\n]+:/m.test(text);
  if (!looksLikeCleanOverview(text) && !hasBullets) return null;

  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => /^[-*•]\s+/.test(l));
  const sectionLines = lines.filter((l) => /^\*\*[^*]+\*\*$/.test(l));
  const nonBullets = lines.filter((l) => !/^[-*•]\s+/.test(l) && !/^\*\*[^*]+\*\*$/.test(l));
  const section = sectionLines[0]?.replace(/\*\*/g, "") || undefined;
  // Si el modelo puso el lead como **Respuesta: …**, úsalo como lead.
  const sectionAsLead = section
    ?.replace(/^(respuesta|resumen|ubicaci[oó]n)\s*:\s*/i, "")
    .trim();
  const lead =
    nonBullets.slice(0, 2).join(" ") ||
    nonBullets[0] ||
    (sectionAsLead && sectionAsLead.length >= 20 ? sectionAsLead : "") ||
    "";

  const items: OverviewItem[] = [];
  for (const bullet of bullets.slice(0, 6)) {
    const match =
      /^[-*•]\s+\*\*([^*]+?):\*\*\s*(.+)$/.exec(bullet) ||
      /^[-*•]\s+\*\*([^*]+)\*\*:?\s*(.+)$/.exec(bullet) ||
      /^[-*•]\s+\*\*([^*]+)\*\*\s*[—:-]\s*(.+)$/.exec(bullet) ||
      /^[-*•]\s+([^:]{2,40}):\s*(.+)$/.exec(bullet);
    if (!match) continue;
    const title = match[1].trim().replace(/:$/, "");
    const body = match[2].trim();
    if (!body || isMarketingBlurb(body) || isMarketingBlurb(title)) continue;
    items.push({
      title,
      text: body,
      imageUrl: matchImage(title, images),
    });
  }

  const cleanLead = lead.replace(/^#+\s*/, "").trim();
  if (!cleanLead || items.length < 2) return null;
  if (isMarketingBlurb(cleanLead) || isModelReasoningDump(cleanLead)) return null;
  return {
    lead: cleanLead,
    sectionTitle: section,
    items,
  };
}

function extractModelFinalAnswer(raw: string): string {
  let text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/_Herramienta:[^_\n]*_/g, "")
    .trim();
  const marker = /(?:^|\n)\s*RESPUESTA\s*:\s*/i.exec(text);
  if (marker) {
    text = text.slice(marker.index! + marker[0].length).trim();
  }
  if (isModelReasoningDump(text)) {
    const block = text.match(
      /([^\n]{30,}[.!?])\s*\n+(?:\*\*[^*]+\*\*\s*\n+)?(?:[-*] \*\*[^*]+:\*\*[^\n]+\n?){2,}/,
    );
    return block ? block[0].trim() : "";
  }
  // No usar scrubSnippet aquí: colapsa saltos de línea y rompe las viñetas.
  return text
    .replace(/\bAprendizaje(?:\s+web)?:\s*/gi, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    } else if (body.length >= 20) {
      items.push({
        title: shortenTitle(body).slice(0, 40),
        text: body,
        imageUrl: matchImage(body, images),
      });
    }
    if (items.length >= 6) break;
  }
  // Si la ficha known es un párrafo, partimos en puntos clave.
  if (items.length < 2) {
    const sentences = lead
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 24);
    for (const sentence of sentences.slice(1, 5)) {
      items.push({
        title: "Detalle",
        text: sentence,
      });
    }
    if (items.length < 2) {
      items.push(
        { title: "Idea central", text: lead.slice(0, 180) },
        { title: "Uso", text: `Sirve para entender «${known.title}» con claridad.` },
      );
    }
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

  if (/sin[oó]nimos?\s+de\s+feliz/i.test(question)) {
    for (const syn of extractSynonyms(snippets.map((s) => s.text).join(" ")).slice(0, 6)) {
      items.push({
        title: syn.charAt(0).toUpperCase() + syn.slice(1),
        text: `sinónimo habitual de feliz.`,
        imageUrl: matchImage(syn, images),
      });
    }
    if (items.length) return items;
  }

  for (const snippet of snippets) {
    const named = extractNamedFacts(snippet.text);
    for (const fact of named) {
      const key = normalizeKey(fact.title);
      if (seen.has(key) || isMarketingBlurb(fact.text)) continue;
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
    if (seen.has(key) || isMarketingBlurb(title)) continue;
    seen.add(key);
    const sentence = firstSentence(snippet.text);
    if (!sentence || sentence.length < 28 || isMarketingBlurb(sentence)) continue;
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
  const blob = snippets.map((s) => s.text).join(" ");

  if (/cien\s+a[nñ]os\s+de\s+soledad|qui[eé]n\s+escribi[oó]/i.test(q)) {
    if (/gabriel\s+garc[ií]a\s+m[aá]rquez/i.test(blob)) {
      return "**Gabriel García Márquez** escribió *Cien años de soledad*, novela colombiana ganadora de reconocimiento mundial.";
    }
  }
  if (/\bimc\b|masa\s+corporal/i.test(q)) {
    if (/peso|altura|kg|m\s*\u00b2|m2/i.test(blob)) {
      return "El **IMC** (índice de masa corporal) se calcula dividiendo el peso en kilogramos entre la altura en metros al cuadrado: **IMC = peso (kg) / [altura (m)]²**.";
    }
  }
  if (/sin[oó]nimos?\s+de\s+feliz/i.test(q)) {
    const syns = extractSynonyms(blob);
    if (syns.length >= 3) {
      return `Algunos sinónimos de **feliz** son: ${syns.slice(0, 6).join(", ")}.`;
    }
  }
  if (/\bunad\b/i.test(q) && !/contrase[nñ]a/i.test(q)) {
    if (/universidad\s+nacional\s+abierta/i.test(blob) || /educaci[oó]n\s+a\s+distancia/i.test(blob)) {
      return "La **UNAD** es la Universidad Nacional Abierta y a Distancia de Colombia, una institución pública de educación superior virtual y a distancia.";
    }
  }
  if (/fotos[ií]ntesis/i.test(q)) {
    const definitional = snippets
      .map((snippet) => firstSentence(snippet.text))
      .find((sentence) => /\b(plantas|luz|co2|clorofila|proceso)\b/i.test(sentence) && !isMarketingBlurb(sentence));
    if (definitional) {
      return "La **fotosíntesis** es el proceso por el cual las plantas (y algunas bacterias y algas) transforman luz, agua y dióxido de carbono en alimento y liberan oxígeno.";
    }
  }
  if (/virus|bacteria/i.test(q)) {
    if (/virus|bacteria/i.test(blob)) {
      return "La diferencia clave: una **bacteria** es un microorganismo celular que puede vivir solo; un **virus** es una partícula acelular que necesita infectar una célula para reproducirse.";
    }
  }
  if (/caquet[aá]/i.test(q) && items.length >= 2) {
    return `Entre los platos típicos del Caquetá destacan **${items[0].title}** y **${items[1].title}**, cocina de río y selva de la Amazonia colombiana.`;
  }
  if (/peligro|extinci[oó]n/i.test(q) && items.length >= 2) {
    return `En Colombia hay especies amenazadas como **${items[0].title}** y **${items[1].title}**; su conservación es prioritaria.`;
  }

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
          !isMarketingBlurb(sentence) &&
          /\b(es|son|significa|se\s+refiere|designa)\b/i.test(sentence),
      );
    if (definitional) return rewriteSnippetShort(definitional);
  }
  if (items[0] && items[0].text.length > 24) {
    return `**${items[0].title}:** ${items[0].text}`;
  }
  if (snippets[0]) {
    const sentence = firstSentence(snippets[0].text);
    if (sentence && !isOverviewJunk(sentence) && !isMarketingBlurb(sentence)) {
      return rewriteSnippetShort(sentence);
    }
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

function preferColombia(question: string, items: OverviewItem[]): OverviewItem[] {
  const wantsColombia = /colombia|bogot|medell|cali|barranquilla|cartagena|caquet/i.test(question);
  if (!wantsColombia) return items;
  const col = items.filter((item) =>
    /bogot|medell|cali|barranquilla|cartagena|colombia|cundinamarca|antioquia|caquet|amaz/i.test(
      `${item.title} ${item.text}`,
    ),
  );
  if (col.length >= 2) {
    const rest = items.filter((item) => !col.includes(item));
    return [...col, ...rest].slice(0, 6);
  }
  return items;
}

function scoreHitForQuery(hit: RagHit, terms: string[]): number {
  let score = typeof hit.score === "number" ? hit.score : 0;
  const title = hit.chunk.title || "";
  const source = hit.chunk.source || "";
  const text = hit.chunk.text || "";
  const blob = normalizeKey(`${title} ${text}`);
  if (/https?:\/\//.test(source) || /https?:\/\//.test(text)) score += 0.55;
  if (/wikipedia|concepto\.de|wordreference|tuasaude|\.edu|\.gov/i.test(`${source} ${title}`)) {
    score += 0.35;
  }
  if (isInternalLearningTitle(title)) {
    const matched = terms.filter((term) => blob.includes(term)).length;
    if (matched < Math.min(2, Math.max(1, terms.length))) score -= 2.5;
    else score -= 0.25;
  }
  if (isMarketingBlurb(text) || isMarketingBlurb(title)) score -= 0.4;
  const matchedTerms = terms.filter((term) => blob.includes(term)).length;
  score += matchedTerms * 0.12;
  return score;
}

function learningDocMatchesQuery(title: string, text: string, terms: string[]): boolean {
  if (!terms.length) return false;
  const blob = normalizeKey(`${title} ${text}`);
  const matched = terms.filter((term) => blob.includes(term)).length;
  return matched >= Math.min(2, Math.max(1, terms.length));
}

function tokenizeQueryLocal(question: string): string[] {
  return normalizeKey(question)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9áéíóúüñ]/gi, ""))
    .filter((token) => token.length >= 3)
    .filter(
      (token) =>
        !["que", "cual", "como", "quien", "para", "entre", "sobre", "ejemplos", "ejemplo"].includes(
          token,
        ),
    );
}

function isMarketingBlurb(text: string): boolean {
  return /\b(te explicamos|gu[ií]a definitiva|top\s+\d+|desc[uú]brelo|haz clic|en este art[ií]culo|exploraremos|conoce todos los procesos)\b/i.test(
    text,
  );
}

function extractSynonyms(blob: string): string[] {
  const match =
    /feliz[^\n]{0,40}(dichoso|contento|satisfecho|alegre|afortunado|radiante|bienaventurado)[^\n]{0,120}/i.exec(
      blob,
    ) ||
    /\b(dichoso|contento|satisfecho|alegre|afortunado|radiante|boyante|pr[oó]spero|ufano|bienaventurado)(?:\s*,\s*(dichoso|contento|satisfecho|alegre|afortunado|radiante|boyante|pr[oó]spero|ufano|bienaventurado))+/i.exec(
      blob,
    );
  if (!match) {
    const listed = blob.match(
      /\b(dichoso|contento|satisfecho|alegre|afortunado|radiante|boyante|próspero|ufano|bienaventurado)\b/gi,
    );
    return [...new Set((listed || []).map((w) => w.toLowerCase()))].slice(0, 8);
  }
  return [...new Set(match[0].toLowerCase().match(/\b[a-záéíóúüñ]{4,}\b/g) || [])]
    .filter((w) => w !== "feliz" && w !== "sinonimos" && w !== "antonimos")
    .slice(0, 8);
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
