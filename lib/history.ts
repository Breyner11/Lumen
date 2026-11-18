import type { ActivityId } from "@/lib/types";
import { ACTIVITY_IDS } from "@/lib/types";

export type HistoryEntry = {
  id: string;
  activity: ActivityId;
  query: string;
  preview: string;
  at: number;
};

const MAX_ENTRIES = 40;

export function createHistoryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function pushHistory(
  entries: HistoryEntry[],
  next: Omit<HistoryEntry, "id" | "at"> & { id?: string; at?: number },
): HistoryEntry[] {
  const query = next.query.trim();
  if (!query) return entries;
  const entry: HistoryEntry = {
    id: next.id ?? createHistoryId(),
    activity: next.activity,
    query: query.slice(0, 500),
    preview: next.preview.slice(0, 280),
    at: next.at ?? Date.now(),
  };
  const withoutDup = entries.filter(
    (item) => !(item.activity === entry.activity && item.query === entry.query),
  );
  return [entry, ...withoutDup].slice(0, MAX_ENTRIES);
}

export function sanitizeHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const clean: HistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    if (!ACTIVITY_IDS.includes(row.activity as ActivityId)) continue;
    if (typeof row.query !== "string" || !row.query.trim()) continue;
    if (typeof row.preview !== "string") continue;
    if (typeof row.at !== "number" || !Number.isFinite(row.at)) continue;
    clean.push({
      id: row.id.slice(0, 64),
      activity: row.activity as ActivityId,
      query: row.query.slice(0, 500),
      preview: row.preview.slice(0, 280),
      at: row.at,
    });
  }
  return clean.slice(0, MAX_ENTRIES);
}

export function formatHistoryTime(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "short",
  }).format(new Date(at));
}
