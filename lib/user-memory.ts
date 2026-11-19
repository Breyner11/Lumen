/** Memoria local del usuario (nombre, programa, entregas). Todo en el dispositivo. */

export type UserDeadline = {
  id: string;
  title: string;
  dueAt: string; // ISO date YYYY-MM-DD
  notes?: string;
};

export type UserMemory = {
  name: string;
  program: string;
  deadlines: UserDeadline[];
  updatedAt: number;
};

export const EMPTY_USER_MEMORY: UserMemory = {
  name: "",
  program: "",
  deadlines: [],
  updatedAt: 0,
};

export function sanitizeUserMemory(value: unknown): UserMemory {
  if (!value || typeof value !== "object") return { ...EMPTY_USER_MEMORY };
  const row = value as Record<string, unknown>;
  const deadlines: UserDeadline[] = [];
  if (Array.isArray(row.deadlines)) {
    for (const item of row.deadlines) {
      if (!item || typeof item !== "object") continue;
      const d = item as Record<string, unknown>;
      if (typeof d.id !== "string" || typeof d.title !== "string") continue;
      if (typeof d.dueAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d.dueAt)) continue;
      deadlines.push({
        id: d.id.slice(0, 64),
        title: d.title.trim().slice(0, 160),
        dueAt: d.dueAt,
        notes: typeof d.notes === "string" ? d.notes.trim().slice(0, 400) : undefined,
      });
    }
  }
  return {
    name: typeof row.name === "string" ? row.name.trim().slice(0, 80) : "",
    program: typeof row.program === "string" ? row.program.trim().slice(0, 120) : "",
    deadlines: deadlines.slice(0, 40),
    updatedAt: typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
  };
}

export function formatMemoryForPrompt(memory: UserMemory): string {
  const parts: string[] = [];
  if (memory.name) parts.push(`Nombre del usuario: ${memory.name}`);
  if (memory.program) parts.push(`Programa / carrera: ${memory.program}`);
  if (memory.deadlines.length) {
    const lines = memory.deadlines
      .slice()
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .slice(0, 12)
      .map((d) => `- ${d.dueAt}: ${d.title}${d.notes ? ` (${d.notes})` : ""}`);
    parts.push(`Entregas próximas:\n${lines.join("\n")}`);
  }
  return parts.join("\n");
}

export function createDeadlineId(): string {
  return `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
