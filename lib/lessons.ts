import type { ActivityId } from "@/lib/types";
import { ACTIVITY_IDS } from "@/lib/types";

export type Lesson = {
  id: string;
  activity: ActivityId;
  question: string;
  answer: string;
  reason?: string;
  at: number;
  hits: number;
};

const MAX_LESSONS = 80;

export function createLessonId(): string {
  return `les-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[¿?¡!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function upsertLesson(
  lessons: Lesson[],
  next: Omit<Lesson, "id" | "at" | "hits"> & { id?: string; at?: number; hits?: number },
): Lesson[] {
  const question = normalizeQuestion(next.question);
  const answer = next.answer.trim();
  if (!question || !answer) return lessons;
  const existingIndex = lessons.findIndex(
    (lesson) => lesson.activity === next.activity && normalizeQuestion(lesson.question) === question,
  );
  const lesson: Lesson = {
    id: next.id ?? lessons[existingIndex]?.id ?? createLessonId(),
    activity: next.activity,
    question: next.question.trim().slice(0, 500),
    answer: answer.slice(0, 8000),
    reason: next.reason?.trim().slice(0, 500),
    at: next.at ?? Date.now(),
    hits: next.hits ?? lessons[existingIndex]?.hits ?? 0,
  };
  const without = lessons.filter((_, index) => index !== existingIndex);
  return [lesson, ...without].slice(0, MAX_LESSONS);
}

export function touchLesson(lessons: Lesson[], id: string): Lesson[] {
  return lessons.map((lesson) =>
    lesson.id === id ? { ...lesson, hits: lesson.hits + 1, at: Date.now() } : lesson,
  );
}

export function findLesson(lessons: Lesson[], activity: ActivityId, question: string): Lesson | null {
  const key = normalizeQuestion(question);
  if (!key) return null;
  const exact = lessons.find(
    (lesson) => lesson.activity === activity && normalizeQuestion(lesson.question) === key,
  );
  if (exact) return exact;

  // Soft match: same activity and high token overlap for short math/fact queries.
  const keyTokens = new Set(key.split(" ").filter((token) => token.length >= 1));
  let best: Lesson | null = null;
  let bestScore = 0;
  for (const lesson of lessons) {
    if (lesson.activity !== activity) continue;
    const other = normalizeQuestion(lesson.question);
    if (!other) continue;
    if (other.includes(key) || key.includes(other)) {
      const score = Math.min(other.length, key.length) / Math.max(other.length, key.length);
      if (score > bestScore) {
        best = lesson;
        bestScore = score;
      }
      continue;
    }
    const otherTokens = other.split(" ").filter((token) => token.length >= 1);
    if (otherTokens.length === 0 || keyTokens.size === 0) continue;
    let hits = 0;
    for (const token of otherTokens) if (keyTokens.has(token)) hits += 1;
    const score = hits / Math.max(otherTokens.length, keyTokens.size);
    if (score >= 0.85 && score > bestScore) {
      best = lesson;
      bestScore = score;
    }
  }
  return bestScore >= 0.85 ? best : null;
}

export function sanitizeLessons(value: unknown): Lesson[] {
  if (!Array.isArray(value)) return [];
  const clean: Lesson[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    if (!ACTIVITY_IDS.includes(row.activity as ActivityId)) continue;
    if (typeof row.question !== "string" || !row.question.trim()) continue;
    if (typeof row.answer !== "string" || !row.answer.trim()) continue;
    if (typeof row.at !== "number" || !Number.isFinite(row.at)) continue;
    const hits = typeof row.hits === "number" && Number.isFinite(row.hits) ? row.hits : 0;
    clean.push({
      id: row.id.slice(0, 64),
      activity: row.activity as ActivityId,
      question: row.question.slice(0, 500),
      answer: row.answer.slice(0, 8000),
      reason: typeof row.reason === "string" ? row.reason.slice(0, 500) : undefined,
      at: row.at,
      hits: Math.max(0, Math.floor(hits)),
    });
  }
  return clean.slice(0, MAX_LESSONS);
}

/** Detects "está mal, la respuesta es X" style corrections. */
export function parseCorrectionMessage(text: string): { answer: string; reason?: string } | null {
  const trimmed = text.trim();
  const patterns = [
    /^(?:est[aá]\s+mal|incorrecto|error|no(?:\s+es)?(?:\s+correcto)?|fall[oó])[,:.\s-]+(?:la\s+respuesta(?:\s+correcta)?\s+es\s+|deber[ií]a\s+ser\s+|es\s+|corrige(?:\s+a)?\s+)?([\s\S]+)$/i,
    /^(?:la\s+respuesta(?:\s+correcta)?\s+es|deber[ií]a\s+ser|corrige(?:\s+a)?)\s*[:\-]?\s*([\s\S]+)$/i,
    /^aprende\s*[:\-]?\s*([\s\S]+)$/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]?.trim()) {
      return { answer: match[1].trim(), reason: "Corrección del usuario" };
    }
  }
  return null;
}

export function formatLessonAnswer(lesson: Lesson): string {
  return [
    lesson.answer.trim(),
    "",
    "_Aprendí esta respuesta de una corrección anterior. Si sigue mal, márcala otra vez._",
  ].join("\n");
}
