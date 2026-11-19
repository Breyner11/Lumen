/** Voz offline en el cliente: dictado (Web Speech / Whisper vía motor) y TTS. */

export function speakSpanish(text: string): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const clean = text.replace(/[_*`#>-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
  if (!clean) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "es-CO";
  utterance.rate = 1;
  const voices = window.speechSynthesis.getVoices();
  const es = voices.find((v) => /es(-|_)?(CO|ES|MX)?/i.test(v.lang));
  if (es) utterance.voice = es;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

export function voiceCapabilityNote(): string {
  return [
    "**Voz local**",
    "",
    "- **Lectura en voz alta:** usa la voz española del sistema (sin nube).",
    "- **Dictado:** el botón de micrófono ya envía audio al motor local (Whisper cuando esté instalado en el sidecar Python).",
    "- En Windows, Piper u otra voz TTS del sistema mejora la naturalidad; no hace falta un modelo TTS enorme en Ollama.",
  ].join("\n");
}
