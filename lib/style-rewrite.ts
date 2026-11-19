import { splitToolBadge } from "@/lib/tool-badge";
import type { AnswerStyle } from "@/lib/style";

/**
 * Reescribe la respuesta anterior sin llamar a Ollama.
 * Rápido, anclado al texto previo y sin inventar temas nuevos.
 */
export function rewriteAnswerStyle(previous: string, style: AnswerStyle): string {
  const { content } = splitToolBadge(previous);
  const clean = sanitizeBrokenMarkdown(content).trim();
  if (!clean) return previous.trim();

  if (style === "corto") return shortenAnswer(clean);
  if (style === "natural") return naturalizeAnswer(clean);
  if (style === "informativo") return expandInformative(clean);
  return clean;
}

export function sanitizeBrokenMarkdown(text: string): string {
  return text
    // Solo corrige ** título ** en la misma línea (no cruces entre párrafos).
    .replace(/\*\*[ \t]+([^*\n]+?)[ \t]+\*\*/g, (_all, inner: string) => {
      const body = inner.trim().replace(/:\s*$/, "");
      return `**${body}:**`;
    })
    .replace(/\*{3,}/g, "**")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function shortenAnswer(text: string): string {
  const bullets = extractBullets(text);
  if (bullets.length >= 2) {
    return ["**Versión corta**", "", ...bullets.slice(0, 5).map((b) => `- ${b}`)].join("\n");
  }
  const sentences = splitSentences(stripMarkdownNoise(text));
  const picked = sentences.slice(0, 4);
  if (!picked.length) return text.slice(0, 320);
  return ["**Versión corta**", "", picked.join(" ")].join("\n");
}

function naturalizeAnswer(text: string): string {
  const plain = stripMarkdownNoise(text)
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
  const sentences = splitSentences(plain);
  if (sentences.length <= 3) return plain;
  const lead = sentences.slice(0, 2).join(" ");
  const rest = sentences.slice(2);
  return [lead, "", ...rest.map((s) => `- ${s}`)].join("\n");
}

function expandInformative(text: string): string {
  const bullets = extractBullets(text);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const detail = bullets.length
    ? bullets
    : paragraphs
        .flatMap((block) => splitSentences(stripMarkdownNoise(block)))
        .map((s) => s.trim())
        .filter((s) => s.length > 25);

  const unique = dedupeKeepOrder(detail).slice(0, 10);
  if (!unique.length) return text;

  const resumen = unique.slice(0, 2).join(" ");
  return [
    "**Más detalle**",
    "",
    ...unique.map((item) => `- ${item.replace(/\*\*/g, "").trim()}`),
    "",
    "**En resumen**",
    "",
    resumen || "Estos son los puntos principales de la respuesta anterior, ampliados en estructura.",
  ].join("\n");
}

function extractBullets(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, ""))
    .map((line) =>
      line
        .replace(/^\*\*([^*]+?):\*\*\s*/, "$1: ")
        .replace(/^\*\*([^*]+?)\*\*:?\s*/, "$1: ")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .filter((line) => line.length > 20)
    .filter((line) => !/^(Qué dicen las fuentes|En resumen|Versión corta|Más detalle)\b/i.test(line));
}

function stripMarkdownNoise(text: string): string {
  return text
    .replace(/^_Herramienta:[^_\n]*_\s*/i, "")
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 12);
}

function dedupeKeepOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
