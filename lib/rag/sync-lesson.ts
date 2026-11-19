import type { Lesson } from "@/lib/lessons";
import { engineIndexDocument, engineRememberLesson } from "@/lib/rag/engine-client";

/** Indexa una corrección del usuario en el motor Python (navegador → FastAPI). */
export async function syncLessonToEngine(lesson: Lesson): Promise<void> {
  await engineRememberLesson({
    id: lesson.id,
    activity: lesson.activity,
    question: lesson.question,
    answer: lesson.answer,
    reason: lesson.reason,
  });
  await engineIndexDocument({
    id: `lesson-${lesson.id}`,
    title: `Corrección · ${lesson.activity}`,
    text: `Pregunta: ${lesson.question}\nRespuesta correcta: ${lesson.answer}\n${lesson.reason ? `Nota: ${lesson.reason}` : ""}`,
    source: "correccion-usuario",
    createdAt: Date.now(),
  });
}
