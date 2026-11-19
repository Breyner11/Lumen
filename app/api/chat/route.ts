import { connection } from "next/server";
import { requireIdentity } from "../../../cursor/identity";
import { composeConversation, type ComposeResult } from "@/lib/compose";
import { parseChatRequest } from "@/lib/chat-request";
import type { ChatRequest } from "@/lib/chat-request";

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

function emitComposed(
  controller: ReadableStreamDefaultController<Uint8Array>,
  composed: ComposeResult,
  model: string,
) {
  if (composed.thinking) {
    controller.enqueue(sse({ type: "reasoning", text: composed.thinking }));
  }
  const text = composed.answer || "No pude generar la respuesta.";
  for (const part of chunk(text, 80)) {
    controller.enqueue(sse({ type: "content", text: part }));
  }
  controller.enqueue(
    sse({
      type: "done",
      mode: "taller",
      model,
      learnedFrom: composed.learnedFrom ?? null,
      ragHits: composed.ragHits ?? 0,
      images: composed.images ?? [],
      sources: composed.sources ?? [],
    }),
  );
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

  const stream = composeStream(parsed, request.signal);
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "private, no-store",
      "x-accel-buffering": "no",
    },
  });
}

function composeStream(request: ChatRequest, signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        const { OLLAMA_CHAT_MODEL, formatOllamaErrorForUser, ensureChatModel } = await import(
          "@/lib/ollama"
        );
        const readiness = await ensureChatModel(signal);
        if (!readiness.ok) {
          console.error("[taller/chat] Ollama no listo:", readiness.error);
          controller.enqueue(
            sse({
              type: "content",
              text: formatOllamaErrorForUser(readiness.error, readiness.model),
            }),
          );
          controller.enqueue(
            sse({
              type: "done",
              mode: "taller",
              model: readiness.model,
              images: [],
              sources: [],
            }),
          );
          controller.close();
          return;
        }
        const composed = await composeConversation({ ...request, now: new Date() });
        if (signal.aborted) {
          controller.close();
          return;
        }
        emitComposed(controller, composed, OLLAMA_CHAT_MODEL);
        controller.close();
      } catch (caught) {
        if (signal.aborted) {
          controller.close();
          return;
        }
        const detail = caught instanceof Error ? caught.message : String(caught);
        console.error("[taller/chat] error al componer:", detail);
        const { formatOllamaErrorForUser, OLLAMA_CHAT_MODEL } = await import("@/lib/ollama");
        controller.enqueue(
          sse({
            type: "content",
            text: formatOllamaErrorForUser(detail, OLLAMA_CHAT_MODEL),
          }),
        );
        controller.enqueue(
          sse({
            type: "done",
            mode: "taller",
            model: OLLAMA_CHAT_MODEL,
            images: [],
            sources: [],
          }),
        );
        controller.close();
      }
    },
  });
}

function chunk(text: string, size: number): string[] {
  if (!text) return [""];
  const parts: string[] = [];
  for (let index = 0; index < text.length; index += size) parts.push(text.slice(index, index + size));
  return parts;
}
