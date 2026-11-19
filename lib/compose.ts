import { ACTIVITY_MAP, systemPrompt } from "@/lib/activities";
import { findLesson, formatLessonAnswer, type Lesson } from "@/lib/lessons";
import {
  stripCitationBlocks,
  type CitationImage,
  type CitationSource,
} from "@/lib/rag/citations";
import { engineLearnNow, engineRememberLesson } from "@/lib/rag/engine-client";
import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument } from "@/lib/rag/types";
import { renderRecipePrompt } from "@/lib/recipe-prompt";
import { detectAnswerStyle, isPreviousSummaryRequest, isStyleRewriteRequest } from "@/lib/style";
import { rewriteAnswerStyle } from "@/lib/style-rewrite";
import { handleDailyLife, handleEmergency, handleProject } from "@/lib/tools/everyday";
import { analyzeAndLearnLink, extractUrls, formatLinkAnswer } from "@/lib/tools/links";
import { polishAnswer } from "@/lib/tools/polish";
import { researchBrief } from "@/lib/tools/research";
import { detectIntent, intentLabel, isSpecialtyIntent, type IntentId } from "@/lib/tools/route";
import { runActivity } from "@/lib/tools";
import { buildTutorPack, looksLikeTutorRequest } from "@/lib/tools/tutor";
import {
  answerUnadCampusFaq,
  looksLikeUnadAssignment,
  looksLikeUnadCampus,
  sanitizeUnadKb,
  unadAssignmentHelp,
} from "@/lib/tools/unad";
import { looksLikeNewsCheck, verifyNewsPost } from "@/lib/tools/news-check";
import {
  createFocusSession,
  focusStatusLine,
  looksLikeFocusRequest,
  startFocusPhase,
} from "@/lib/tools/focus";
import { looksLikeScreenExplain, screenReaderHelpText } from "@/lib/tools/screen-reader";
import {
  looksLikeReminderRequest,
  parseReminderFromText,
} from "@/lib/tools/reminders";
import { voiceCapabilityNote } from "@/lib/voice";
import type { ActivityId, ChatTurn, Effort, ModelId, RecipeMessage } from "@/lib/types";

export function lastUserText(messages: ChatTurn[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index].content;
  }
  return "";
}

export function previousUserText(messages: ChatTurn[]): string {
  let seenLatest = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== "user") continue;
    if (!seenLatest) {
      seenLatest = true;
      continue;
    }
    return messages[index]!.content;
  }
  return "";
}

export function lastAssistantText(messages: ChatTurn[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return messages[index]!.content;
  }
  return "";
}

export type ComposeResult = {
  messages: RecipeMessage[];
  prompt: string;
  answer: string;
  thinking?: string;
  images: CitationImage[];
  sources: CitationSource[];
  learnedFrom?: string;
  ragHits?: number;
};

export async function composeConversation(options: {
  activity: ActivityId;
  model: ModelId;
  effort: Effort;
  thinking: boolean;
  messages: ChatTurn[];
  lessons?: Lesson[];
  documents?: RagDocument[];
  now?: Date;
  webSearch?: boolean | "auto";
  searchEngines?: import("@/lib/search/engines").SearchEnginePrefs;
  ollamaModel?: string;
}): Promise<ComposeResult> {
  const latest = lastUserText(options.messages);
  const lessons = options.lessons ?? [];
  const documents = options.documents ?? [];
  const style = detectAnswerStyle(options.messages);

  // Botones Más corto / Más informativo / Más natural, o «pido un resumen» de lo anterior.
  if (isStyleRewriteRequest(latest)) {
    const previous = lastAssistantText(options.messages);
    const previousClean = stripCitationBlocks(previous);
    if (previousClean.content.trim()) {
      const rewriteStyle = isPreviousSummaryRequest(latest)
        ? "corto"
        : style === "default"
          ? "corto"
          : style;
      const rewritten = rewriteAnswerStyle(previousClean.content, rewriteStyle);
      return wrap(options, "Reescritura de estilo pedida por el usuario.", rewritten, {
        languageMode: "spanish",
        images: previousClean.images,
        sources: previousClean.sources,
        badge: isPreviousSummaryRequest(latest) ? "Resumir" : undefined,
      });
    }
    return wrap(
      options,
      "",
      "No hay una respuesta anterior para resumir. Haz una pregunta primero y luego pide el resumen.",
      { languageMode: "spanish" },
    );
  }

  const routedIntent: IntentId | null =
    options.activity === "preguntar" ? detectIntent(latest) : null;
  const languageMode: "spanish" | "translate" =
    options.activity === "traducir" || routedIntent === "traducir" ? "translate" : "spanish";
  const effectiveActivity: ActivityId =
    routedIntent && isSpecialtyIntent(routedIntent) ? routedIntent : options.activity;

  const learned =
    findLesson(lessons, options.activity, latest) ??
    (routedIntent && isSpecialtyIntent(routedIntent)
      ? findLesson(lessons, routedIntent, latest)
      : null);
  if (learned) {
    const answer = formatLessonAnswer(learned);
    const notes = `Lección aprendida (${learned.id}): usar la corrección guardada para esta pregunta.`;
    void engineRememberLesson({
      id: learned.id,
      activity: learned.activity,
      question: learned.question,
      answer: learned.answer,
      reason: learned.reason,
    });
    // Las lecciones ya son la respuesta correcta: no las reescribimos con R1.
    return wrap(options, notes, answer, {
      learnedFrom: learned.id,
      badge: routedIntent ? intentLabel(routedIntent) : undefined,
      languageMode,
    });
  }

  if (options.activity === "preguntar" && routedIntent) {
    if (routedIntent === "emergencia") {
      const tool = await handleEmergency(latest);
      return wrap(options, tool.notes, tool.answer, { ragHits: 1, languageMode });
    }
    if (routedIntent === "cotidiano") {
      const tool = await handleDailyLife(latest);
      void engineLearnFromQuery(latest);
      const polished = await polishAnswer({
        question: latest,
        context: tool.answer,
        messages: options.messages,
        style,
      });
      return wrap(options, tool.notes, polished.text, {
        ragHits: 1,
        languageMode,
        thinking: polished.thinking,
        images: polished.images,
        sources: polished.sources,
      });
    }
    if (routedIntent === "proyecto") {
      const tool = await handleProject(latest);
      void engineLearnFromQuery(latest);
      return wrap(options, tool.notes, tool.answer, { ragHits: 1, languageMode });
    }
    if (routedIntent === "enlace") {
      const url = extractUrls(latest)[0];
      const analyzed = url ? await analyzeAndLearnLink(url) : null;
      const raw = analyzed
        ? formatLinkAnswer(analyzed)
        : "No pude analizar el enlace. Arranca el motor Python.";
      const polished = await polishAnswer({
        question: latest,
        context: raw,
        messages: options.messages,
        style,
      });
      return wrap(options, analyzed?.text?.slice(0, 1000) || "", polished.text, {
        ragHits: 1,
        languageMode,
        thinking: polished.thinking,
        images: polished.images,
        sources: polished.sources,
      });
    }
  }

  // Fase 2: tutor, UNAD, verificador de noticias (antes del flujo genérico).
  if (looksLikeScreenExplain(latest)) {
    return wrap(options, "", `_Herramienta: Pantalla_\n\n${screenReaderHelpText()}`, {
      ragHits: 1,
      languageMode,
    });
  }
  if (/\b(voz|dictado|leer\s+en\s+voz\s+alta|text[\s-]?to[\s-]?speech)\b/i.test(latest)) {
    return wrap(options, "", `_Herramienta: Voz_\n\n${voiceCapabilityNote()}`, {
      ragHits: 1,
      languageMode,
    });
  }
  if (looksLikeReminderRequest(latest)) {
    const rem = parseReminderFromText(latest);
    const body = rem
      ? [
          "_Herramienta: Recordatorio_",
          "",
          `Programé **${rem.title}** para ${new Date(rem.at).toLocaleString("es-CO")}.`,
          "",
          "En la app Windows, Tauri mostrará la notificación del sistema. Aquí queda guardado en local.",
        ].join("\n")
      : [
          "_Herramienta: Recordatorio_",
          "",
          "Ejemplo: «recuérdame a las 18:00 revisar el foro UNAD».",
        ].join("\n");
    return wrap(options, "", body, { ragHits: 1, languageMode });
  }

  if (looksLikeFocusRequest(latest)) {
    const session = startFocusPhase(createFocusSession({ softSound: /sonido/i.test(latest) }), "work");
    const body = [
      "_Herramienta: Enfoque_",
      "",
      "**Modo enfoque (solo dentro de Lumen)**",
      "",
      focusStatusLine(session),
      "",
      `- Pomodoro ${session.workMinutes}+${session.breakMinutes} × ${session.cycles} ciclos`,
      `- Sonido suave: ${session.softSound ? "sí" : "no"}`,
      "- No bloqueamos apps del sistema: solo reducimos distracciones en esta ventana.",
      "",
      "Di «pausar enfoque» cuando quieras salir.",
    ].join("\n");
    return wrap(options, "", body, { ragHits: 1, languageMode });
  }

  if (looksLikeTutorRequest(latest) || (options.activity === "estudiar" && /quiz|tarjetas|plan\s+semanal/i.test(latest))) {
    const pack = await buildTutorPack({ topicOrText: latest, model: options.ollamaModel });
    const body = pack.answer.includes("Herramienta:")
      ? pack.answer
      : `_Herramienta: Tutor_\n\n${pack.answer}`;
    return wrap(options, "", body, { ragHits: pack.applicable ? 1 : 0, languageMode });
  }
  if (looksLikeNewsCheck(latest)) {
    const news = await verifyNewsPost({
      text: latest,
      webSearch: options.webSearch ?? false,
      model: options.ollamaModel,
    });
    const body = `_Herramienta: Verificador_\n\n${news.answer}`;
    return wrap(options, "", body, { ragHits: news.applicable ? 1 : 0, languageMode });
  }
  if (looksLikeUnadCampus(latest)) {
    const kb = sanitizeUnadKb(undefined);
    const faq = answerUnadCampusFaq(latest, kb);
    const body = `_Herramienta: Campus UNAD_\n\n${faq.answer}`;
    return wrap(options, "", body, { ragHits: 1, languageMode });
  }
  if (looksLikeUnadAssignment(latest)) {
    const help = await unadAssignmentHelp({
      guideText: latest,
      mode: "todo",
      model: options.ollamaModel,
    });
    const body = `_Herramienta: Tareas UNAD_\n\n${help.answer}`;
    return wrap(options, "", body, { ragHits: help.applicable ? 1 : 0, languageMode });
  }

  if (options.activity === "investigar" || routedIntent === "investigar") {
    const tool = await researchBrief(latest, {
      documents,
      lessons,
      messages: options.messages,
      webSearch: options.webSearch ?? false,
      searchEngines: options.searchEngines,
      ollamaModel: options.ollamaModel,
    });
    if (tool.usedWeb) void engineLearnFromQuery(latest);
    const body = tool.answer;
    const withBadge =
      routedIntent === "investigar" && !body.includes("Herramienta:")
        ? `_Herramienta: Investigar_\n\n${body}`
        : body;
    return wrap(options, "", withBadge, {
      ragHits: tool.applicable ? 1 : 0,
      languageMode,
      thinking: tool.thinking,
      images: tool.images,
      sources: tool.sources,
    });
  }

  const rag = await runRagPipeline({
    query: latest,
    activity: effectiveActivity,
    documents,
    lessons,
    includeLiveSources: options.webSearch === true,
  });

  const tool = await runActivity(options.activity, latest);
  // El promptBlock es solo material interno para Ollama; no va al chat ni a la receta visible.
  const notes = (tool.applicable && tool.notes ? tool.notes : "").slice(0, 2000);

  const shouldPolish =
    languageMode === "spanish" &&
    (options.activity === "preguntar" ||
      options.activity === "estudiar" ||
      options.activity === "escribir" ||
      options.activity === "resumir" ||
      options.activity === "organizar" ||
      rag.hits.length > 0);

  if (shouldPolish) {
    const polished = await polishAnswer({
      question: latest,
      context: [tool.answer, rag.promptBlock || rag.answerBlock].filter(Boolean).join("\n\n"),
      messages: options.messages,
      style,
      images: rag.images,
      sources: rag.sources,
    });
    if (rag.hits.length) void engineLearnFromQuery(latest);
    return wrap(options, notes, polished.text, {
      ragHits: rag.hits.length,
      languageMode,
      thinking: polished.thinking,
      images: polished.images,
      sources: polished.sources,
    });
  }

  if (rag.hits.length) void engineLearnFromQuery(latest);
  return wrap(options, notes, tool.answer, {
    ragHits: rag.hits.length,
    languageMode,
    images: rag.images,
    sources: rag.sources,
  });
}

function wrap(
  options: {
    activity: ActivityId;
    model: ModelId;
    effort: Effort;
    thinking: boolean;
    messages: ChatTurn[];
    now?: Date;
  },
  notes: string,
  answer: string,
  meta?: {
    learnedFrom?: string;
    ragHits?: number;
    badge?: string;
    languageMode?: "spanish" | "translate";
    thinking?: string;
    images?: CitationImage[];
    sources?: CitationSource[];
  },
): ComposeResult {
  const detached = stripCitationBlocks(answer);
  const thinking =
    meta?.thinking ||
    (() => {
      const match = /<think>([\s\S]*?)<\/think>/i.exec(detached.content);
      return match?.[1]?.trim() || undefined;
    })();
  const cleanAnswer = detached.content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/Contexto recuperado\. Úsalo para redactar; no lo copies literal:/gi, "")
    .trim();

  const finalAnswer =
    meta?.badge && !cleanAnswer.includes("Herramienta:")
      ? `_Herramienta: ${meta.badge}_\n\n${cleanAnswer}`
      : cleanAnswer;

  const languageMode =
    meta?.languageMode ?? (options.activity === "traducir" ? "translate" : "spanish");
  const messages: RecipeMessage[] = [
    {
      role: "system",
      content: systemPrompt(ACTIVITY_MAP[options.activity], notes, options.now, languageMode),
    },
    ...options.messages,
  ];
  return {
    messages,
    prompt: renderRecipePrompt({
      model: options.model,
      effort: options.effort,
      thinking: options.thinking,
      messages,
    }),
    answer: finalAnswer,
    thinking,
    images: (meta?.images?.length ? meta.images : detached.images).slice(0, 3),
    sources: (meta?.sources?.length ? meta.sources : detached.sources).slice(0, 12),
    learnedFrom: meta?.learnedFrom,
    ragHits: meta?.ragHits ?? 0,
  };
}

async function engineLearnFromQuery(query: string): Promise<void> {
  try {
    await engineLearnNow({ topics: [query.slice(0, 120)], maxTopics: 1 });
  } catch {
    // best-effort
  }
}
