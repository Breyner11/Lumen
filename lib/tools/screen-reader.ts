/** Lector de pantalla: explica una captura con visión local (qwen2.5vl recomendado). */

export const RECOMMENDED_VISION_MODEL = "qwen2.5vl:3b";

export function screenReaderHelpText(): string {
  return [
    "**Lector de pantalla (local)**",
    "",
    `Modelo recomendado en PC normal: **${RECOMMENDED_VISION_MODEL}** (mejor equilibrio que llava en ~8–16 GB).`,
    "",
    "1. En la app Windows (Tauri), el atajo captura la ventana o una región.",
    "2. La imagen se envía a Ollama en tu PC (no a la nube).",
    "3. Lumen explica el contenido en español: textos, botones, errores visibles.",
    "",
    "Mientras tanto puedes adjuntar una captura con **+** y pedir «explica esta pantalla».",
  ].join("\n");
}

export function looksLikeScreenExplain(input: string): boolean {
  return /\b(explica\s+(esta\s+)?(pantalla|captura)|qu[eé]\s+hay\s+en\s+(la\s+)?pantalla|lee\s+la\s+pantalla|lector\s+de\s+pantalla)\b/i.test(
    input,
  );
}
