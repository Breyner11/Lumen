import { ragEngineUrl } from "@/lib/rag/engine-client";

export type VisionSolveResult = {
  ok: boolean;
  image_id?: string;
  memory_id?: string;
  vision_model?: string;
  text?: string;
  latex?: string;
  result?: string;
  result_latex?: string;
  code?: string;
  steps?: string[];
  backend?: string;
  error?: string;
  hint?: string;
};

export type MathSolveResult = {
  ok: boolean;
  remembered?: boolean;
  latex?: string;
  result?: string;
  result_latex?: string;
  code?: string;
  steps?: string[];
  backend?: string;
  memory_id?: string;
  error?: string;
};

export async function engineMathSolve(problem: string, webContext = false): Promise<MathSolveResult | null> {
  try {
    const response = await fetch(`${ragEngineUrl()}/math/solve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ problem, web_context: webContext }),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    const json = (await response.json()) as MathSolveResult & { detail?: string };
    if (!response.ok) {
      return { ok: false, error: json.detail || json.error || "No resolví el problema." };
    }
    return json;
  } catch {
    return null;
  }
}

export async function engineVisionSolve(file: File | Blob, fileName = "problema.png"): Promise<VisionSolveResult | null> {
  try {
    const body = new FormData();
    body.append("file", file, fileName);
    body.append("web_context", "true");
    const response = await fetch(`${ragEngineUrl()}/vision/solve`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(180_000),
      cache: "no-store",
    });
    const json = (await response.json()) as VisionSolveResult & { detail?: string };
    if (!response.ok) {
      return { ok: false, error: typeof json.detail === "string" ? json.detail : json.error || "Visión no disponible." };
    }
    return json;
  } catch {
    return null;
  }
}

export function formatVisionAnswer(result: VisionSolveResult): string {
  if (!result.ok) {
    return [
      "**No pude resolver la imagen**",
      "",
      result.error || "Error desconocido.",
      result.hint ? `\n${result.hint}` : "",
      result.latex ? `\nLaTeX leído: \`$${result.latex}$\`` : "",
      result.text ? `\nLectura:\n${result.text}` : "",
    ].join("\n");
  }
  return [
    "**Problema desde imagen**",
    "",
    result.vision_model ? `_Visión: ${result.vision_model}_` : "",
    result.latex ? `\n**LaTeX:** \`$${result.latex}$\`` : "",
    result.text ? `\n${result.text}` : "",
    "",
    `**Resultado exacto (SymPy):** \`${result.result}\``,
    result.result_latex ? `\n$$${result.result_latex}$$` : "",
    "",
    "**Pasos**",
    "",
    ...(result.steps ?? []).map((step) => `- ${step}`),
    result.code ? `\n**Código:**\n\`\`\`python\n${result.code}\n\`\`\`` : "",
    result.memory_id ? `\n_Guardado en memoria: ${result.memory_id}_` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function formatMathEngineAnswer(result: MathSolveResult): string {
  if (!result.ok) {
    return result.error || "No resolví el problema con SymPy.";
  }
  return [
    result.remembered ? "_Lo resolví con un problema parecido que ya había aprendido._\n" : "",
    result.latex ? `**LaTeX:** \`$${result.latex}$\`\n` : "",
    `**Resultado exacto (SymPy):** \`${result.result}\``,
    result.result_latex ? `\n$$${result.result_latex}$$` : "",
    "",
    "**Pasos**",
    "",
    ...(result.steps ?? []).map((step) => `- ${step}`),
    result.code ? `\n**Código:**\n\`\`\`python\n${result.code}\n\`\`\`` : "",
  ].join("\n");
}
