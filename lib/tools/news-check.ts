import { ollamaChat } from "@/lib/ollama";

export type NewsCheckResult = {
  applicable: boolean;
  answer: string;
  claims: string[];
  verifiability: string;
  missing: string[];
  note: string;
  usedWeb: boolean;
};

/** Verifica un post/noticia: afirmaciones, verificabilidad, faltantes y nota ≤500 chars. */
export async function verifyNewsPost(options: {
  text: string;
  webSearch?: boolean | "auto";
  model?: string;
}): Promise<NewsCheckResult> {
  const text = options.text.trim().slice(0, 8_000);
  if (text.length < 40) {
    return {
      applicable: false,
      answer: "Pega el post o la noticia (al menos un párrafo) para verificarla.",
      claims: [],
      verifiability: "",
      missing: [],
      note: "",
      usedWeb: false,
    };
  }

  const wantWeb = options.webSearch === true;
  if (!wantWeb) {
    const local = await analyzeOffline(text, options.model);
    const warning =
      "Con la web apagada **no pude verificar** contra fuentes externas. Solo analicé el texto pegado.";
    return {
      ...local,
      answer: [local.answer, "", warning].join("\n"),
      usedWeb: false,
    };
  }

  // Web on: still analyze locally first; real fetch can be added via engine later.
  const local = await analyzeOffline(text, options.model);
  return {
    ...local,
    answer: [
      local.answer,
      "",
      "_Internet activado: contrasta las afirmaciones con medios confiables; Lumen no inventa enlaces._",
    ].join("\n"),
    usedWeb: true,
  };
}

async function analyzeOffline(text: string, model?: string): Promise<NewsCheckResult> {
  const drafted = await ollamaChat({
    model,
    languageMode: "spanish",
    think: false,
    timeoutMs: 75_000,
    numPredict: 360,
    system: [
      "Eres Lumen, verificador de noticias. Solo español.",
      "Formato exacto:",
      "AFIRMACIONES:",
      "- ...",
      "VERIFICABILIDAD:",
      "(alta|media|baja) y por qué en una frase",
      "FALTA:",
      "- ...",
      "NOTA:",
      "(máximo 500 caracteres, lenguaje sencillo)",
      "No inventes URLs ni hechos externos.",
    ].join("\n"),
    prompt: [`Texto a revisar:\n${text}`, "", "AFIRMACIONES:"].join("\n"),
  });

  if (!drafted.ok) {
    return heuristicNews(text);
  }
  return parseNews(drafted.text, text);
}

function parseNews(raw: string, original: string): NewsCheckResult {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const claims = bulletBlock(text, "AFIRMACIONES", "VERIFICABILIDAD");
  const verifiability =
    /VERIFICABILIDAD:\s*([\s\S]*?)(?=FALTA:|NOTA:|$)/i.exec(text)?.[1]?.trim() || "media — falta contraste externo";
  const missing = bulletBlock(text, "FALTA", "NOTA");
  let note = /NOTA:\s*([\s\S]*?)$/i.exec(text)?.[1]?.trim() || "";
  note = note.slice(0, 500);
  if (!claims.length || !note) {
    return heuristicNews(original);
  }
  const answer = [
    "**Verificador de noticias**",
    "",
    "**Afirmaciones**",
    "",
    ...claims.map((c) => `- ${c}`),
    "",
    `**Qué tan verificable:** ${verifiability}`,
    "",
    "**Qué falta**",
    "",
    ...missing.map((m) => `- ${m}`),
    "",
    `**Nota (≤500):** ${note}`,
  ].join("\n");
  return {
    applicable: true,
    answer,
    claims,
    verifiability,
    missing,
    note,
    usedWeb: false,
  };
}

function heuristicNews(text: string): NewsCheckResult {
  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30)
    .slice(0, 4);
  const claims = sentences.length ? sentences : [text.slice(0, 160)];
  const missing = [
    "Fuente primaria o enlace verificable",
    "Fecha y lugar concretos",
    "Cifras con contexto (quién mide y cuándo)",
  ];
  const note = `El texto hace ${claims.length} afirmación(es) que conviene contrastar. Sin internet no puedo confirmarlas: busca la fuente original y desconfía de urgencia o insultos.`
    .slice(0, 500);
  const answer = [
    "**Verificador de noticias**",
    "",
    "**Afirmaciones**",
    "",
    ...claims.map((c) => `- ${c}`),
    "",
    "**Qué tan verificable:** baja a media — análisis solo del texto pegado",
    "",
    "**Qué falta**",
    "",
    ...missing.map((m) => `- ${m}`),
    "",
    `**Nota (≤500):** ${note}`,
  ].join("\n");
  return {
    applicable: true,
    answer,
    claims,
    verifiability: "baja a media",
    missing,
    note,
    usedWeb: false,
  };
}

function bulletBlock(text: string, start: string, end: string): string[] {
  const re = new RegExp(`${start}:\\s*([\\s\\S]*?)(?=${end}:|$)`, "i");
  const block = re.exec(text)?.[1] || "";
  return block
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length >= 8)
    .slice(0, 8);
}

export function looksLikeNewsCheck(input: string): boolean {
  return /\b(verifica(r|ción)?\s+(esta\s+)?(noticia|post|cadena)|desinforma|es\s+verdad\s+que|fact[\s-]?check)\b/i.test(
    input,
  );
}
