/** Catálogo de modelos Ollama locales para Lumen (PC Windows / Linux). */

export type OllamaChatModelId =
  | "deepseek-r1:1.5b"
  | "qwen2.5:7b"
  | "deepseek-r1:7b"
  | "llama3.1:8b";

export type OllamaChatModelOption = {
  id: OllamaChatModelId;
  label: string;
  blurb: string;
  /** RAM recomendada en GB (sistema + modelo cuantizado). */
  minRamGb: number;
  /** VRAM NVIDIA recomendada; 0 = sirve en CPU. */
  minVramGb: number;
  quality: "rápido" | "equilibrado" | "mejor";
  role: "fallback" | "recomendado" | "alternativa";
};

export const OLLAMA_CHAT_MODELS: OllamaChatModelOption[] = [
  {
    id: "deepseek-r1:1.5b",
    label: "DeepSeek R1 1.5B",
    blurb: "Respaldo rápido en PCs justos. Menos fiable en español largo.",
    minRamGb: 6,
    minVramGb: 0,
    quality: "rápido",
    role: "fallback",
  },
  {
    id: "qwen2.5:7b",
    label: "Qwen 2.5 7B",
    blurb: "Mejor redacción en español para overview e Investigar. Recomendado en 16 GB.",
    minRamGb: 12,
    minVramGb: 6,
    quality: "mejor",
    role: "recomendado",
  },
  {
    id: "deepseek-r1:7b",
    label: "DeepSeek R1 7B",
    blurb: "Más capacidad de razonamiento; más lento y a veces verboso.",
    minRamGb: 12,
    minVramGb: 6,
    quality: "equilibrado",
    role: "alternativa",
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    blurb: "Buena alternativa general; español aceptable con prompt estricto.",
    minRamGb: 14,
    minVramGb: 8,
    quality: "equilibrado",
    role: "alternativa",
  },
];

export const DEFAULT_FALLBACK_MODEL: OllamaChatModelId = "deepseek-r1:1.5b";
export const DEFAULT_QUALITY_MODEL: OllamaChatModelId = "qwen2.5:7b";

export function isOllamaChatModelId(value: unknown): value is OllamaChatModelId {
  return typeof value === "string" && OLLAMA_CHAT_MODELS.some((item) => item.id === value);
}

export type HardwareProfile = {
  ramGb: number | null;
  vramGb: number | null;
  gpuName: string | null;
  source: "detected" | "unknown";
};

/** Elige modelo por defecto según RAM/VRAM (Asus TUF A15 típico: 16 GB + NVIDIA). */
export function pickDefaultOllamaModel(hardware: HardwareProfile): OllamaChatModelId {
  const ram = hardware.ramGb ?? 0;
  const vram = hardware.vramGb ?? 0;
  // 16 GB RAM o ≥6 GB VRAM → 7B de calidad.
  if (vram >= 6 || ram >= 14) return DEFAULT_QUALITY_MODEL;
  if (ram >= 10 && vram >= 4) return DEFAULT_QUALITY_MODEL;
  return DEFAULT_FALLBACK_MODEL;
}

export function modelOption(id: string): OllamaChatModelOption | undefined {
  return OLLAMA_CHAT_MODELS.find((item) => item.id === id);
}

export function describeHardware(hardware: HardwareProfile): string {
  const parts: string[] = [];
  if (hardware.ramGb != null) parts.push(`${hardware.ramGb} GB RAM`);
  if (hardware.gpuName) {
    parts.push(
      hardware.vramGb != null
        ? `${hardware.gpuName} (${hardware.vramGb} GB VRAM)`
        : hardware.gpuName,
    );
  } else if (hardware.vramGb != null) {
    parts.push(`${hardware.vramGb} GB VRAM`);
  }
  if (!parts.length) return "Hardware no detectado; se asume perfil conservador.";
  return parts.join(" · ");
}
