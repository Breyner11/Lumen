import { formatRagContext } from "@/lib/rag/augment";
import { buildRagIndex, searchRagIndex } from "@/lib/rag/index";
import type { RagContext, RagDocument } from "@/lib/rag/types";
import type { Lesson } from "@/lib/lessons";
import { gatherSources, type SourceHit } from "@/lib/tools/sources";
import type { ActivityId } from "@/lib/types";

export function createDocumentId(): string {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function lessonsToDocuments(lessons: Lesson[]): RagDocument[] {
  return lessons.map((lesson) => ({
    id: `lesson-${lesson.id}`,
    title: `Lección · ${lesson.activity}: ${lesson.question.slice(0, 80)}`,
    text: `${lesson.question}\n\n${lesson.answer}${lesson.reason ? `\n\nMotivo: ${lesson.reason}` : ""}`,
    source: "lección aprendida",
    createdAt: lesson.at,
  }));
}

export function sourcesToDocuments(hits: SourceHit[]): RagDocument[] {
  return hits.map((hit, index) => ({
    id: `src-${index}-${hit.source}`,
    title: hit.title,
    text: hit.summary || hit.title,
    source: `${hit.source}${hit.url ? ` · ${hit.url}` : ""}`,
    createdAt: Date.now(),
  }));
}

export function sanitizeDocuments(value: unknown): RagDocument[] {
  if (!Array.isArray(value)) return [];
  const clean: RagDocument[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    if (typeof row.title !== "string" || !row.title.trim()) continue;
    if (typeof row.text !== "string" || row.text.trim().length < 20) continue;
    if (typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt)) continue;
    clean.push({
      id: row.id.slice(0, 64),
      title: row.title.trim().slice(0, 160),
      text: row.text.trim().slice(0, 40_000),
      source: typeof row.source === "string" ? row.source.slice(0, 200) : undefined,
      createdAt: row.createdAt,
    });
  }
  return clean.slice(0, 40);
}

export async function runRagPipeline(options: {
  query: string;
  activity: ActivityId;
  documents?: RagDocument[];
  lessons?: Lesson[];
  includeLiveSources?: boolean;
}): Promise<RagContext> {
  const baseDocs = [
    ...(options.documents ?? []),
    ...lessonsToDocuments(options.lessons ?? []),
  ];

  let liveDocs: RagDocument[] = [];
  if (options.includeLiveSources ?? options.activity === "investigar") {
    try {
      const sources = await gatherSources(options.query);
      liveDocs = sourcesToDocuments(sources);
    } catch {
      liveDocs = [];
    }
  }

  const documents = [...baseDocs, ...liveDocs];
  if (!documents.length) {
    return formatRagContext([]);
  }

  const index = buildRagIndex(documents);
  const hits = searchRagIndex(index, options.query, options.activity === "investigar" ? 5 : 4);
  return formatRagContext(hits);
}
