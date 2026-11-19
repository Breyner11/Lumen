import { ACTIVITY_MAP, systemPrompt } from "@/lib/activities";
import { findLesson, formatLessonAnswer, type Lesson } from "@/lib/lessons";
import { augmentAnswerWithRag } from "@/lib/rag/augment";
import { engineLearnNow, engineRememberLesson } from "@/lib/rag/engine-client";
import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument } from "@/lib/rag/types";
import { renderRecipePrompt } from "@/lib/recipe-prompt";
import { handleDailyLife, handleEmergency, handleProject } from "@/lib/tools/everyday";
import { analyzeAndLearnLink, extractUrls, formatLinkAnswer } from "@/lib/tools/links";
import { researchBrief } from "@/lib/tools/research";
import { detectIntent, intentLabel, isSpecialtyIntent, type IntentId } from "@/lib/tools/route";
import { runActivity } from "@/lib/tools";
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

export async function composeConversation(options: {
  activity: ActivityId;
  model: ModelId;
  effort: Effort;
  thinking: boolean;
  messages: ChatTurn[];
  lessons?: Lesson[];
  documents?: RagDocument[];
  now?: Date;
}): Promise<{
  messages: RecipeMessage[];
  prompt: string;
  answer: string;
  learnedFrom?: string;
  ragHits?: number;
}> {
  const latest = lastUserText(options.messages);
  const lessons = options.lessons ?? [];
  const documents = options.documents ?? [];
  const routedIntent: IntentId | null =
    options.activity === "preguntar" ? detectIntent(latest) : null;
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
    return wrap(options, notes, latest, answer, {
      learnedFrom: learned.id,
      badge: routedIntent ? intentLabel(routedIntent) : undefined,
    });
  }

  // Intenciones cotidianas / enlaces en Preguntar
  if (options.activity === "preguntar" && routedIntent) {
    if (routedIntent === "emergencia") {
      const tool = await handleEmergency(latest);
      return wrap(options, tool.notes, latest, tool.answer, { ragHits: 1 });
    }
    if (routedIntent === "cotidiano") {
      const tool = await handleDailyLife(latest);
      void engineLearnFromQuery(latest);
      return wrap(options, tool.notes, latest, tool.answer, { ragHits: 1 });
    }
    if (routedIntent === "proyecto") {
      const tool = await handleProject(latest);
      void engineLearnFromQuery(latest);
      return wrap(options, tool.notes, latest, tool.answer, { ragHits: 1 });
    }
    if (routedIntent === "enlace") {
      const url = extractUrls(latest)[0];
      const analyzed = url ? await analyzeAndLearnLink(url) : null;
      const answer = analyzed
        ? formatLinkAnswer(analyzed)
        : "No pude analizar el enlace. Arranca el motor Python.";
      return wrap(options, analyzed?.text?.slice(0, 1000) || "", latest, answer, { ragHits: 1 });
    }
  }

  if (options.activity === "investigar" || routedIntent === "investigar") {
    const tool = await researchBrief(latest, { documents, lessons });
    void engineLearnFromQuery(latest);
    const answer =
      routedIntent === "investigar" ? `_Herramienta: Investigar_\n\n${tool.answer}` : tool.answer;
    return wrap(options, tool.notes, latest, answer, {
      ragHits:
        tool.notes.includes("Contexto recuperado por RAG") || tool.answer.includes("Contexto RAG")
          ? 1
          : 0,
    });
  }

  const rag = await runRagPipeline({
    query: latest,
    activity: effectiveActivity,
    documents,
    lessons,
    includeLiveSources:
      effectiveActivity === "estudiar" ||
      effectiveActivity === "investigar" ||
      options.activity === "preguntar",
  });

  const tool = await runActivity(options.activity, latest);
  const notesParts = [tool.applicable && tool.notes ? tool.notes : "", rag.promptBlock].filter(Boolean);
  const notes = notesParts.join("\n\n").slice(0, 6000);
  const answer = rag.hits.length ? augmentAnswerWithRag(tool.answer, rag) : tool.answer;
  if (rag.hits.length) void engineLearnFromQuery(latest);

  return wrap(options, notes, latest, answer, { ragHits: rag.hits.length });
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
  _latest: string,
  answer: string,
  meta?: { learnedFrom?: string; ragHits?: number; badge?: string },
) {
  const finalAnswer = meta?.badge && !answer.includes("Herramienta:")
    ? `_Herramienta: ${meta.badge}_\n\n${answer}`
    : answer;
  const messages: RecipeMessage[] = [
    {
      role: "system",
      content: systemPrompt(ACTIVITY_MAP[options.activity], notes, options.now),
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
