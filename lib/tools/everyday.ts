import { appendCitations } from "@/lib/rag/citations";
import { gatherSources } from "@/lib/tools/sources";
import { ollamaChat } from "@/lib/ollama";

export type EverydayResult = {
  applicable: boolean;
  answer: string;
  notes: string;
};

export async function handleEmergency(input: string): Promise<EverydayResult> {
  const sources = await gatherSources(input);
  const answer = [
    "_Herramienta: Emergencia_",
    "",
    "**Acción inmediata (no sustituye a servicios de emergencia)**",
    "",
    "1. Asegura tu seguridad y la de otros: aléjate del peligro si puedes.",
    "2. Llama o pide a alguien que llame a emergencias locales (en muchos países: 123 / 911).",
    "3. Si hay heridos conscientes, mantén la calma, no muevas cuello/espalda si hay trauma.",
    "4. Controla hemorragias visibles con presión firme con un paño limpio.",
    "5. No des medicamentos ni líquidos si la persona está inconsciente.",
    "",
    "**Según tu consulta**",
    "",
    summarizeEmergency(input),
    "",
    "_Si la situación es real, prioriza ayuda profesional ahora._",
  ].join("\n");
  return {
    applicable: true,
    answer: appendCitations(answer, {
      sources: sources.slice(0, 6).map((s) => ({ title: `${s.source}: ${s.title}`, url: s.url })),
    }),
    notes: sources
      .slice(0, 3)
      .map((s) => `${s.title}: ${s.summary.slice(0, 160)}`)
      .join("\n"),
  };
}

export async function handleDailyLife(input: string): Promise<EverydayResult> {
  const sources = await gatherSources(input);
  const answer = [
    "_Herramienta: Vida diaria_",
    "",
    "**Consejo práctico**",
    "",
    practicalDaily(input),
    "",
    "**Qué evitar**",
    "",
    "- Remedios milagro o dosis altas sin criterio médico.",
    "- Autodiagnóstico si hay fiebre alta, dolor fuerte, sangre o dificultad para respirar.",
    "",
    "**Cuándo acudir a un profesional**",
    "",
    "- Síntomas que empeoran, no mejoran en 48–72 h, o afectan a niños/embarazo/enfermedades crónicas.",
  ].join("\n");
  return {
    applicable: true,
    answer: appendCitations(answer, {
      sources: sources.slice(0, 6).map((s) => ({ title: `${s.source}: ${s.title}`, url: s.url })),
    }),
    notes: sources
      .slice(0, 4)
      .map((s) => `${s.title}: ${s.summary.slice(0, 180)}`)
      .join("\n"),
  };
}

export async function handleProject(input: string): Promise<EverydayResult> {
  const sources = await gatherSources(input);
  const context = sources
    .slice(0, 4)
    .map((s) => `- ${s.title}: ${s.summary.slice(0, 180)}`)
    .join("\n");
  const citations = {
    sources: sources.slice(0, 6).map((s) => ({ title: `${s.source}: ${s.title}`, url: s.url })),
  };
  const local = await ollamaChat({
    system:
      "Eres un planificador práctico. Entrega fases, materiales y pasos numerados en español. Sé concreto. Máximo 400 palabras.",
    prompt: `Proyecto o guía pedida:\n${input}\n\nContexto web:\n${context || "(sin web)"}`,
  });
  if (local.ok && local.text) {
    const think = local.thinking ? `<think>${local.thinking}</think>\n\n` : "";
    return {
      applicable: true,
      answer: appendCitations(`_Herramienta: Proyecto (deepseek-r1:1.5b)_\n\n${think}${local.text}`, citations),
      notes: context,
    };
  }
  return {
    applicable: true,
    answer: appendCitations(
      [
        "_Herramienta: Proyecto_",
        "",
        "**Plan por fases**",
        "",
        "1. **Definir objetivo** — qué quieres lograr y para cuándo.",
        "2. **Materiales / requisitos** — lista mínima para empezar.",
        "3. **Fase 1 (arranque)** — primer resultado usable en poco tiempo.",
        "4. **Fase 2 (construir)** — núcleo del trabajo.",
        "5. **Fase 3 (probar y ajustar)** — validar y corregir.",
        "",
        `Pedido: ${input}`,
        "",
        "_Para un plan más fino, arranca Ollama con `deepseek-r1:1.5b`._",
      ].join("\n"),
      citations,
    ),
    notes: context,
  };
}

function summarizeEmergency(input: string): string {
  const lower = input.toLowerCase();
  if (/incendio|fuego|humo/.test(lower)) {
    return [
      "- Si hay fuego: sal del lugar; no uses el ascensor.",
      "- Cierra puertas a tu paso para frenar el humo.",
      "- Si el humo es denso, avanza agachado cerca del suelo.",
      "- No vuelvas a entrar por objetos.",
    ].join("\n");
  }
  if (/ahog|heimlich|atragant/.test(lower)) {
    return [
      "- Si tose con fuerza: anímale a seguir tosiendo.",
      "- Si no puede hablar/toser: 5 palmadas entre omóplatos; luego Heimlich si sabes hacerlo.",
      "- Llama a emergencias si no se resuelve al instante.",
    ].join("\n");
  }
  if (/sangr|hemorrag|corte/.test(lower)) {
    return [
      "- Presión directa continua varios minutos.",
      "- Eleva la zona si es una extremidad y no hay fractura evidente.",
      "- No retires objetos clavados; inmoviliza y busca ayuda.",
    ].join("\n");
  }
  return "- Describe la emergencia a los operadores y sigue sus instrucciones.";
}

function practicalDaily(input: string): string {
  const lower = input.toLowerCase();
  if (/resaca|hangover/.test(lower)) {
    return [
      "- Hidrátate con agua o suero oral; come algo ligero (plátano, tostada).",
      "- Evita más alcohol y analgésicos fuertes sin consejo (sobre todo con estómago vacío).",
      "- Descansa; si hay confusión, vómito persistente o pecho/dolor intenso, busca atención.",
    ].join("\n");
  }
  if (/gripa|resfriado|tos|fiebre/.test(lower)) {
    return [
      "- Reposo, líquidos y ambiente ventilado.",
      "- Antitérmicos de uso común solo si conoces la dosis adecuada a tu edad/peso.",
      "- Acude a consulta si fiebre alta >3 días, dificultad respiratoria o dolor fuerte.",
    ].join("\n");
  }
  if (/cocin|receta|comida/.test(lower)) {
    return "- Define el plato, ingredientes que ya tienes, tiempo disponible y un método simple (sartén/horno/olla).";
  }
  return "- Ve al punto práctico: qué quieres lograr hoy, con qué recursos y en cuánto tiempo.";
}
