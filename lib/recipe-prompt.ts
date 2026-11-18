import type { Effort, ModelId, RecipeMessage } from "@/lib/types";

/** Special tokens from deepseek-recipe 0.2.0 (`SpecialToken.default_str`). */
export const TOKEN = {
  bos: "<｜begin▁of▁sentence｜>",
  eos: "<｜end▁of▁sentence｜>",
  system: "<｜System｜>",
  user: "<｜User｜>",
  assistant: "<｜Assistant｜>",
  thinkStart: "<think>",
  thinkEnd: "</think>",
} as const;

const EFFORT_SCORE: Record<Effort, number> = { low: 50, high: 75, max: 100 };

/**
 * V4 thinking prefaces, copied from DeepseekV4Encoding in deepseek-recipe 0.2.0.
 * Low effort and non-thinking mode add no preface. High is also the default.
 */
const V4_HIGH =
  "Reasoning Effort: Absolute maximum with no shortcuts permitted.\n" +
  "You MUST be very thorough in your thinking and comprehensively decompose the problem to resolve the root cause, rigorously stress-testing your logic against all potential paths, edge cases, and adversarial scenarios.\n" +
  "Explicitly write out your entire deliberation process, documenting every intermediate step, considered alternative, and rejected hypothesis to ensure absolutely no assumption is left unchecked.\n\n";

const V4_MAX =
  "Reasoning Effort: Beyond maximum — exhaustive, relentless, and uncompromising.\n" +
  "You MUST reason with the utmost depth and rigor, leaving absolutely nothing to chance: exhaustively decompose the problem into its most fundamental components, trace every causal chain to its root, and resolve the underlying cause rather than any surface symptom.\n" +
  "Do not stop reasoning until you have independently verified the solution from multiple angles and are certain that no assumption remains unchecked and no error remains undiscovered.\n\n";

function flashEffortLine(effort: Effort): string {
  return `Reasoning Effort: ${EFFORT_SCORE[effort]} (range 1-100, the higher the value, the more thorough the reasoning)\n\n`;
}

/**
 * Render a text conversation the way deepseek-recipe 0.2.0 does for
 * DeepSeek-V4.1-Flash (`flash`) and DeepSeek-V4-Pro (`pro`).
 * Images, tools, and token ids are out of scope: this is the chat path.
 */
export function renderRecipePrompt(options: {
  model: ModelId;
  thinking: boolean;
  effort: Effort;
  messages: RecipeMessage[];
}): string {
  const systemText = options.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
  const dialog = options.messages.filter((message) => message.role !== "system");

  let prompt = TOKEN.bos;
  if (options.model === "flash") {
    if (options.thinking) {
      prompt += TOKEN.system + flashEffortLine(options.effort) + systemText;
    } else if (systemText) {
      prompt += TOKEN.system + systemText;
    }
  } else if (options.thinking && options.effort === "max") {
    prompt += V4_MAX + systemText;
  } else if (options.thinking && options.effort !== "low") {
    prompt += V4_HIGH + systemText;
  } else {
    prompt += systemText;
  }

  dialog.forEach((message, index) => {
    const last = index === dialog.length - 1;
    if (message.role === "user") {
      prompt += TOKEN.user + message.content;
      if (last) {
        prompt += TOKEN.assistant + (options.thinking ? TOKEN.thinkStart : TOKEN.thinkEnd);
      }
      return;
    }
    prompt += TOKEN.assistant + TOKEN.thinkEnd + message.content + TOKEN.eos;
  });

  return prompt;
}

export const PROMPT_TOKENS = [
  TOKEN.bos,
  TOKEN.eos,
  TOKEN.system,
  TOKEN.user,
  TOKEN.assistant,
  TOKEN.thinkEnd,
  TOKEN.thinkStart,
] as const;
