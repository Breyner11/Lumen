import { ACTIVITY_MAP, systemPrompt } from "@/lib/activities";
import { findLesson, formatLessonAnswer, type Lesson } from "@/lib/lessons";
import { augmentAnswerWithRag } from "@/lib/rag/augment";
import { runRagPipeline } from "@/lib/rag/pipeline";
import type { RagDocument } from "@/lib/rag/types";
import { renderRecipePrompt } from "@/lib/recipe-prompt";
import { researchBrief } from "@/lib/tools/research";
import { detectIntent, intentLabel, type SpecialtyId } from "@/lib/tools/route";
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
  const routedSpecialty: SpecialtyId | null =
    options.activity === "preguntar" ? detectIntent(latest) : null;
  const effectiveActivity: ActivityId = routedSpecialty ?? options.activity;
  const learned =
    findLesson(lessons, options.activity, latest) ??
    (routedSpecialty ? findLesson(lessons, routedSpecialty, latest) : null);
  if (learned) {
    const answer = formatLessonAnswer(learned);
    const notes = `Lección aprendida (${learned.id}): usar la corrección guardada para esta pregunta.`;
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
      answer: routedSpecialty
        ? `_Herramienta: ${intentLabel(routedSpecialty)}_\n\n${answer}`
        : answer,
      learnedFrom: learned.id,
    };
  }

  if (options.activity === "investigar" || routedSpecialty === "investigar") {
    const tool = await researchBrief(latest, { documents, lessons });
    const answer = routedSpecialty
      ? `_Herramienta: Investigar_\n\n${tool.answer}`
      : tool.answer;
    const messages: RecipeMessage[] = [
      {
        role: "system",
        content: systemPrompt(ACTIVITY_MAP[options.activity], tool.notes, options.now),
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
      answer,
      ragHits: tool.notes.includes("Contexto recuperado por RAG") || tool.answer.includes("Contexto RAG")
        ? 1
        : 0,
    };
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
    answer,
    ragHits: rag.hits.length,
  };
}
