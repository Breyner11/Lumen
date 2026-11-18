import { MODEL_LABEL } from "@/lib/activities";
import { composeConversation } from "@/lib/compose";
import type { ActivityId, ChatTurn, Effort, ModelId } from "@/lib/types";
import { ACTIVITY_IDS, EFFORTS, MODEL_IDS } from "@/lib/types";

const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_TOTAL_CHARS = 48_000;

export type ChatRequest = {
  activity: ActivityId;
  model: ModelId;
  effort: Effort;
  thinking: boolean;
  messages: ChatTurn[];
};

export function parseChatRequest(body: unknown): ChatRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "El cuerpo de la petición no es válido." };
  const record = body as Record<string, unknown>;
  if (!ACTIVITY_IDS.includes(record.activity as ActivityId)) {
    return { error: "Ese oficio no existe." };
  }
  if (!MODEL_IDS.includes(record.model as ModelId)) return { error: "Ese modelo no está disponible." };
  if (!EFFORTS.includes(record.effort as Effort)) return { error: "Ese esfuerzo no está disponible." };
  if (typeof record.thinking !== "boolean") return { error: "Falta indicar si el pensamiento está activo." };
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    return { error: "Escribe un mensaje antes de enviarlo." };
  }
  if (record.messages.length > MAX_MESSAGES) {
    return { error: `Esta conversación ya tiene ${MAX_MESSAGES} mensajes. Empieza una nueva.` };
  }
  let total = 0;
  const messages: ChatTurn[] = [];
  for (const item of record.messages) {
    if (!item || typeof item !== "object") return { error: "Hay un mensaje ilegible." };
    const turn = item as Record<string, unknown>;
    if (turn.role !== "user" && turn.role !== "assistant") {
      return { error: "Solo se aceptan mensajes de la persona y del taller." };
    }
    if (typeof turn.content !== "string") return { error: "Hay un mensaje sin texto." };
    if (turn.content.length > MAX_MESSAGE_CHARS) {
      return { error: "Un mensaje pasa de 12.000 caracteres. Córtale un trozo." };
    }
    total += turn.content.length;
    messages.push({ role: turn.role, content: turn.content });
  }
  if (total > MAX_TOTAL_CHARS) return { error: "La conversación es demasiado larga. Empieza una nueva." };
  if (messages[messages.length - 1]?.role !== "user") {
    return { error: "El último mensaje tiene que ser tuyo." };
  }
  return {
    activity: record.activity as ActivityId,
    model: record.model as ModelId,
    effort: record.effort as Effort,
    thinking: record.thinking as boolean,
    messages,
  };
}

export async function upstreamBody(request: ChatRequest, now: Date): Promise<Record<string, unknown>> {
  const composed = await composeConversation({ ...request, now });
  return {
    model: MODEL_LABEL[request.model].api,
    messages: composed.messages.map((message) => ({ role: message.role, content: message.content })),
    thinking: { type: request.thinking ? "enabled" : "disabled" },
    reasoning_effort: request.thinking ? request.effort : "none",
    stream: true,
    max_tokens: request.thinking ? (request.effort === "max" ? 8192 : 4096) : 2048,
    ...(request.thinking ? {} : { temperature: 0.7 }),
  };
}

