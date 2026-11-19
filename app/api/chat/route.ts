import { connection } from "next/server";
import { requireIdentity } from "../../../cursor/identity";
import { MODEL_LABEL } from "@/lib/activities";
import { composeConversation } from "@/lib/compose";
import { parseChatRequest, upstreamBody } from "@/lib/chat-request";
import type { ChatRequest } from "@/lib/chat-request";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const WINDOW_MS = 60_000;
const LIMIT = 20;
const hits = new Map<string, number[]>();

function allow(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

function sse(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json(
      { error: "Inicia sesión en Cursor para usar Taller." },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (identity.kind !== "person") {
    return Response.json(
      { error: "Taller solo admite una sesión de persona." },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (!allow(identity.sub)) {
    return Response.json(
      { error: "Demasiadas peticiones. Espera un minuto y vuelve a intentar." },
      { status: 429, headers: { "cache-control": "private, no-store" } },
    );
  }

  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 80_000) {
      return Response.json({ error: "La petición es demasiado grande." }, { status: 413 });
    }
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "No pude leer el mensaje." }, { status: 400 });
  }
  const parsed = parseChatRequest(raw);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const { ollamaAvailable } = await import("@/lib/ollama");
  const localOllama = await ollamaAvailable(request.signal);
  const cloudReady = Boolean(process.env.DEEPSEEK_API_KEY);
  // Prioridad: Ollama local (deepseek-r1:1.5b, RAM limitada) → API cloud → herramientas taller.
  const stream = localOllama
    ? ollamaStream(parsed, request.signal)
    : cloudReady
      ? modelStream(parsed, request.signal)
      : await tallerStream(parsed);
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store",
      "x-accel-buffering": "no",
    },
  });
}

async function tallerStream(request: ChatRequest): Promise<ReadableStream<Uint8Array>> {
  const composed = await composeConversation({ ...request, now: new Date() });
  const parts = chunk(composed.answer, 80);
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(sse({ type: "content", text: part }));
      controller.enqueue(
        sse({
          type: "done",
          mode: "taller",
          model: MODEL_LABEL[request.model].api,
          learnedFrom: composed.learnedFrom ?? null,
          ragHits: composed.ragHits ?? 0,
        }),
      );
      controller.close();
    },
  });
}

function ollamaStream(request: ChatRequest, signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        const { OLLAMA_CHAT_MODEL, splitThink } = await import("@/lib/ollama");
        // composeConversation ya redacta con deepseek-r1:1.5b (contexto interno → respuesta limpia).
        const composed = await composeConversation({ ...request, now: new Date() });
        const split = splitThink(composed.answer || "");
        if (split.thinking) controller.enqueue(sse({ type: "reasoning", text: split.thinking }));
        for (const part of chunk(composed.answer || "No pude generar la respuesta.", 80)) {
          controller.enqueue(sse({ type: "content", text: part }));
        }
        controller.enqueue(
          sse({
            type: "done",
            mode: "taller",
            model: OLLAMA_CHAT_MODEL,
            ragHits: composed.ragHits ?? 0,
            learnedFrom: composed.learnedFrom ?? null,
          }),
        );
        controller.close();
      } catch {
        if (signal.aborted) {
          controller.close();
          return;
        }
        const composed = await composeConversation({ ...request, now: new Date() }).catch(() => null);
        const text = composed?.answer || "No pude hablar con Ollama. Revisa que esté en marcha.";
        for (const part of chunk(text, 80)) controller.enqueue(sse({ type: "content", text: part }));
        controller.enqueue(sse({ type: "done", mode: "taller", model: "taller" }));
        controller.close();
      }
    },
  });
}

function modelStream(request: ChatRequest, signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        const body = await upstreamBody(request, new Date());
        const upstream = await fetch(DEEPSEEK_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.any([AbortSignal.timeout(90_000), signal]),
        });
        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => "");
          controller.enqueue(sse({ type: "error", message: publicUpstreamError(upstream.status, detail) }));
          controller.close();
          return;
        }
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sawText = false;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let payload: unknown;
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }
            const delta = readDelta(payload);
            if (delta.reasoning) {
              sawText = true;
              controller.enqueue(sse({ type: "reasoning", text: delta.reasoning }));
            }
            if (delta.content) {
              sawText = true;
              controller.enqueue(sse({ type: "content", text: delta.content }));
            }
            const message = readError(payload);
            if (message) controller.enqueue(sse({ type: "error", message }));
          }
        }
        if (!sawText) {
          controller.enqueue(sse({ type: "content", text: "El modelo no devolvió texto." }));
        }
        controller.enqueue(sse({ type: "done", mode: "model", model: MODEL_LABEL[request.model].api }));
        controller.close();
      } catch {
        if (signal.aborted) {
          controller.close();
          return;
        }
        controller.enqueue(sse({ type: "error", message: "No pude llegar a DeepSeek. Intenta de nuevo en un momento." }));
        controller.close();
      }
    },
  });
}

function readDelta(payload: unknown): { content: string; reasoning: string } {
  if (!payload || typeof payload !== "object") return { content: "", reasoning: "" };
  const choices = (payload as { choices?: unknown }).choices;
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  if (!choice || typeof choice !== "object") return { content: "", reasoning: "" };
  const delta = (choice as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") return { content: "", reasoning: "" };
  const record = delta as { content?: unknown; reasoning_content?: unknown };
  return {
    content: typeof record.content === "string" ? record.content : "",
    reasoning: typeof record.reasoning_content === "string" ? record.reasoning_content : "",
  };
}

function readError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? redact(message).slice(0, 300) : "DeepSeek rechazó la petición.";
}

function publicUpstreamError(status: number, detail: string): string {
  if (status === 401 || status === 403) return "DeepSeek no aceptó la clave. Revísala en los secretos de la app.";
  if (status === 429) return "DeepSeek está limitando las peticiones. Espera un momento.";
  let message = "";
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    message = parsed.error?.message ?? "";
  } catch {
    message = "";
  }
  if (message) return redact(message).slice(0, 300);
  return "DeepSeek no pudo responder esta vez.";
}

function redact(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "Bearer …").replace(/\bsk-[A-Za-z0-9_-]+\b/g, "sk-…");
}

function chunk(text: string, size: number): string[] {
  if (!text) return [""];
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) parts.push(text.slice(index, index + size));
  return parts;
}
