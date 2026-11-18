const WEEKDAYS = ["lunes", "martes", "miércoles", "miercoles", "jueves", "viernes", "sábado", "sabado", "domingo"];

type Task = { title: string; when: string; priority: "alta" | "media" };

export function organizePlan(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  const chunks = text
    .split(/\n|•|,|(?<=\.)\s+|(?:\s+y\s+(?=el\s+|hoy|mañana|manana|pasado))/i)
    .map((chunk) => chunk.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((chunk) => chunk.length > 3);

  const tasks: Task[] = [];
  for (const chunk of chunks) {
    if (!/[a-záéíóúñ]/i.test(chunk)) continue;
    const when = detectWhen(chunk);
    const priority = /urgente|examen|entrega|entregar|hoy|mañana|manana/i.test(chunk) ? "alta" : "media";
    tasks.push({ title: chunk.replace(/[.]$/, ""), when, priority });
  }

  if (tasks.length === 0) {
    return {
      applicable: false,
      answer: [
        "Escríbeme las pendientes en frases cortas.",
        "",
        "Ejemplo: «Mañana examen de cálculo, el viernes entregar el ensayo y hoy revisar los apuntes».",
        "",
        "Las separo, marco lo urgente y las dejo en un orden para el día.",
      ].join("\n"),
      notes: "",
    };
  }

  const ordered = [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "alta" ? -1 : 1;
    return whenRank(a.when) - whenRank(b.when);
  });
  const lines = ordered.map((task, index) => {
    return `${index + 1}. **${task.priority === "alta" ? "Alta" : "Media"}** · ${task.when}. ${capitalize(task.title)}`;
  });
  const answer = [
    `**${ordered.length} pendiente${ordered.length === 1 ? "" : "s"}**`,
    "",
    "Orden sugerido: primero lo urgente o lo que vence hoy o mañana.",
    "",
    ...lines,
    "",
    "Bloquea 50 minutos para la primera y deja la última como cierre, no como arranque.",
  ].join("\n");
  return { applicable: true, answer, notes: lines.join("\n") };
}

function detectWhen(chunk: string): string {
  const lower = chunk.toLowerCase();
  if (/\bhoy\b/.test(lower)) return "hoy";
  if (/\bpasado\s+mañana\b|\bpasado\s+manana\b/.test(lower)) return "pasado mañana";
  if (/\bmañana\b|\bmanana\b/.test(lower)) return "mañana";
  const weekday = WEEKDAYS.find((day) => lower.includes(day));
  if (weekday === "miercoles") return "miércoles";
  if (weekday === "sabado") return "sábado";
  if (weekday) return weekday;
  const date = lower.match(/\bel\s+(\d{1,2})(?:\s+de\s+([a-záéíóú]+))?/);
  if (date) return date[2] ? `el ${date[1]} de ${date[2]}` : `el día ${date[1]}`;
  return "sin fecha";
}

function whenRank(when: string): number {
  if (when === "hoy") return 0;
  if (when === "mañana") return 1;
  if (when === "pasado mañana") return 2;
  if (when === "sin fecha") return 9;
  return 3;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
