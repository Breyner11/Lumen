/** Exportación / importación local de chats, tareas, memoria y documentos. */

import type { ChatSession } from "@/lib/sessions";
import type { Lesson } from "@/lib/lessons";
import type { RagDocument } from "@/lib/rag/types";
import type { UserMemory } from "@/lib/user-memory";
import type { AssistantTask } from "@/lib/tools/assistant";

export type LumenBackup = {
  version: 1;
  exportedAt: string;
  app: "lumen";
  privacy: "local-only";
  sessions: ChatSession[];
  lessons: Lesson[];
  documents: RagDocument[];
  memory: UserMemory;
  tasks: AssistantTask[];
  settings?: Record<string, unknown>;
};

export function buildBackup(payload: Omit<LumenBackup, "version" | "exportedAt" | "app" | "privacy">): LumenBackup {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: "lumen",
    privacy: "local-only",
    ...payload,
  };
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseBackup(raw: string): LumenBackup | { error: string } {
  try {
    const json = JSON.parse(raw) as Partial<LumenBackup>;
    if (json.app !== "lumen" || json.version !== 1) {
      return { error: "El archivo no es una copia de Lumen v1." };
    }
    return json as LumenBackup;
  } catch {
    return { error: "No pude leer el archivo JSON." };
  }
}
