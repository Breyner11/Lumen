import type { ActivityId } from "@/lib/types";

/** Oficios especializados (sin el chat unificado). */
export const SPECIALTY_IDS = [
  "estudiar",
  "programar",
  "escribir",
  "calcular",
  "organizar",
  "traducir",
  "resumir",
  "investigar",
] as const satisfies readonly ActivityId[];

export type SpecialtyId = (typeof SPECIALTY_IDS)[number];

const LABELS: Record<SpecialtyId, string> = {
  estudiar: "Estudiar",
  programar: "Programar",
  escribir: "Escribir",
  calcular: "Calcular",
  organizar: "Organizar",
  traducir: "Traducir",
  resumir: "Resumir",
  investigar: "Investigar",
};

/**
 * Elige el oficio según la pregunta. Prioriza señales claras
 * (código, ecuación, traducción…) y cae en Investigar para dudas abiertas.
 */
export function detectIntent(input: string): SpecialtyId {
  const text = input.trim();
  const lower = text.toLowerCase();

  if (!text) return "investigar";

  if (
    /```/.test(text) ||
    /\b(function|const|let|var|def |class |import |export |TypeError|SyntaxError|console\.|npm |git )\b/i.test(
      text,
    ) ||
    /\b(código|codigo|programa|bug|error\s+en\s+línea|revisa\s+(esta|mi)\s+funci)/i.test(lower)
  ) {
    return "programar";
  }

  if (
    /\b(traduc(?:e|ir|ción)|translate|to\s+english|al\s+inglés|al\s+español|en\s+inglés|en\s+español)\b/i.test(
      lower,
    )
  ) {
    return "traducir";
  }

  if (
    /\b(resum(?:e|ir|en)|sintetiza|ideas\s+clave)\b/i.test(lower) &&
    text.length > 180
  ) {
    return "resumir";
  }
  if (text.length > 450 && !/[?]/.test(text) && !/\b(qu[eé]|c[oó]mo|por\s+qu[eé]|d[oó]nde)\b/i.test(lower)) {
    return "resumir";
  }

  if (
    /\b(organiz(?:a|ar)|pendientes|lista\s+de\s+tareas|prioriza|agenda|hoy\b.*mañana|mañana\b.*viernes)\b/i.test(
      lower,
    ) ||
    (/\b(hoy|mañana|viernes|lunes|entrega)\b/i.test(lower) &&
      /\b(examen|ensayo|tarea|apuntes|revisar|entregar)\b/i.test(lower) &&
      text.split(/[,;\n]/).length >= 2)
  ) {
    return "organizar";
  }

  if (
    /\b(redacta|reescribe|corrige\s+(este|el)\s+(párrafo|texto)|revisa\s+(este|el)\s+(párrafo|texto)|mejor(?:a|ar)\s+(este|el)\s+texto)\b/i.test(
      lower,
    )
  ) {
    return "escribir";
  }

  if (looksLikeMath(text, lower)) {
    return "calcular";
  }

  if (
    /\b(expl[ií]came|c[oó]mo\s+estudiar|plan\s+de\s+estudio|tengo\s+examen|repasar|tutor|ense[nñ]ame|ayuda(?:me)?\s+a\s+entender)\b/i.test(
      lower,
    )
  ) {
    return "estudiar";
  }

  if (
    /\b(qu[eé]\s+es|qui[eé]n\s+es|d[oó]nde|cu[aá]ndo|por\s+qu[eé]|investiga|busca|fuentes|wikipedia|seg[uú]n)\b/i.test(
      lower,
    ) ||
    /\?$/.test(text.trim())
  ) {
    return "investigar";
  }

  // Texto corto suelto → investigar; párrafo sin pregunta → escribir/revisar si parece prosa.
  if (text.length > 220 && /[.!]/.test(text) && !/\d\s*[+\-*/=]/.test(text)) {
    return "escribir";
  }

  return "investigar";
}

export function intentLabel(id: SpecialtyId): string {
  return LABELS[id];
}

export function looksLikeMath(text: string, lower = text.toLowerCase()): boolean {
  if (
    /\b(integra|integral|deriv(?:a|ar|ada)|despeja|ecuaci[oó]n|simplifica|factoriza|mcd|mcm|ra[ií]z|sqrt|sympy|latex)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (/\d+\s*%\s*(de|of)\s*\d+/i.test(text)) return true;
  if (/[∫∑√π]/.test(text) || /\\int|\\frac|\\sum|\$\$/.test(text)) return true;
  if (/[a-zA-Z]\s*=\s*-?\d/.test(text) || /\d\s*[a-zA-Z]\s*[+\-]=/.test(text)) return true;
  if (/=\s*-?\d/.test(text) && /[a-zA-Z]/.test(text)) return true;
  // Expresión aritmética dominante
  const ops = (text.match(/[+\-*/^=()]/g) ?? []).length;
  const digits = (text.match(/\d/g) ?? []).length;
  if (digits >= 2 && ops >= 1 && text.length < 120) return true;
  return false;
}
