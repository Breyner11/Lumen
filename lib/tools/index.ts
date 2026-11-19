import type { ActivityId } from "@/lib/types";
import { reviewCode } from "@/lib/tools/code";
import { solveMath } from "@/lib/tools/math";
import { organizePlan } from "@/lib/tools/plan";
import { researchBrief } from "@/lib/tools/research";
import { detectIntent, intentLabel } from "@/lib/tools/route";
import { studySession } from "@/lib/tools/study";
import { summarizeText } from "@/lib/tools/summarize";
import { prepareTranslation } from "@/lib/tools/translate";
import { reviewWriting } from "@/lib/tools/writing";

export type ToolResult = {
  applicable: boolean;
  answer: string;
  notes: string;
  routedTo?: ActivityId;
};

export async function runActivity(activity: ActivityId, input: string): Promise<ToolResult> {
  if (activity === "preguntar") {
    const routed = detectIntent(input);
    const result = await runActivity(routed, input);
    const badge = `_Herramienta: ${intentLabel(routed)}_`;
    return {
      applicable: result.applicable,
      answer: `${badge}\n\n${result.answer}`,
      notes: result.notes,
      routedTo: routed,
    };
  }

  switch (activity) {
    case "estudiar":
      return studySession(input);
    case "programar":
      return reviewCode(input);
    case "escribir":
      return reviewWriting(input);
    case "calcular": {
      const solved = solveMath(input);
      return {
        applicable: solved.applicable,
        answer: solved.answer,
        notes: solved.applicable ? solved.answer : "",
      };
    }
    case "organizar":
      return organizePlan(input);
    case "traducir":
      return prepareTranslation(input);
    case "resumir":
      return summarizeText(input);
    case "investigar":
      return researchBrief(input);
  }
}

export async function notesForModel(activity: ActivityId, input: string): Promise<string> {
  const result = await runActivity(activity, input);
  if (!result.applicable || !result.notes) return "";
  return result.notes.length > 4000 ? `${result.notes.slice(0, 4000)}…` : result.notes;
}
