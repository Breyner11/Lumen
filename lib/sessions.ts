import type { ActivityId, StoredMessage } from "@/lib/types";
import { ACTIVITY_IDS } from "@/lib/types";

export type ChatSession = {
  id: string;
  title: string;
  updatedAt: number;
  messages: StoredMessage[];
};

const MAX_SESSIONS = 40;
const MAX_MESSAGES = 40;

export function createSessionId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptySession(): ChatSession {
  return {
    id: createSessionId(),
    title: "Chat nuevo",
    updatedAt: Date.now(),
    messages: [],
  };
}

export function titleFromMessages(messages: StoredMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUser) return "Chat nuevo";
  const text = firstUser.content.replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 45).trim()}…` : text;
}

export function sanitizeMessages(value: unknown): StoredMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (message): message is StoredMessage =>
        !!message &&
        typeof message === "object" &&
        ((message as StoredMessage).role === "user" || (message as StoredMessage).role === "assistant") &&
        typeof (message as StoredMessage).content === "string",
    )
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 12_000),
      reasoning: typeof message.reasoning === "string" ? message.reasoning.slice(0, 20_000) : undefined,
      mode: message.mode === "model" ? "model" : message.mode === "taller" ? "taller" : undefined,
      images: Array.isArray(message.images)
        ? message.images
            .filter((image) => image && typeof image.url === "string" && image.url.startsWith("http"))
            .slice(0, 3)
            .map((image) => ({
              url: image.url,
              title: typeof image.title === "string" ? image.title.slice(0, 120) : undefined,
            }))
        : undefined,
      sources: Array.isArray(message.sources)
        ? message.sources
            .filter((source) => source && typeof source.title === "string")
            .slice(0, 12)
            .map((source) => ({
              title: source.title.slice(0, 160),
              url: typeof source.url === "string" ? source.url.slice(0, 500) : "",
            }))
        : undefined,
    }));
}

export function sanitizeSessions(value: unknown): ChatSession[] {
  if (!Array.isArray(value)) return [];
  const clean: ChatSession[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    const messages = sanitizeMessages(row.messages);
    const title =
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim().slice(0, 80)
        : titleFromMessages(messages);
    const updatedAt =
      typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : Date.now();
    clean.push({
      id: row.id.slice(0, 80),
      title,
      updatedAt,
      messages,
    });
  }
  return clean
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
}

/** Migra el almacenamiento antiguo (un hilo por oficio) a sesiones de chat. */
export function sessionsFromThreads(
  threads: Partial<Record<ActivityId, StoredMessage[]>>,
): ChatSession[] {
  const sessions: ChatSession[] = [];
  for (const activity of ACTIVITY_IDS) {
    const messages = sanitizeMessages(threads[activity] ?? []);
    if (!messages.length) continue;
    sessions.push({
      id: createSessionId(),
      title: titleFromMessages(messages),
      updatedAt: Date.now() - sessions.length,
      messages,
    });
  }
  return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
}

export function ensureSessions(
  sessions: ChatSession[],
  activeId?: string | null,
): { sessions: ChatSession[]; activeId: string } {
  const list = sessions.length ? sessions : [createEmptySession()];
  const active = list.find((session) => session.id === activeId)?.id ?? list[0].id;
  return { sessions: list, activeId: active };
}
