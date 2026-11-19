/** Modo enfoque: pomodoro solo dentro de Lumen (no toca el sistema). */

export type FocusSession = {
  id: string;
  label: string;
  workMinutes: number;
  breakMinutes: number;
  cycles: number;
  softSound: boolean;
  startedAt?: number;
  endsAt?: number;
  phase: "idle" | "work" | "break";
};

export function createFocusSession(options?: {
  workMinutes?: number;
  breakMinutes?: number;
  cycles?: number;
  softSound?: boolean;
}): FocusSession {
  return {
    id: `focus-${Date.now().toString(36)}`,
    label: "Enfoque Lumen",
    workMinutes: options?.workMinutes ?? 25,
    breakMinutes: options?.breakMinutes ?? 5,
    cycles: options?.cycles ?? 4,
    softSound: options?.softSound ?? false,
    phase: "idle",
  };
}

export function startFocusPhase(session: FocusSession, phase: "work" | "break"): FocusSession {
  const minutes = phase === "work" ? session.workMinutes : session.breakMinutes;
  const startedAt = Date.now();
  return {
    ...session,
    phase,
    startedAt,
    endsAt: startedAt + minutes * 60_000,
  };
}

export function focusStatusLine(session: FocusSession, now = Date.now()): string {
  if (session.phase === "idle" || !session.endsAt) {
    return `Enfoque en pausa · ${session.workMinutes}/${session.breakMinutes} min · sonido ${session.softSound ? "suave" : "apagado"}`;
  }
  const left = Math.max(0, session.endsAt - now);
  const mins = Math.ceil(left / 60_000);
  return session.phase === "work"
    ? `Trabajo: quedan ~${mins} min (distracciones bloqueadas solo en Lumen)`
    : `Descanso: quedan ~${mins} min`;
}

export function looksLikeFocusRequest(input: string): boolean {
  return /\b(pomodoro|modo\s+enfoque|enfoque\s+\d+|concentrar?me)\b/i.test(input);
}
