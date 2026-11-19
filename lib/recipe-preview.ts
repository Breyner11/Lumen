import { ACTIVITY_MAP, systemPrompt } from "@/lib/activities";
import { renderRecipePrompt } from "@/lib/recipe-prompt";
import type { ActivityId, ChatTurn, Effort, ModelId } from "@/lib/types";

/** Builds the DeepSeek recipe prompt without running tools (safe for the browser). */
export function composeRecipePreview(options: {
  activity: ActivityId;
  model: ModelId;
  effort: Effort;
  thinking: boolean;
  messages: ChatTurn[];
}): string {
  const languageMode = options.activity === "traducir" ? "translate" : "spanish";
  const messages = [
    {
      role: "system" as const,
      content: systemPrompt(ACTIVITY_MAP[options.activity], "", new Date(0), languageMode),
    },
    ...options.messages,
  ];
  return renderRecipePrompt({
    model: options.model,
    effort: options.effort,
    thinking: options.thinking,
    messages,
  });
}
