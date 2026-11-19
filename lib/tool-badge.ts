/** Extrae la etiqueta `_Herramienta: …_` del texto de respuesta para mostrarla en UI. */

const TOOL_LINE =
  /^\s*_?\s*Herramienta:\s*([^\n_]+?)\s*_?\s*(?:\n+|$)/i;

export function splitToolBadge(text: string): { tool?: string; content: string } {
  const source = text ?? "";
  const match = TOOL_LINE.exec(source);
  if (!match) return { content: source };
  return {
    tool: match[1].replace(/\s+/g, " ").trim() || undefined,
    content: source.slice(match[0].length).replace(/^\s+/, ""),
  };
}
