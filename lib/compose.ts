import { ACTIVITY_MAP, systemPrompt } from "@/lib/activities";
import { findLesson, formatLessonAnswer, type Lesson } from "@/lib/lessons";
import { engineLearnNow, engineRememberLesson } from "@/lib/rag/engine-client";
import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument } from "@/lib/rag/types";
import { renderRecipePrompt } from "@/lib/recipe-prompt";
import { detectAnswerStyle } from "@/lib/style";
import { handleDailyLife, handleEmergency, handleProject } from "@/lib/tools/everyday";
import { analyzeAndLearnLink, extractUrls, formatLinkAnswer } from "@/lib/tools/links";
import { polishAnswer } from "@/lib/tools/polish";
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
  const style = detectAnswerStyle(options.messages);
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
    const polished =
      languageMode === "translate"
        ? answer
        : await polishAnswer({
            question: latest,
            context: answer,
            messages: options.messages,
            style,
          });
    return wrap(options, notes, polished, {
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
      return wrap(options, tool.notes, polished, { ragHits: 1, languageMode });
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
      return wrap(options, analyzed?.text?.slice(0, 1000) || "", polished, {
        ragHits: 1,
        languageMode,
      });
    }
  }

  if (options.activity === "investigar" || routedIntent === "investigar") {
    const tool = await researchBrief(latest, {
      documents,
      lessons,
      messages: options.messages,
    });
    void engineLearnFromQuery(latest);
    const answer =
      routedIntent === "investigar" && !tool.answer.includes("Herramienta:")
        ? `_Herramienta: Investigar_\n\n${tool.answer}`
        : tool.answer;
    return wrap(options, tool.notes, answer, {
      ragHits: tool.notes.includes("Contexto recuperado") || tool.applicable ? 1 : 0,
      languageMode,
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

  const shouldPolish =
    languageMode === "spanish" &&
    (options.activity === "preguntar" ||
      options.activity === "estudiar" ||
      options.activity === "escribir" ||
      options.activity === "resumir" ||
      options.activity === "organizar" ||
      rag.hits.length > 0);

  const answer = shouldPolish
    ? await polishAnswer({
        question: latest,
        context: [tool.answer, rag.answerBlock].filter(Boolean).join("\n\n"),
        messages: options.messages,
        style,
        images: rag.images,
        sources: rag.sources,
      })
    : tool.answer;

  if (rag.hits.length) void engineLearnFromQuery(latest);

  return wrap(options, notes, answer, { ragHits: rag.hits.length, languageMode });
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
  },
) {
  const finalAnswer =
    meta?.badge && !answer.includes("Herramienta:")
      ? `_Herramienta: ${meta.badge}_\n\n${answer}`
      : answer;
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
