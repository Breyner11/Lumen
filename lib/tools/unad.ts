import { ollamaChat } from "@/lib/ollama";

export type UnadKbArticle = {
  id: string;
  title: string;
  tags: string[];
  body: string;
  updatedAt: number;
};

export const SEED_UNAD_KB: UnadKbArticle[] = [
  {
    id: "unad-login",
    title: "Ingreso al campus (usuario y contraseña)",
    tags: ["usuario", "contraseña", "campus", "login", "ingreso"],
    body: [
      "Para entrar al campus virtual UNAD usa el usuario institucional y la contraseña registrada.",
      "Si olvidaste la contraseña, usa la opción de recuperación del propio campus; no compartas claves.",
      "Si el bloqueo persiste tras restablecer, abre un caso en el SAI con capturas (sin contraseñas).",
    ].join(" "),
    updatedAt: 0,
  },
  {
    id: "unad-matricula",
    title: "Matrícula",
    tags: ["matrícula", "matricula", "inscripción", "periodo"],
    body: [
      "La matrícula se gestiona en los plazos del calendario académico publicados por la UNAD.",
      "Revisa requisitos, materias y estado de pago antes de confirmar.",
      "Conserva el comprobante; ante novedades, consulta el SAI o la secretaría de tu escuela.",
    ].join(" "),
    updatedAt: 0,
  },
  {
    id: "unad-pago",
    title: "Recibo de pago",
    tags: ["recibo", "pago", "liquidación", "finanzas"],
    body: [
      "El recibo o liquidación se genera en el módulo financiero del campus según el periodo.",
      "Verifica valor, fechas de vencimiento y referencia de pago.",
      "Si el pago no se refleja, adjunta el soporte en un caso SAI (sin inventar plazos).",
    ].join(" "),
    updatedAt: 0,
  },
  {
    id: "unad-perfil",
    title: "Perfil y datos personales",
    tags: ["perfil", "datos", "correo", "documento"],
    body: [
      "Actualiza correo y datos de contacto en el perfil del campus para recibir notificaciones.",
      "Cambios de documento o datos sensibles suelen requerir soporte formal (SAI).",
      "No publiques datos personales en foros abiertos.",
    ].join(" "),
    updatedAt: 0,
  },
];

export function sanitizeUnadKb(value: unknown): UnadKbArticle[] {
  if (!Array.isArray(value)) return [...SEED_UNAD_KB];
  const out: UnadKbArticle[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.body !== "string") {
      continue;
    }
    out.push({
      id: row.id.slice(0, 64),
      title: row.title.trim().slice(0, 160),
      tags: Array.isArray(row.tags)
        ? row.tags.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 40)).slice(0, 12)
        : [],
      body: row.body.trim().slice(0, 4000),
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
    });
  }
  return out.length ? out.slice(0, 80) : [...SEED_UNAD_KB];
}

export function findUnadArticles(query: string, kb: UnadKbArticle[], limit = 3): UnadKbArticle[] {
  const terms = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  const scored = kb
    .map((article) => {
      const blob = `${article.title} ${article.tags.join(" ")} ${article.body}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      const score = terms.reduce((n, term) => (blob.includes(term) ? n + 1 : n), 0);
      return { article, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((row) => row.article);
}

/** Responde FAQs del campus citando artículos locales; no inventa procedimientos. */
export function answerUnadCampusFaq(question: string, kb: UnadKbArticle[]): {
  applicable: boolean;
  answer: string;
} {
  const articles = findUnadArticles(question, kb, 2);
  if (!articles.length) {
    return {
      applicable: true,
      answer: [
        "No encontré un artículo en tu base local del campus UNAD para esa consulta.",
        "",
        "Añade el caso del SAI en **Ajustes → Base UNAD** (o Conocimiento) y vuelve a preguntar.",
        "No invento pasos oficiales: solo cito lo que tú hayas guardado.",
      ].join("\n"),
    };
  }
  const lines = [
    "**Soporte campus UNAD** _(base local editable)_",
    "",
    ...articles.flatMap((article) => [
      `**Artículo base:** ${article.title}`,
      article.body,
      "",
    ]),
    "_Si tu caso difiere, prioriza el SAI y actualiza este artículo con lo que te respondan._",
  ];
  return { applicable: true, answer: lines.join("\n") };
}

export async function unadAssignmentHelp(options: {
  guideText: string;
  mode: "apa" | "ortografia" | "esquema" | "todo";
  model?: string;
}): Promise<{ applicable: boolean; answer: string }> {
  const guide = options.guideText.trim().slice(0, 12_000);
  if (guide.length < 40) {
    return {
      applicable: false,
      answer: "Pega la guía de la actividad UNAD (o el borrador) para APA 7, ortografía o esquema.",
    };
  }

  const drafted = await ollamaChat({
    model: options.model,
    languageMode: "spanish",
    think: false,
    timeoutMs: 90_000,
    numPredict: 480,
    system: [
      "Eres Lumen en modo tareas UNAD. Español colombiano.",
      "No inventes citas, DOI ni páginas. Si falta un dato para APA 7, marca [FALTA].",
      "Estructura:",
      "APA7:",
      "- ...",
      "ORTOGRAFIA:",
      "- ...",
      "ESQUEMA:",
      "1. ...",
    ].join("\n"),
    prompt: [`Modo: ${options.mode}`, "", "Guía / texto:", guide, "", "APA7:"].join("\n"),
  });

  if (!drafted.ok) {
    return {
      applicable: true,
      answer: [
        "**Tareas UNAD** _(borrador local)_",
        "",
        "**APA 7:** identifica autor, año, título y fuente; marca [FALTA] lo que no esté en la guía.",
        "**Ortografía:** relee mayúsculas, tildes y concordancia; no cambies el sentido.",
        "**Esquema de informe:** introducción → desarrollo según objetivos de la guía → conclusiones → referencias.",
        "",
        "_El modelo no respondió a tiempo; usa esta plantilla y completa con tu guía._",
      ].join("\n"),
    };
  }

  return {
    applicable: true,
    answer: [
      "**Tareas UNAD**",
      "",
      drafted.text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(),
      "",
      "_No inventé fuentes: si ves [FALTA], completa con tu material._",
    ].join("\n"),
  };
}

export function looksLikeUnadCampus(input: string): boolean {
  return /\b(unad|campus\s+virtual|sai|matr[ií]cula|recibo\s+de\s+pago|contrase[nñ]a\s+del\s+campus)\b/i.test(
    input,
  );
}

export function looksLikeUnadAssignment(input: string): boolean {
  return /\b(apa\s*7|citas?\s+apa|ortograf[ií]a|esquema\s+de\s+informe|gu[ií]a\s+de\s+la\s+actividad)\b/i.test(
    input,
  );
}
