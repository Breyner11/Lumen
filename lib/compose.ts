import { ACTIVITY_MAP, systemPrompt } from "@/lib/activities";
import { renderRecipePrompt } from "@/lib/recipe-prompt";
import { runActivity } from "@/lib/tools";
import type { ActivityId, ChatTurn, Effort, ModelId, RecipeMessage } from "@/lib/types";

export function lastUserText(messages: ChatTurn[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") return messages[index].content;
  }
  return "";
}

export async function composeConversation(options: {
  activity: ActivityId;
  model: ModelId;
  effort: Effort;
  thinking: boolean;
  messages: ChatTurn[];
  now?: Date;
}): Promise<{ messages: RecipeMessage[]; prompt: string; answer: string }> {
  const latest = lastUserText(options.messages);
  const tool = await runActivity(options.activity, latest);
  const notes =
    tool.applicable && tool.notes
      ? tool.notes.length > 4000
        ? `${tool.notes.slice(0, 4000)}…`
        : tool.notes
      : "";
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
    answer: tool.answer,
  };
}
