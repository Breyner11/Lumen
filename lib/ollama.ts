/** Opciones Ollama para no superar ~8 GB de RAM. */

export const OLLAMA_URL = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
export const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL?.trim() || "deepseek-r1:1.5b";
export const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL?.trim() || "qwen2.5vl:3b";
export const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL?.trim() || "nomic-embed-text";

export const OLLAMA_OPTIONS = {
  num_ctx: 4096,
  num_thread: 4,
} as const;

export function withOllamaLimits<T extends Record<string, unknown>>(payload: T): T & {
  keep_alive: 0;
  options: { num_ctx: number; num_thread: number };
} {
  return {
    ...payload,
    keep_alive: 0,
    options: {
      ...OLLAMA_OPTIONS,
      ...((payload.options as Record<string, number> | undefined) ?? {}),
    },
  };
}

export async function ollamaAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: signal ?? AbortSignal.timeout(2000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ollamaChat(options: {
  prompt: string;
  system?: string;
  model?: string;
  signal?: AbortSignal;
  /** Por defecto fuerza español; usa "translate" solo en el oficio Traducir. */
  languageMode?: "spanish" | "translate";
}): Promise<{ ok: boolean; text: string; thinking?: string; model: string }> {
  const model = options.model ?? OLLAMA_CHAT_MODEL;
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
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        withOllamaLimits({
          model,
          stream: false,
          messages,
        }),
      ),
      signal: options.signal ?? AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, text: "", model };
    const json = (await response.json()) as {
      message?: { content?: string; thinking?: string };
      response?: string;
    };
    const raw = (json.message?.content || json.response || "").trim();
    const split = splitThink(raw);
    return {
      ok: Boolean(raw),
      text: split.content,
      thinking: json.message?.thinking || split.thinking,
      model,
    };
  } catch {
    return { ok: false, text: "", model };
  }
}

export function splitThink(text: string): { thinking?: string; content: string } {
  const match = /<think>([\s\S]*?)<\/think>/i.exec(text);
  if (!match) return { content: text.trim() };
  const thinking = match[1]?.trim();
  const content = text.replace(match[0], "").trim();
  return { thinking: thinking || undefined, content };
}
