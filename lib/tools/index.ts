import type { ActivityId } from "@/lib/types";
import { reviewCode } from "@/lib/tools/code";
import { handleDailyLife, handleEmergency, handleProject } from "@/lib/tools/everyday";
import { analyzeAndLearnLink, extractUrls, formatLinkAnswer } from "@/lib/tools/links";
import { solveMath } from "@/lib/tools/math";
import { handleAssistantIntent, type AssistantTask } from "@/lib/tools/assistant";
import { organizePlan } from "@/lib/tools/plan";
import { researchBrief } from "@/lib/tools/research";
import { detectIntent, intentLabel, isSpecialtyIntent } from "@/lib/tools/route";
import { studySession } from "@/lib/tools/study";
import { summarizeText } from "@/lib/tools/summarize";
import { prepareTranslation } from "@/lib/tools/translate";
import { reviewWriting } from "@/lib/tools/writing";

export type ToolResult = {
  applicable: boolean;
  answer: string;
  notes: string;
  routedTo?: string;
  tasks?: AssistantTask[];
  pendingConfirm?: string;
};

export async function runActivity(
  activity: ActivityId,
  input: string,
  options?: { tasks?: AssistantTask[]; webSearch?: boolean | "auto"; ollamaModel?: string },
): Promise<ToolResult> {
  if (activity === "preguntar") {
    const routed = detectIntent(input);
    if (routed === "emergencia") {
      const result = await handleEmergency(input);
      return { ...result, routedTo: routed };
    }
    if (routed === "cotidiano") {
      const result = await handleDailyLife(input);
      return { ...result, routedTo: routed };
    }
    if (routed === "proyecto") {
      const result = await handleProject(input);
      return { ...result, routedTo: routed };
    }
    if (routed === "enlace") {
      const url = extractUrls(input)[0];
      if (!url) {
        return {
          applicable: false,
          answer: "No encontré un enlace válido.",
          notes: "",
          routedTo: routed,
        };
      }
      const analyzed = await analyzeAndLearnLink(url);
      if (!analyzed) {
        return {
          applicable: false,
          answer:
            "El motor Python no está disponible para analizar el enlace. Arranca `npm run rag:engine`.",
          notes: "",
          routedTo: routed,
        };
      }
      return {
        applicable: analyzed.ok,
        answer: formatLinkAnswer(analyzed),
        notes: analyzed.text?.slice(0, 1500) || "",
        routedTo: routed,
      };
    }
    if (isSpecialtyIntent(routed)) {
      const result = await runActivity(routed, input);
      const badge = `_Herramienta: ${intentLabel(routed)}_`;
      return {
        applicable: result.applicable,
        answer: result.answer.includes("Herramienta:") ? result.answer : `${badge}\n\n${result.answer}`,
        notes: result.notes,
        routedTo: routed,
      };
    }
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
    case "organizar": {
      const assistant = handleAssistantIntent(input, options?.tasks ?? []);
      if (assistant.applicable) {
        return {
          applicable: true,
          answer: assistant.answer,
          notes: "",
          tasks: assistant.tasks,
          pendingConfirm: assistant.pending?.detail,
        };
      }
      return organizePlan(input);
    }
    case "traducir":
      return prepareTranslation(input);
    case "resumir":
      return summarizeText(input);
    case "investigar":
      return researchBrief(input, {
        webSearch: options?.webSearch ?? false,
        ollamaModel: options?.ollamaModel,
      });
    case "preguntar":
      return researchBrief(input, {
        webSearch: options?.webSearch ?? false,
        ollamaModel: options?.ollamaModel,
      });
  }
}

export async function notesForModel(activity: ActivityId, input: string): Promise<string> {
  const result = await runActivity(activity, input);
  if (!result.applicable || !result.notes) return "";
  return result.notes.length > 4000 ? `${result.notes.slice(0, 4000)}…` : result.notes;
}
