import type { AssistantTask } from "@/lib/tools/assistant";
import type { UserMemory } from "@/lib/user-memory";

/** Resumen del día al abrir: tareas, entregas próximas y aviso de disco (mock seguro). */
export function buildDayBrief(options: {
  tasks: AssistantTask[];
  memory: UserMemory;
  freeDiskGb?: number | null;
}): string {
  const open = options.tasks.filter((t) => !t.done);
  const today = new Date();
  const inSeven = new Date(today.getTime() + 7 * 86400_000);
  const upcoming = options.memory.deadlines
    .filter((d) => {
      const due = new Date(`${d.dueAt}T12:00:00`);
      return due >= today && due <= inSeven;
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const disk =
    typeof options.freeDiskGb === "number"
      ? `${options.freeDiskGb.toFixed(0)} GB libres (lectura local)`
      : "espacio en disco: disponible en la app Windows (mock en este entorno)";

  return [
    "**Resumen del día**",
    "",
    options.memory.name ? `Hola, ${options.memory.name}.` : "Hola.",
    "",
    `**Tareas pendientes:** ${open.length}`,
    open.length
      ? open
          .slice(0, 5)
          .map((t) => `- ${t.title}`)
          .join("\n")
      : "- Ninguna por ahora.",
    "",
    "**Entregas (7 días)**",
    upcoming.length
      ? upcoming.map((d) => `- ${d.dueAt}: ${d.title}`).join("\n")
      : "- Sin entregas cargadas en memoria.",
    "",
    `**PC:** ${disk}`,
    "",
    "_Todo local. Los recordatorios del sistema llegan con la app Tauri en Windows._",
  ].join("\n");
}
