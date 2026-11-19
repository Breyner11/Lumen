/** Cliente Ollama: chat con deepseek-r1:1.5b, RAM ~8 GB. */

export const OLLAMA_CHAT_TIMEOUT_MS = 180_000;
export const OLLAMA_CHAT_KEEP_ALIVE = "5m";

export function ollamaUrl(): string {
  // 127.0.0.1 evita fallos de IPv6 con "localhost" (p. ej. en Windows).
  const raw = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").trim();
  return raw.replace(/\/$/, "").replace(/:\/\/localhost(?=[:/]|$)/i, "://127.0.0.1");
}

/** @deprecated Prefer ollamaUrl() para respetar cambios de entorno en runtime. */
export const OLLAMA_URL = ollamaUrl();
export const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL?.trim() || "deepseek-r1:1.5b";
export const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL?.trim() || "qwen2.5vl:3b";
export const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL?.trim() || "nomic-embed-text";

/** Opciones base: equilibrio entre detalle y tiempo de respuesta. */
export const OLLAMA_OPTIONS = {
  num_ctx: 3072,
  num_thread: 4,
  num_predict: 700,
} as const;

export function withOllamaLimits<T extends Record<string, unknown>>(
  payload: T,
  keepAlive: string | number = OLLAMA_CHAT_KEEP_ALIVE,
): T & {
  keep_alive: string | number;
  options: { num_ctx: number; num_thread: number; num_predict: number };
} {
  return {
    ...payload,
    keep_alive: keepAlive,
    options: {
      ...OLLAMA_OPTIONS,
      ...((payload.options as Record<string, number> | undefined) ?? {}),
    },
  };
}

export async function ollamaAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${ollamaUrl()}/api/tags`, {
      signal: signal ?? AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listOllamaModels(signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch(`${ollamaUrl()}/api/tags`, {
      signal: signal ?? AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const json = (await response.json()) as { models?: Array<{ name?: string }> };
    return (json.models ?? []).map((item) => item.name || "").filter(Boolean);
  } catch {
    return [];
  }
}

export function modelIsInstalled(models: string[], wanted: string): boolean {
  const target = wanted.toLowerCase();
  return models.some((name) => {
    const lower = name.toLowerCase();
    return lower === target || lower.startsWith(`${target}:`) || lower.startsWith(target);
  });
}

export async function ensureChatModel(signal?: AbortSignal): Promise<{
  ok: boolean;
  model: string;
  models: string[];
  error?: string;
}> {
  const model = OLLAMA_CHAT_MODEL;
  const url = ollamaUrl();
  try {
    const response = await fetch(`${url}/api/tags`, {
      signal: signal ?? AbortSignal.timeout(5_000),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        model,
        models: [],
        error: `No pude leer ${url}/api/tags (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }
    const json = (await response.json()) as { models?: Array<{ name?: string }> };
    const models = (json.models ?? []).map((item) => item.name || "").filter(Boolean);
    if (!modelIsInstalled(models, model)) {
      return {
        ok: false,
        model,
        models,
        error: [
          `El modelo «${model}» no está instalado en Ollama (${url}).`,
          models.length ? `Modelos disponibles: ${models.join(", ")}.` : "No hay modelos instalados.",
          `Instálalo con: ollama pull ${model}`,
        ].join(" "),
      };
    }
    return { ok: true, model, models };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    return {
      ok: false,
      model,
      models: [],
      error: `Ollama no responde en ${url} (${detail}). Arranca el servicio y vuelve a intentar.`,
    };
  }
}

export async function ollamaChat(options: {
  prompt: string;
  system?: string;
  model?: string;
  signal?: AbortSignal;
  /** Por defecto fuerza español; usa "translate" solo en el oficio Traducir. */
  languageMode?: "spanish" | "translate";
  /** keep_alive: "5m" en chat normal; 0 solo para liberar visión. */
  keepAlive?: string | number;
  timeoutMs?: number;
  /** Desactiva el bloque thinking de R1 cuando el runtime lo permite. */
  think?: boolean;
  numPredict?: number;
  numCtx?: number;
}): Promise<{ ok: boolean; text: string; thinking?: string; model: string; error?: string }> {
  const model = options.model ?? OLLAMA_CHAT_MODEL;
  const url = ollamaUrl();
  const timeoutMs = options.timeoutMs ?? OLLAMA_CHAT_TIMEOUT_MS;
  const keepAlive = options.keepAlive ?? OLLAMA_CHAT_KEEP_ALIVE;

  const ensured = await ensureChatModel(options.signal);
  if (!ensured.ok) {
    console.error("[taller/ollama]", ensured.error);
    return { ok: false, text: "", model, error: ensured.error };
  }

  const languageLine =
    options.languageMode === "translate"
      ? "Modo traducción: traduce según lo pedido entre español e inglés."
      : "OBLIGATORIO: responde siempre en español.";
  const system = [options.system, languageLine].filter(Boolean).join("\n");
  const messages = [
    ...(system ? [{ role: "system", content: system }] : []),
    { role: "user", content: options.prompt },
  ];
  try {
    const response = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        withOllamaLimits(
          {
            model,
            stream: false,
            // deepseek-r1: acorta el razonamiento para no agotar el timeout.
            think: options.think ?? false,
            messages,
            options: {
              ...(typeof options.numPredict === "number" ? { num_predict: options.numPredict } : {}),
              ...(typeof options.numCtx === "number" ? { num_ctx: options.numCtx } : {}),
            },
          },
          keepAlive,
        ),
      ),
      signal: options.signal ?? AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const error = `Ollama HTTP ${response.status} en ${url}/api/chat (${model})${detail ? `: ${detail.slice(0, 400)}` : ""}`;
      console.error("[taller/ollama]", error);
      return { ok: false, text: "", model, error };
    }
    const json = (await response.json()) as {
      message?: { content?: string; thinking?: string };
      response?: string;
    };
    const raw = (json.message?.content || json.response || "").trim();
    const thinkingField = json.message?.thinking?.trim();
    if (!raw && !thinkingField) {
      const error = `Ollama devolvió una respuesta vacía (${model} @ ${url})`;
      console.error("[taller/ollama]", error);
      return { ok: false, text: "", model, error };
    }
    const split = splitThink(raw || "");
    const text = split.content || extractAnswerFromThinking(thinkingField || split.thinking || "");
    if (!text.trim()) {
      const error = `Ollama no dejó texto útil tras razonar (${model} @ ${url})`;
      console.error("[taller/ollama]", error);
      return { ok: false, text: "", model, error };
    }
    return {
      ok: true,
      text: text.trim(),
      thinking: thinkingField || split.thinking,
      model,
    };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    const timedOut = /abort|timeout/i.test(detail);
    const error = timedOut
      ? `Tiempo de espera agotado (${timeoutMs} ms) al llamar a ${url}/api/chat con ${model}. ${detail}`
      : `Fallo al llamar a ${url}/api/chat con ${model}: ${detail}`;
    console.error("[taller/ollama]", error);
    return { ok: false, text: "", model, error };
  }
}

export function splitThink(text: string): { thinking?: string; content: string } {
  const match = /<think>([\s\S]*?)<\/think>/i.exec(text);
  if (!match) return { content: text.trim() };
  const thinking = match[1]?.trim();
  const content = text.replace(match[0], "").trim();
  return { thinking: thinking || undefined, content };
}

/** Si el modelo solo dejó thinking, intenta sacar la última conclusión usable. */
function extractAnswerFromThinking(thinking: string): string {
  const lines = thinking
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const last = lines.slice(-4).join(" ");
  return last.slice(0, 600);
}

export function formatOllamaErrorForUser(error: string | undefined, model = OLLAMA_CHAT_MODEL): string {
  const detail = (error || "error desconocido").trim();
  return [
    "No pude completar la respuesta con DeepSeek en Ollama.",
    "",
    `**Detalle:** ${detail}`,
    "",
    "**Qué revisar:**",
    `- Que Ollama esté en marcha en \`${ollamaUrl()}\``,
    `- Que exista el modelo: \`ollama pull ${model}\``,
    "- Si el modelo está ocupado, espera unos segundos y vuelve a intentar",
  ].join("\n");
}
