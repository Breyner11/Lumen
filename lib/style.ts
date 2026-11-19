import type { ChatTurn } from "@/lib/types";

export type AnswerStyle = "corto" | "informativo" | "natural" | "default";

const STYLE_HINTS: Array<{ style: AnswerStyle; match: RegExp }> = [
  { style: "corto", match: /\bm[aá]s\s+cort[oa]|resum(?:e|ido)|en\s+pocas\s+palabras|breve|concis/i },
  {
    style: "informativo",
    match: /\bm[aá]s\s+(?:largo|informativ|detallad|completo)|explica\s+m[aá]s|profundiz/i,
  },
  { style: "natural", match: /\bm[aá]s\s+natural|tono\s+cercano|como\s+si\s+hablaras|menos\s+formal/i },
];

export const STYLE_QUICK_PROMPTS: Record<"corto" | "informativo" | "natural", string> = {
  corto: "Haz la respuesta anterior más corta, en español, sin perder lo esencial.",
  informativo: "Haz la respuesta anterior más informativa y detallada, en español, bien estructurada.",
  natural: "Reescribe la respuesta anterior con un tono más natural y cercano, en español.",
};

export function detectAnswerStyle(messages: ChatTurn[]): AnswerStyle {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const turn = messages[index];
    if (turn?.role !== "user") continue;
    for (const hint of STYLE_HINTS) {
      if (hint.match.test(turn.content)) return hint.style;
    }
    // Solo miramos los últimos mensajes de usuario relevantes.
    if (index < messages.length - 4) break;
  }
  return "default";
}

/** Petición de reescribir la respuesta anterior (botones Más corto/informativo/natural). */
export function isStyleRewriteRequest(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  const style = detectAnswerStyle([{ role: "user", content: text }]);
  if (style === "default") return false;
  return (
    /\brespuesta\s+anterior\b/i.test(text) ||
    /\breescribe\s+la\s+respuesta\b/i.test(text) ||
    /\bhaz\s+la\s+respuesta\b/i.test(text) ||
    Object.values(STYLE_QUICK_PROMPTS).some((prompt) => prompt === text)
  );
}

export function styleInstruction(style: AnswerStyle): string {
  switch (style) {
    case "corto":
      return "Estilo pedido: MÁS CORTO. Máximo 2–4 frases o 5 viñetas. Ve al grano.";
    case "informativo":
      return "Estilo pedido: MÁS INFORMATIVO. Amplía con subtítulos, contexto útil y matices, sin relleno.";
    case "natural":
      return "Estilo pedido: MÁS NATURAL. Tono cercano y conversacional, claro, sin sonar robótico.";
    default:
      return "Estilo: claro, estructurado y práctico. Usa subtítulos en negrita, viñetas y párrafos cortos.";
  }
}
