/** Recordatorios locales (notificaciones del sistema vía Tauri en Windows). */

export type Reminder = {
  id: string;
  title: string;
  at: string; // ISO datetime
  done: boolean;
};

export function sanitizeReminders(value: unknown): Reminder[] {
  if (!Array.isArray(value)) return [];
  const out: Reminder[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.at !== "string") {
      continue;
    }
    out.push({
      id: row.id.slice(0, 64),
      title: row.title.trim().slice(0, 160),
      at: row.at,
      done: Boolean(row.done),
    });
  }
  return out.slice(0, 100);
}

export function createReminder(title: string, at: string): Reminder {
  return {
    id: `rem-${Date.now().toString(36)}`,
    title: title.trim().slice(0, 160),
    at,
    done: false,
  };
}

export function upcomingReminders(reminders: Reminder[], withinHours = 24): Reminder[] {
  const now = Date.now();
  const limit = now + withinHours * 3600_000;
  return reminders
    .filter((r) => !r.done)
    .filter((r) => {
      const t = Date.parse(r.at);
      return Number.isFinite(t) && t >= now && t <= limit;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export function reminderNotificationPayload(reminder: Reminder): {
  title: string;
  body: string;
} {
  return {
    title: "Lumen · recordatorio",
    body: reminder.title,
  };
}

export function looksLikeReminderRequest(input: string): boolean {
  return /\b(recu[eé]rdame|recordatorio|av[ií]same\s+a\s+las)\b/i.test(input);
}

export function parseReminderFromText(input: string): Reminder | null {
  const match =
    /recu[eé]rdame\s+(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:h|hrs|horas)?\s*[:\-–]?\s*(.+)$/i.exec(
      input.trim(),
    ) ||
    /recordatorio\s+(\d{1,2})(?::(\d{2}))?\s+(.+)$/i.exec(input.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] || "0");
  const title = match[3]?.trim();
  if (!title || hours > 23 || minutes > 59) return null;
  const when = new Date();
  when.setHours(hours, minutes, 0, 0);
  if (when.getTime() < Date.now()) when.setDate(when.getDate() + 1);
  return createReminder(title, when.toISOString());
}
