import { sourcesFromHits, type CitationImage, type CitationSource } from "@/lib/rag/citations";
import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument, RagHit } from "@/lib/rag/types";
import type { Lesson } from "@/lib/lessons";
import { factSeedSnippet } from "@/lib/data/wikidata-tables";
import {
  draftHasInternalContradiction,
  hedgeOfflineExactStats,
  needsExternalFactCheck,
  verifyWithOpenKnowledge,
} from "@/lib/search/factcheck";
import {
  DEFAULT_SEARCH_ENGINE_PREFS,
  formatEnginesUsedNote,
  multiSearch,
  sanitizeSearchEnginePrefs,
  type MultiSearchHit,
  type SearchEngineId,
  type SearchEnginePrefs,
} from "@/lib/search/engines";
import { detectAnswerStyle } from "@/lib/style";
import { rewriteAnswerStyle } from "@/lib/style-rewrite";
import { solveMath } from "@/lib/tools/math";
import {
  appendOfflineFooter,
  buildOverviewFallback,
  cleanCitationSources,
  formatOverviewMarkdown,
  overviewFromKnown,
  prepareContextSnippets,
  redactOverviewAnswer,
  redactOverviewFromKnowledge,
  scoreOverviewClarity,
  selfVerifyOverview,
  validateOverviewDraft,
  type ClarityScore,
  type OverviewDraft,
} from "@/lib/tools/overview";
import { looksLikeMath } from "@/lib/tools/route";
import type { ChatTurn } from "@/lib/types";

export type WebSearchMode = boolean | "auto";

type ToolResult = {
  applicable: boolean;
  answer: string;
  notes: string;
  thinking?: string;
  images: CitationImage[];
  sources: CitationSource[];
  usedWeb?: boolean;
  offline?: boolean;
  clarity?: ClarityScore;
  /** Motores que devolvieron al menos un hit. */
  enginesUsed?: SearchEngineId[];
  /** Motores que se intentaron (aunque fallen). */
  enginesTried?: SearchEngineId[];
  answerSource?: "model" | "known_lexical" | "math" | "empty";
  firstTokenMs?: number;
  totalMs?: number;
};

/** Preguntas que suelen necesitar dato fresco de internet. */
export function looksLikeFreshWebQuery(question: string): boolean {
  return /\b(hoy|ahora|esta\s+semana|precio\s+actual|noticias?|últimas?\s+noticias|en\s+vivo|resultado\s+del\s+partido|cotizaci[oó]n)\b/i.test(
    question,
  );
}

/** Datos exactos / numéricos donde conviene contrastar con Wiki/Wikidata/SearXNG. */
export function looksLikeExactOrNumericQuery(question: string): boolean {
  return (
    /\b(cu[aá]ntos?|cu[aá]l\s+es\s+la\s+capital|poblaci[oó]n|fecha|en\s+qu[eé]\s+a[nñ]o|porcentaje|%\s*de)\b/i.test(
      question,
    ) ||
    /\b\d+\s*%\s*de\s*\d+/i.test(question) ||
    /capital\s+de\s+\w+/i.test(question)
  );
}

/**
 * Solo fichas léxicas / plantillas genéricas (NO respuestas de examen memorizadas).
 * Capitales y departamentos van por lib/data/wikidata-tables.ts como semilla tabular.
 */
const KNOWN: Array<{ match: RegExp; title: string; body: string }> = [
  {
    match: /sin[oó]nimos?\s+de\s+feliz/,
    title: "Sinónimos de feliz",
    body: [
      "Algunos sinónimos de feliz son contento, alegre, dichoso y satisfecho. Se usan para hablar de bienestar o de un buen momento. La palabra exacta depende del tono: más cotidiano, más literario o más formal.",
      "",
      "**Sinónimos de feliz**",
      "",
      "- **Contento:** expresa satisfacción con lo que ocurre. Por ejemplo: «Estoy contento con la nota del examen.»",
      "- **Alegre:** señala un ánimo positivo y ligero. Por ejemplo: «Llegó alegre a la reunión familiar.»",
      "- **Dichoso:** es un sinónimo más literario o enfático. Por ejemplo: «Se sintió dichoso al reencontrarse con su familia.»",
      "- **Satisfecho:** destaca que se cumplió una expectativa. Por ejemplo: «Quedó satisfecho con el resultado del proyecto.»",
      "",
      "**En resumen**",
      "",
      "Contento, alegre, dichoso y satisfecho sirven como alternativas claras a feliz según el contexto.",
    ].join("\n"),
  },
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
    match:
      /^(qu[eé]\s+es\s+(una?\s+)?)?perreras?\s*$|^(significado|definici[oó]n)\s+de\s+(una?\s+)?perreras?\s*$/i,
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
  {
    match: /^(qu[eé]\s+es\s+(una?\s+)?)?casas?\s*$|^(significado|definici[oó]n)\s+de\s+(una?\s+)?casas?\s*$/i,
    title: "Casas",
    body: [
      "Casas es el plural de casa, una edificación destinada principalmente a servir de vivienda o residencia a personas o familias. También puede referirse a un establecimiento, organización o institución.",
      "",
      "**Sinónimos**",
      "",
      "- Vivienda, hogar, morada, residencia, domicilio",
      "- Chalet, quinta, cabaña, finca (según el estilo o entorno)",
      "- Empresa, firma, establecimiento, institución (en contextos comerciales o de linaje, como casa comercial o casa real)",
      "",
      "**Ejemplos de uso**",
      "",
      '- **Vivienda:** "Compraron una casa de dos pisos cerca del parque."',
      '- **Hogar o familia:** "A las seis de la tarde todos regresan a casa."',
      '- **Comercio o institución:** "Esa casa de cambios ofrece buena tasa hoy."',
      '- **Linaje o dinastía:** "La casa real asistió a la ceremonia oficial."',
    ].join("\n"),
  },
  {
    match:
      /^(qu[eé]\s+es\s+(una?\s+)?)?ciudad(?:es)?\s*$|^(significado|definici[oó]n)\s+de\s+(una?\s+)?ciudad(?:es)?\s*$/i,
    title: "Ciudades",
    body: [
      "Ciudades es el plural de ciudad: un asentamiento humano de tamaño considerable, con población densa, administración propia y servicios urbanos (comercio, transporte, salud, educación).",
      "",
      "**Significados y usos principales**",
      "",
      "- **Asentamiento urbano:** núcleo poblado mayor que un pueblo, con calles, edificios y vida económica continua.",
      "- **Ámbito administrativo:** territorio o municipio con gobierno local (alcaldía, ayuntamiento).",
      "- **Conjunto social:** la comunidad que vive y trabaja en ese espacio («la ciudad se organizó»).",
      "- **Uso figurado:** ambiente intenso o agitado («aquello era una ciudad»).",
      "",
      "**Sinónimos**",
      "",
      "- Urbe, metrópoli, capital, municipio, centro urbano",
      "- En contraste: pueblo, aldea, villa (asentamientos menores)",
      "",
      "**Ejemplos de uso**",
      "",
      '- "Bogotá es una de las ciudades más grandes de Colombia."',
      '- "Prefiere vivir en la ciudad por el acceso al trabajo y a los servicios."',
      '- "Las ciudades costeras suelen crecer alrededor del puerto."',
    ].join("\n"),
  },
];

export async function researchBrief(
  input: string,
  options?: {
    documents?: RagDocument[];
    lessons?: Lesson[];
    messages?: ChatTurn[];
    /** false = solo local/modelo; true = web; "auto" = web si hace falta. Por defecto false. */
    webSearch?: WebSearchMode;
    /** Modelo Ollama de chat (p. ej. qwen2.5:7b). */
    ollamaModel?: string;
    /** Preferencias de motores gratuitos/libres (SearXNG, Wiki, etc.). */
    searchEngines?: Partial<SearchEnginePrefs> | SearchEnginePrefs;
    /** Si false, no usa multi-motor aunque web esté en auto/siempre (para benches). */
    useMultiEngines?: boolean;
    /** Si true, ignora fichas léxicas (fuerza generación del modelo; para benches). */
    skipKnownFichas?: boolean;
  },
): Promise<ToolResult> {
  const startedAt = Date.now();
  const question = input.trim().replace(/\s+/g, " ");
  if (question.length < 3) {
    return {
      applicable: false,
      answer: "Escribe la pregunta para investigarla con memoria local o tu modelo.",
      notes: "",
      images: [],
      sources: [],
      totalMs: Date.now() - startedAt,
    };
  }

  const lower = question.toLowerCase();
  const skipKnown =
    options?.skipKnownFichas === true || process.env.LUMEN_BENCH_NO_FICHAS === "1";
  const known = skipKnown ? undefined : KNOWN.find((item) => item.match.test(lower));
  const webMode: WebSearchMode = options?.webSearch ?? false;
  const searchPrefs = sanitizeSearchEnginePrefs(
    options?.searchEngines ?? DEFAULT_SEARCH_ENGINE_PREFS,
  );
  const useMulti = options?.useMultiEngines !== false;
  /** En Auto siempre se intentan motores libres (antes se saltaba si el offline “parecía claro”). */
  const wantWeb = webMode === true || webMode === "auto";
  const model = options?.ollamaModel;
  const REDACT_MS = skipKnown ? 55_000 : 40_000;
  const REDACT_ATTEMPTS = 1;
  let firstTokenMs: number | undefined;
  let answerSource: ToolResult["answerSource"] = "model";

  // Cálculo exacto en código: el modelo solo explica (nunca inventa el número).
  // En Auto no gasta motores: el número ya está resuelto.
  if (looksLikeMath(question)) {
    const math = solveMath(question);
    if (math.applicable && math.answer.trim()) {
      const answer = [
        math.answer.trim(),
        "",
        "_Cálculo hecho con código local; el modelo no inventó la cifra._",
      ].join("\n");
      return {
        applicable: true,
        answer,
        notes: "",
        images: [],
        sources: [],
        usedWeb: false,
        offline: true,
        enginesUsed: [],
        enginesTried: [],
        clarity: { clear: true, reasons: [], note: "Cálculo exacto por código" },
        answerSource: "math",
        firstTokenMs: Date.now() - startedAt,
        totalMs: Date.now() - startedAt,
      };
    }
  }

  // 1) Documentos / lecciones locales (sin web).
  const rag = await runRagPipeline({
    query: question,
    activity: "investigar",
    documents: options?.documents,
    lessons: options?.lessons,
    includeLiveSources: false,
  });

  let hits = rag.hits;
  if (!wantWeb && !(options?.documents?.length)) {
    hits = rag.hits.filter((hit) => {
      const blob = `${hit.chunk.source || ""} ${hit.chunk.title || ""}`;
      return !/^https?:\/\//i.test(hit.chunk.source || "") && !/Aprendizaje\s*web/i.test(blob);
    });
  }
  let snippets = prepareContextSnippets(hits, question);
  if (!wantWeb) {
    snippets = snippets.filter(
      (snippet) => !snippet.url || Boolean(options?.documents?.length),
    );
  }

  // Semilla tabular Wikidata (capitales / departamentos): contexto corto, no respuesta completa.
  const seed = factSeedSnippet(question);
  if (seed) {
    snippets = [{ title: seed.title, text: seed.text, url: seed.url }, ...snippets].slice(0, 8);
  }

  let sources: CitationSource[] = [];
  let usedWeb = false;
  let enginesUsed: SearchEngineId[] = [];
  let enginesTried: SearchEngineId[] = [];

  const localSources = cleanCitationSources(
    sourcesFromHits(
      hits.map((hit) => ({
        title: hit.chunk.title,
        source: hit.chunk.source,
      })),
    ).filter((s) => !s.url?.startsWith("http") || Boolean(options?.documents?.length)),
  );

  async function finalizeOverview(params: {
    overview: OverviewDraft;
    clarity?: ClarityScore;
    thinking?: string;
    offline: boolean;
    enginesUsed?: SearchEngineId[];
    sources?: CitationSource[];
    usedWeb?: boolean;
    hedgeOffline?: boolean;
    answerSource?: ToolResult["answerSource"];
    firstTokenMs?: number;
  }): Promise<ToolResult> {
    let overview = params.overview;
    let clarity = params.clarity || scoreOverviewClarity(overview, question);

    const contradictionIssues = draftHasInternalContradiction(overview);
    if (contradictionIssues.length) {
      clarity = {
        clear: false,
        reasons: [...(clarity.reasons || []), "contradiccion_interna"],
        note: contradictionIssues.join("; "),
      };
    }

    // Autoverificación corta (segunda pasada). Se omite en fichas léxicas y en benches.
    if (clarity.clear && params.hedgeOffline !== false && !skipKnown) {
      const verify = await selfVerifyOverview({
        question,
        draft: overview,
        model,
        timeoutMs: 8_000,
      });
      if (!verify.ok && verify.issues.length) {
        clarity = {
          clear: false,
          reasons: [...(clarity.reasons || []), "autoverificacion"],
          note: verify.issues.join("; "),
        };
      }
    }

    // En Auto: verificar cifras/ubicaciones/listas con Wiki/Wikidata antes de mostrar.
    if (wantWeb && clarity.clear && needsExternalFactCheck(question)) {
      const draftText = formatOverviewMarkdown(overview, { rows: false });
      const check = await verifyWithOpenKnowledge(question, draftText, searchPrefs);
      if (!check.ok) {
        clarity = {
          clear: false,
          reasons: [...(clarity.reasons || []), "factcheck_fallido"],
          note: check.note || "No verificado en Wikipedia/Wikidata",
        };
        if (check.evidence.length) {
          snippets = [
            ...check.evidence.map((s) => ({
              title: s.title,
              text: s.snippet || s.title,
              url: s.url,
            })),
            ...snippets,
          ].slice(0, 8);
          const retry = await redactOverviewAnswer({
            question,
            snippets,
            known,
            images: [],
            timeoutMs: REDACT_MS,
            model,
            attempts: 1,
          });
          if (retry.draft && validateOverviewDraft(question, retry.draft).ok) {
            overview = retry.draft;
            clarity = scoreOverviewClarity(retry.draft, question);
            if (check.enginesUsed.length) {
              enginesUsed = Array.from(
                new Set([...enginesUsed, ...(check.enginesUsed as SearchEngineId[])]),
              );
            }
            usedWeb = true;
            sources = cleanCitationSources([
              ...check.evidence.map((s) => ({ title: s.title, url: s.url })),
              ...sources,
            ]);
          }
        }
      } else if (check.enginesUsed.length) {
        enginesUsed = Array.from(
          new Set([...enginesUsed, ...(check.enginesUsed as SearchEngineId[])]),
        );
        usedWeb = true;
        sources = cleanCitationSources([
          ...check.evidence.map((s) => ({ title: s.title, url: s.url })),
          ...sources,
        ]);
      }
    }

    let answer = formatOverviewMarkdown(overview, { rows: false });
    if (params.hedgeOffline) {
      answer = hedgeOfflineExactStats(answer, Boolean(known));
    }
    const style = detectAnswerStyle(options?.messages ?? []);
    if (style === "corto" || style === "natural") answer = rewriteAnswerStyle(answer, style);

    const engines = params.enginesUsed ?? enginesUsed;
    const tried = enginesTried;
    // Honesto: «usados» = con hits; si no hay hits, se informa lo consultado aparte.
    const enginesNote = formatEnginesUsedNote(engines, wantWeb ? tried : undefined);
    const finalSources = params.sources ?? (params.usedWeb ? sources : localSources);
    const web = params.usedWeb ?? usedWeb;
    const src = params.answerSource || answerSource || "model";

    if (web || (wantWeb && enginesNote)) {
      const sourceLines = finalSources
        .filter((s) => s.url?.startsWith("http"))
        .slice(0, 6)
        .map((s) => `- [${s.title}](${s.url})`);
      if (sourceLines.length) {
        answer = `${answer}\n\n**Fuentes**\n${sourceLines.join("\n")}`;
      }
      if (enginesNote) answer = `${answer}\n\n${enginesNote}`;
      if (!web) {
        answer = appendOfflineFooter(answer, {
          confidence:
            src === "known_lexical"
              ? "Ficha léxica local; motores consultados sin hits útiles."
              : `Redactado por modelo (${model || "Ollama"}).`,
        });
      }
    } else {
      answer = appendOfflineFooter(answer, {
        confidence:
          src === "known_lexical"
            ? "Ficha léxica local (definición/sinónimos)."
            : `Redactado por modelo (${model || "Ollama"}). Sin fuentes web inventadas.`,
      });
    }

    return {
      applicable: true,
      answer,
      images: [],
      sources: web ? finalSources : localSources,
      notes: "",
      thinking: params.thinking,
      usedWeb: web,
      offline: params.offline && !web,
      enginesUsed: engines,
      enginesTried: tried,
      clarity,
      answerSource: src,
      firstTokenMs: params.firstTokenMs ?? firstTokenMs,
      totalMs: Date.now() - startedAt,
    };
  }

  // 2) Offline / Apagado: ficha rápida o modelo; sin cifras inventadas.
  if (!wantWeb) {
    let overview: OverviewDraft | null = null;
    let thinking: string | undefined;
    let clarity: ClarityScore | undefined;

    // Fichas léxicas solo (definiciones). Semillas Wikidata NO saltan el modelo.
    if (known && !seed) {
      const fromKnown = overviewFromKnown(known, []);
      const knownOk =
        validateOverviewDraft(question, fromKnown).ok ||
        (fromKnown.lead.length >= 40 && fromKnown.items.length >= 2);
      if (knownOk) {
        overview = fromKnown;
        clarity = scoreOverviewClarity(fromKnown, question);
        answerSource = "known_lexical";
        firstTokenMs = Date.now() - startedAt;
        if (!clarity.clear && fromKnown.items.length >= 2) {
          clarity = {
            clear: true,
            reasons: [],
            note: "Ficha léxica local",
          };
        }
      }
    }

    if (!overview && snippets.length >= 1) {
      const withContext = await redactOverviewAnswer({
        question,
        snippets,
        known: undefined,
        images: [],
        timeoutMs: REDACT_MS,
        model,
        attempts: REDACT_ATTEMPTS,
      });
      firstTokenMs = withContext.firstTokenMs ?? firstTokenMs;
      if (withContext.draft && validateOverviewDraft(question, withContext.draft).ok) {
        overview = withContext.draft;
        clarity = withContext.clarity || scoreOverviewClarity(withContext.draft, question);
        answerSource = "model";
      } else {
        thinking = withContext.error;
      }
    }

    if (!overview) {
      const fromModel = await redactOverviewFromKnowledge({
        question,
        known: undefined,
        model,
        timeoutMs: REDACT_MS,
        attempts: REDACT_ATTEMPTS,
      });
      firstTokenMs = fromModel.firstTokenMs ?? firstTokenMs;
      if (fromModel.draft && validateOverviewDraft(question, fromModel.draft).ok) {
        overview = fromModel.draft;
        clarity = fromModel.clarity || scoreOverviewClarity(fromModel.draft, question);
        thinking = fromModel.ok ? undefined : fromModel.error;
        answerSource = "model";
      } else {
        thinking = fromModel.error || thinking;
      }
    }

    if (overview) {
      return finalizeOverview({
        overview,
        clarity,
        thinking,
        offline: true,
        hedgeOffline: answerSource !== "known_lexical",
        enginesUsed: [],
        usedWeb: false,
        answerSource,
        firstTokenMs,
      });
    }

    return {
      applicable: false,
      answer: appendOfflineFooter(
        [
          "No pude responder con claridad solo con el modelo local.",
          "",
          "Prueba a activar «Buscar en internet», subir un documento en Mis documentos, o cambiar el modelo en Ajustes.",
        ].join("\n"),
        { confidence: "Sin respuesta clara offline." },
      ),
      notes: "",
      images: [],
      sources: [],
      thinking,
      usedWeb: false,
      offline: true,
      enginesUsed: [],
      enginesTried: [],
      clarity: { clear: false, reasons: ["sin_respuesta"], note: "No hubo respuesta clara" },
      answerSource: "empty",
      firstTokenMs,
      totalMs: Date.now() - startedAt,
    };
  }

  // 3) Auto / Siempre: motores libres SIEMPRE (SearXNG → Wiki → Wikidata → Marginalia → DDG).
  if (useMulti) {
    const multi = await multiSearch(question, searchPrefs, { timeoutMs: 4_500, limit: 6 });
    enginesUsed = multi.enginesUsed;
    enginesTried = multi.enginesTried;
    const webHits: MultiSearchHit[] = multi.hits;
    if (webHits.length) {
      const asRag: RagHit[] = webHits.map((item, index) => ({
        score: item.score,
        chunk: {
          id: `live-web-${item.engine}-${index}`,
          documentId: `live-web-${item.engine}-${index}`,
          title: item.title,
          source: `${item.engine} · ${item.url}`,
          text: item.snippet || item.title,
          index,
        },
      }));
      hits = [...asRag, ...hits];
      snippets = prepareContextSnippets(hits, question);
      sources = cleanCitationSources([
        ...webHits.map((item) => ({ title: item.title, url: item.url })),
        ...sources,
      ]);
      usedWeb = true;
    }
  }

  // Reinyectar semilla tabular tras el merge web.
  if (seed) {
    snippets = [{ title: seed.title, text: seed.text, url: seed.url }, ...snippets].slice(0, 8);
    sources = cleanCitationSources([{ title: seed.title, url: seed.url }, ...sources]);
  }

  // Ficha léxica rápida (solo definiciones; no ensayos de examen).
  if (known && !seed) {
    const fromKnown = overviewFromKnown(known, []);
    const knownOk =
      validateOverviewDraft(question, fromKnown).ok ||
      (fromKnown.lead.length >= 40 && fromKnown.items.length >= 2);
    if (knownOk) {
      let clarity = scoreOverviewClarity(fromKnown, question);
      if (!clarity.clear && fromKnown.items.length >= 2) {
        clarity = { clear: true, reasons: [], note: "Ficha léxica local" };
      }
      return finalizeOverview({
        overview: fromKnown,
        clarity,
        offline: false,
        hedgeOffline: false,
        enginesUsed,
        sources,
        usedWeb,
        answerSource: "known_lexical",
        firstTokenMs: Date.now() - startedAt,
      });
    }
  }

  const redacted = await redactOverviewAnswer({
    question,
    snippets,
    known: undefined,
    images: [],
    timeoutMs: REDACT_MS,
    model,
    attempts: REDACT_ATTEMPTS,
  });
  firstTokenMs = redacted.firstTokenMs;
  let overview =
    redacted.draft && validateOverviewDraft(question, redacted.draft).ok ? redacted.draft : null;
  let clarity = redacted.clarity;
  answerSource = "model";

  if (!overview) {
    const fromModel = await redactOverviewFromKnowledge({
      question,
      known: undefined,
      model,
      timeoutMs: REDACT_MS,
      attempts: REDACT_ATTEMPTS,
    });
    firstTokenMs = fromModel.firstTokenMs ?? firstTokenMs;
    if (fromModel.draft && validateOverviewDraft(question, fromModel.draft).ok) {
      overview = fromModel.draft;
      clarity = fromModel.clarity;
    }
  }

  if (!overview) {
    return {
      applicable: false,
      answer: [
        "No encontré información clara y confiable para responder.",
        "",
        "Prueba a reformular o carga un documento en Mis documentos.",
        formatEnginesUsedNote(enginesUsed, enginesTried) || "",
      ]
        .filter(Boolean)
        .join("\n"),
      notes: "",
      images: [],
      sources,
      usedWeb,
      offline: !usedWeb,
      enginesUsed,
      enginesTried,
      clarity: { clear: false, reasons: ["sin_respuesta"], note: "No hubo respuesta clara" },
      answerSource: "empty",
      firstTokenMs,
      totalMs: Date.now() - startedAt,
    };
  }

  return finalizeOverview({
    overview,
    clarity,
    thinking: redacted.ok ? undefined : redacted.error,
    offline: !usedWeb,
    enginesUsed,
    sources,
    usedWeb,
    answerSource: "model",
    firstTokenMs,
  });
}

/** Borrador overview a partir de hits (contexto limpio; sin pegar scrapes). */
export function buildResearchDraft(
  question: string,
  hits: RagHit[],
  known?: { title: string; body: string },
): string {
  const snippets = prepareContextSnippets(hits, question);
  const overview = buildOverviewFallback({ question, snippets, known });
  if (overview) return formatOverviewMarkdown(overview);

  if (known || looksLikeDefinitionQuery(question)) {
    const definition = buildDefinitionDraft(question, hits, known);
    if (definition) return definition;
  }
  return "";
}

/** Resume en 2–3 puntos concretos lo que aportan las fuentes (nunca un placeholder). */
export function summarizeSourceSnippets(items: Array<{ title: string; text: string }>): string {
  const points: string[] = [];
  for (const item of items) {
    const sentence =
      splitUsefulSentences(item.text).find((part) => part.length >= 40) ||
      item.text.trim();
    if (!sentence || sentence.length < 28) continue;
    if (/conviene contrastar|fuentes enlazadas/i.test(sentence)) continue;
    const clipped = sentence.length > 160 ? `${sentence.slice(0, 157).trim()}…` : sentence;
    const label = item.title && item.title !== "Fuente" ? `**${item.title}:** ` : "";
    points.push(`- ${label}${clipped}`);
    if (points.length >= 3) break;
  }
  if (!points.length) {
    return "Las fuentes recuperadas no aportaron frases claras; conviene reformular la pregunta.";
  }
  return points.join("\n");
}

/** Descarta scrapes truncados, marketing vacío o cortes a mitad de frase. */
export function isUsableSourceSnippet(text: string): boolean {
  const clean = text.trim();
  if (clean.length < 40) return false;
  if (/^[a-záéíóúüñ]\s/.test(clean)) return false;
  if (/^[\-–—(•*\d.)\s]+/.test(clean) && clean.length < 90) return false;
  if (isTruncatedSentence(clean)) return false;
  if (isEnglishHeavy(clean)) return false;
  if (
    /\b(en este art[ií]culo|exploraremos|descubre qu[eé]|haz clic|leer m[aá]s|sigue leyendo|invit[aá]ndote|gemas ocultas|han dejado huella|caracter[ií]sticas esenciales y ejemplos)\b/i.test(
      clean,
    )
  ) {
    return false;
  }
  // Corte típico por límite de caracteres: termina en artículo/preposición o palabra a medias.
  if (/\b(el|la|los|las|de|del|con|para|y|o|un|una|que|qu)\s*$/i.test(clean)) return false;
  if (/[a-záéíóúüñ]{1,3}$/i.test(clean) && !/[.!?…»”"]$/.test(clean) && clean.length >= 200) {
    return false;
  }
  return true;
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

  const relevantHits = hits.filter(
    (hit) => hitMentionsTerm(hit, term) && !isAcronymOrForeignCollision(hit, term),
  );
  const sentences = relevantHits
    .flatMap((hit) => splitUsefulSentences(cleanHitText(hit.chunk.text)))
    .filter((sentence) => isUsableDefinitionSentence(sentence, term))
    .filter((sentence) => !isEnglishHeavy(sentence));
  const unique = dedupeSentences(sentences).slice(0, 8);
  if (!unique.length) return "";

  const lexical = unique.filter((sentence) => isLexicalSense(sentence, term));
  const lead =
    lexical.find((sentence) =>
      new RegExp(
        `\\b${escapeRegExp(term)}\\b.{0,40}\\b(es|son|designa|significa|se\\s+refiere)\\b`,
        "i",
      ).test(sentence),
    ) ||
    lexical.find((sentence) => /\bes\s+un[a]?\b|\bse\s+trata\s+de\b|\bsignifica\b/i.test(sentence)) ||
    lexical[0];
  if (!lead) return "";

  const meanings = lexical.filter((sentence) => sentence !== lead && isLexicalSense(sentence, term)).slice(0, 4);
  const examples = unique
    .filter((sentence) => /[«"“]/.test(sentence) || /\bejemplo\b/i.test(sentence))
    .filter((sentence) => !isFactualDump(sentence))
    .slice(0, 3);

  const sections = [`**${heading}**`, "", lead];

  if (meanings.length) {
    sections.push("", "**Significados y usos principales**", "", ...meanings.map((sentence) => `- ${sentence}`));
  }

  if (examples.length) {
    sections.push("", "**Ejemplos de uso**", "", ...examples.map((sentence) => `- ${sentence}`));
  }

  sections.push(
    "",
    "**En resumen**",
    "",
    lead.length > 180 ? `${lead.slice(0, 177).trim()}…` : lead,
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
  if (isEnglishHeavy(sentence)) return false;
  if (isFactualDump(sentence)) return false;
  if (!sentenceMentionsTerm(sentence, term)) return false;
  // Evita municipios/acrónimos: "Casas Municipality", "CASAS provides testing…"
  if (/\bmunicipality\b|\bcounty\b|\bassessment systems\b|\bweb trainings?\b|\btopspro\b/i.test(sentence)) {
    return false;
  }
  return true;
}

/** Solo acepciones léxicas; no listas de ciudades ni demografía. */
export function isLexicalSense(sentence: string, term: string): boolean {
  if (!isUsableDefinitionSentence(sentence, term)) return false;
  if (
    !/\b(es|son|significa|designa|denota|se\s+refiere|se\s+trata|puede\s+referirse|llamad[oa]s?|consiste\s+en)\b/i.test(
      sentence,
    )
  ) {
    return false;
  }
  if (isFactualDump(sentence)) return false;
  return true;
}

export function isFactualDump(sentence: string): boolean {
  if (/\d+\s*%/.test(sentence)) return true;
  if (/\b(habitantes|demograf|metropolitana|concentraci[oó]n urbana|al a[nñ]o\s+20\d{2})\b/i.test(sentence)) {
    return true;
  }
  if (/\b20\d{2}\b/.test(sentence) && /\b(ciudades?|habitantes|poblaci[oó]n)\b/i.test(sentence)) return true;
  // Listas de topónimos: "Chiclayo y Huancayo; … Iquitos y Cusco"
  const placeLike = sentence.match(/\b[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{3,}(?:\s+y\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{3,})+/g);
  if (placeLike && placeLike.length >= 1) return true;
  const caps = sentence.match(/\b[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,}\b/g) || [];
  if (caps.length >= 3) return true;
  return false;
}

/** Rechaza choques tipo CASAS (acrónimo EN) cuando el usuario pide «casas» en español. */
export function isAcronymOrForeignCollision(hit: RagHit, term: string): boolean {
  const title = hit.chunk.title || "";
  const text = hit.chunk.text || "";
  const blob = `${title} ${text}`;
  const t = term.trim();
  if (!t) return false;
  // Título/acrónimo en mayúsculas distinto del uso español en minúsculas.
  if (t === t.toLowerCase() && new RegExp(`\\b${escapeRegExp(t.toUpperCase())}\\b`).test(blob)) {
    if (/\b(assessment|systems|training|enterprise|curriculum|managers)\b/i.test(blob)) return true;
  }
  if (/\bmunicipality\b|\bcomprehensive adult student\b|\btopspro\b/i.test(blob)) return true;
  // Bloque casi solo en inglés.
  if (isEnglishHeavy(blob.slice(0, 400))) return true;
  return false;
}

export function isEnglishHeavy(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-záéíóúüñ'\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 6) return false;
  const english = words.filter((word) => ENGLISH_MARKERS.has(word)).length;
  const spanish = words.filter((word) => SPANISH_MARKERS.has(word)).length;
  if (english >= 3 && english > spanish * 1.5) return true;
  // Muchas palabras ASCII típicas EN sin tildes y con marcadores.
  return english >= 4 && spanish === 0;
}

const ENGLISH_MARKERS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "are",
  "is",
  "of",
  "in",
  "to",
  "provides",
  "testing",
  "systems",
  "training",
  "trainings",
  "student",
  "adult",
  "comprehensive",
  "municipality",
  "encompassing",
  "square",
  "kilometers",
  "because",
  "tests",
  "track",
  "progress",
  "data",
  "managers",
  "enterprise",
  "web",
]);

const SPANISH_MARKERS = new Set([
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "una",
  "uno",
  "que",
  "por",
  "para",
  "con",
  "como",
  "más",
  "tambien",
  "también",
  "es",
  "son",
  "se",
  "al",
  "en",
  "vivienda",
  "hogar",
  "familia",
  "edificacion",
  "edificación",
]);

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
  let text = raw
    .replace(/^#+\s*/gm, "")
    .replace(/\bAprendizaje(?:\s+web)?:\s*/gi, "")
    .replace(/\bFecha\s*\([^)]*\):\s*/gi, "")
    .replace(/\bHechos clave\b[:\s]*/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\|\s*Spanish to English Translation[^.]*/gi, " ")
    .replace(/SpanishDictionary\.com[^.]*/gi, " ")
    .replace(/Learn the meaning and usage of[^.]*/gi, " ")
    .replace(/\binjuries\b/gi, " ")
    .replace(/\([^)]{0,40}\)\s*[-–—]\s*/g, " ")
    .replace(/^\s*[-–—(•*]+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Si quedó un resto de título en minúsculas antes de la frase útil, córtalo.
  const sentenceStart = text.search(/[A-ZÁÉÍÓÚÜÑ¿¡«"“0-9]/);
  if (sentenceStart > 0 && sentenceStart <= 48) {
    text = text.slice(sentenceStart).trim();
  }

  if (text.length > 320) {
    const clipped = text.slice(0, 320);
    const boundary = Math.max(
      clipped.lastIndexOf(". "),
      clipped.lastIndexOf("! "),
      clipped.lastIndexOf("? "),
      clipped.lastIndexOf("… "),
    );
    text = boundary >= 120 ? clipped.slice(0, boundary + 1).trim() : clipped.trim();
  }
  return text;
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
