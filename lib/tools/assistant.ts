/** Modo Asistente: tareas locales, revisión de PC (mock seguro) y borrados con confirmación. */

export type AssistantTask = {
  id: string;
  title: string;
  done: boolean;
  createdAt: number;
  dueAt?: string;
};

export type PcReviewItem = {
  id: string;
  label: string;
  detail: string;
  severity: "ok" | "aviso" | "atención";
  action?: "delete-temp" | "none";
};

export type PendingDestructive = {
  id: string;
  kind: "delete-temp" | "clear-task";
  label: string;
  detail: string;
};

const TEMP_WHITELIST = [
  "%TEMP%\\LumenCache",
  "%LOCALAPPDATA%\\Lumen\\Temp",
  "C:\\Users\\Public\\LumenTemp",
] as const;

export function sanitizeTasks(value: unknown): AssistantTask[] {
  if (!Array.isArray(value)) return [];
  const out: AssistantTask[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string") continue;
    out.push({
      id: row.id.slice(0, 64),
      title: row.title.trim().slice(0, 200),
      done: Boolean(row.done),
      createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
      dueAt: typeof row.dueAt === "string" ? row.dueAt : undefined,
    });
  }
  return out.slice(0, 200);
}

export function createTask(title: string, dueAt?: string): AssistantTask {
  return {
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim().slice(0, 200),
    done: false,
    createdAt: Date.now(),
    dueAt,
  };
}

/** Revisión mock del PC: solo rutas en lista blanca; no toca el sistema real aquí. */
export function mockPcReview(): PcReviewItem[] {
  return [
    {
      id: "disk",
      label: "Espacio en disco",
      detail: "Simulación: C: con ~42 GB libres (dato de ejemplo en este entorno).",
      severity: "ok",
      action: "none",
    },
    {
      id: "temp",
      label: "Archivos temporales de Lumen",
      detail: `Hay ~128 MB en carpetas permitidas: ${TEMP_WHITELIST.join(", ")}.`,
      severity: "aviso",
      action: "delete-temp",
    },
    {
      id: "ollama",
      label: "Ollama",
      detail: "Comprueba en Ajustes que el modelo elegido esté instalado y respondiendo.",
      severity: "ok",
      action: "none",
    },
  ];
}

export function requestTempCleanup(): PendingDestructive {
  return {
    id: `pend-${Date.now().toString(36)}`,
    kind: "delete-temp",
    label: "Vaciar temporales de Lumen",
    detail:
      "Solo se borrarían carpetas de la lista blanca de Lumen. No se tocarán Descargas, Documentos ni el sistema. Confirma para continuar.",
  };
}

/** En este entorno cloud no borramos disco real; confirmación deja registro seguro. */
export function confirmDestructive(pending: PendingDestructive): string {
  if (pending.kind === "delete-temp") {
    return [
      "Listo (simulación segura).",
      "",
      "En tu PC Windows, Lumen solo vaciará rutas en lista blanca vía el sidecar local.",
      `Acción confirmada: ${pending.label}`,
      "",
      "Rutas permitidas:",
      ...TEMP_WHITELIST.map((path) => `- ${path}`),
    ].join("\n");
  }
  return `Acción confirmada: ${pending.label}`;
}

export function handleAssistantIntent(
  input: string,
  tasks: AssistantTask[],
): { applicable: boolean; answer: string; tasks?: AssistantTask[]; pending?: PendingDestructive } {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (/^(lista|ver|mostrar)\s+(mis\s+)?tareas\b|qué\s+tareas|tareas\s+pendientes/i.test(lower)) {
    const open = tasks.filter((t) => !t.done);
    if (!open.length) {
      return {
        applicable: true,
        answer: "No tienes tareas pendientes. Di «añade tarea: …» para crear una.",
      };
    }
    return {
      applicable: true,
      answer: [
        "**Tareas pendientes**",
        "",
        ...open.map((t, i) => `${i + 1}. ${t.title}${t.dueAt ? ` _(hasta ${t.dueAt})_` : ""}`),
      ].join("\n"),
    };
  }

  const add = /^(?:a[nñ]ade|agrega|crea)\s+tarea\s*[:\-–]?\s*(.+)$/i.exec(text);
  if (add?.[1]) {
    const next = [...tasks, createTask(add[1])];
    return {
      applicable: true,
      answer: `Añadí la tarea: **${add[1].trim()}**.\n\nTienes ${next.filter((t) => !t.done).length} pendientes.`,
      tasks: next,
    };
  }

  const done = /^(?:marca|completar?|hecha?)\s+tarea\s*[:\-–]?\s*(.+)$/i.exec(text);
  if (done?.[1]) {
    const key = done[1].trim().toLowerCase();
    const next = tasks.map((t) =>
      t.title.toLowerCase().includes(key) ? { ...t, done: true } : t,
    );
    return {
      applicable: true,
      answer: `Marqué como hecha(s) las tareas que coinciden con «${done[1].trim()}».`,
      tasks: next,
    };
  }

  if (/revis(a|ar)\s+(mi\s+)?(pc|ordenador|computador|disco|temporales)/i.test(lower)) {
    const items = mockPcReview();
    return {
      applicable: true,
      answer: [
        "**Revisión del PC** _(datos de ejemplo en este entorno; en Windows usará lecturas locales)_",
        "",
        ...items.map(
          (item) =>
            `- **${item.label}:** ${item.detail}${item.action === "delete-temp" ? " Di «limpia temporales» para pedir confirmación." : ""}`,
        ),
      ].join("\n"),
    };
  }

  if (/limpia\s+temporales|borra\s+temporales|vac[ií]a\s+cach[eé]/i.test(lower)) {
    const pending = requestTempCleanup();
    return {
      applicable: true,
      answer: [
        "**Confirmación requerida**",
        "",
        pending.detail,
        "",
        "Responde **confirmar borrado** para continuar, o **cancelar** para no hacer nada.",
      ].join("\n"),
      pending,
    };
  }

  if (/^confirmar\s+borrado\b/i.test(lower)) {
    return {
      applicable: true,
      answer: "No hay una acción pendiente en esta frase suelta. Primero di «limpia temporales» y luego confirma.",
    };
  }

  if (/^ayudame\s+como\s+asistente|^modo\s+asistente|qu[eé]\s+puedes\s+hacer\s+como\s+asistente/i.test(lower)) {
    return {
      applicable: true,
      answer: [
        "Soy tu **Asistente** local en Lumen.",
        "",
        "- **Tareas:** «añade tarea: entregar ensayo» · «lista tareas» · «marca tarea: ensayo»",
        "- **PC:** «revisa mi PC» (solo lecturas y temporales en lista blanca)",
        "- **Borrado:** siempre pide confirmación («confirmar borrado»)",
        "- **Investigar:** pregunta con normalidad; el internet es opcional en Ajustes",
        "",
        "Todo queda en tu dispositivo. No publico nada ni subo tus datos a la nube.",
      ].join("\n"),
    };
  }

  return { applicable: false, answer: "", tasks };
}
