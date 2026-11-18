import type { ActivityId, Effort, ModelId } from "@/lib/types";

export type Activity = {
  id: ActivityId;
  number: string;
  label: string;
  blurb: string;
  placeholder: string;
  starters: string[];
  system: string;
};

export const ACTIVITIES: Activity[] = [
  {
    id: "estudiar",
    number: "01",
    label: "Estudiar",
    blurb: "Explica el tema y arma un plan de estudio con preguntas.",
    placeholder: "El tema, la duda o los apuntes…",
    starters: [
      "Explícame las fracciones equivalentes como si fuera la primera clase.",
      "Tengo examen de programación. Ayúdame a repasar ciclos y funciones.",
    ],
    system:
      "Eres tutor. Ayudas a entender, no a entregar la tarea hecha. Empiezas por la idea central, das un ejemplo y un caso que no encaja, y cierras con una pregunta que la persona pueda responder sin mirar. Si hay apuntes, te apoyas en ellos y no inventas datos que no estén.",
  },
  {
    id: "programar",
    number: "02",
    label: "Programar",
    blurb: "Revisa código o arma un ejemplo corto cuando lo pidas.",
    placeholder: "Pega la función, el archivo corto o el error…",
    starters: [
      "```js\nfunction promedio(notas) {\n  var total = 0;\n  for (var i = 0; i <= notas.length; i++) {\n    total += notas[i];\n  }\n  console.log(total);\n  return total / notas.length;\n}\n```",
      "Me sale TypeError: Cannot read properties of undefined. ¿Por dónde empiezo a leer el error?",
    ],
    system:
      "Eres quien revisa código con un estudiante. Explicas la causa antes de soltar el parche. Nombras el archivo o la función de la que hablas. Si falta contexto, pides el fragmento mínimo. No inventas una librería que el código no usa.",
  },
  {
    id: "escribir",
    number: "03",
    label: "Escribir",
    blurb: "Revisa un párrafo o redacta un borrador si lo pides.",
    placeholder: "Pega el párrafo o el ensayo…",
    starters: [
      "La inteligencia artificial es muy importante y muy útil y mucha gente la usa porque es muy importante para el futuro y para estudiar y para trabajar y para todo.",
    ],
    system:
      "Eres editor de textos en español. Conservas la voz de quien escribe. Señalas una frase concreta, dices por qué pesa y propones una versión más clara. No reescribes el texto entero salvo que te lo pidan.",
  },
  {
    id: "calcular",
    number: "04",
    label: "Calcular",
    blurb: "Porcentajes, operaciones, ecuaciones lineales, mcd y raíces.",
    placeholder: "15% de 240, o 2x + 5 = 17…",
    starters: ["¿Cuánto es el 15% de 240?", "Resuelve 2x + 5 = 17"],
    system:
      "Eres quien resuelve cuentas con un estudiante. Muestras los pasos y una comprobación. Si el taller ya calculó un resultado, ese número manda: explícalo, no lo cambies. Si la cuenta no es lineal o no está completa, dilo.",
  },
  {
    id: "organizar",
    number: "05",
    label: "Organizar",
    blurb: "Pasa una lista suelta a un orden con lo urgente primero.",
    placeholder: "Las pendientes, como te salgan…",
    starters: [
      "Mañana examen de cálculo, el viernes entregar el ensayo y hoy revisar los apuntes de Python.",
    ],
    system:
      "Ayudas a ordenar el día. No agregas tareas que la persona no dijo. Pones primero lo que vence hoy o mañana y dejas un bloque de tiempo para la primera. Si falta una fecha, lo marcas en vez de inventarla.",
  },
  {
    id: "traducir",
    number: "06",
    label: "Traducir",
    blurb: "Traduce entre español e inglés y marca nombres propios.",
    placeholder: "El párrafo que quieres pasar a otro idioma…",
    starters: [
      "La Universidad Nacional Abierta y a Distancia queda en Bogotá y el curso de programación empieza el lunes.",
    ],
    system:
      "Traduces entre español e inglés, hacia el idioma que no sea el del texto, salvo que te pidan otro. Conservas nombres de personas, instituciones y productos. No resumes: traduces. Si una frase tiene dos lecturas, eliges una y la nombras.",
  },
  {
    id: "resumir",
    number: "07",
    label: "Resumir",
    blurb: "Saca las oraciones que concentran un texto largo.",
    placeholder: "Pega el apunte o el artículo…",
    starters: [
      "Un ciclo repite un bloque mientras una condición se cumple. En Python, for recorre una secuencia y while repite hasta que la condición cambia. El error más común es olvidar actualizar la variable de control y dejar el ciclo infinito. Una función guarda ese bloque con un nombre y parámetros. Si la función no devuelve nada, el valor que llega afuera es None. Para estudiar conviene escribir un ejemplo con una lista de notas, contar cuántas veces entra el ciclo y decir qué devuelve la función cuando la lista está vacía.",
    ],
    system:
      "Resumes sin agregar datos que no estén en el texto. Empiezas por la idea que organiza el resto y después das los puntos, en el orden del original. Si el texto no alcanza, dices que es corto en vez de rellenarlo.",
  },
  {
    id: "investigar",
    number: "08",
    label: "Investigar",
    blurb: "Consulta varias bases verificables y cita cada fuente.",
    placeholder: "La pregunta que quieres investigar…",
    starters: [
      "¿Qué es la metodología de investigación?",
      "¿Dónde se ubica la pirámide de Giza?",
      "¿Por qué el agua hierve a menor temperatura en Bogotá que en la costa?",
    ],
    system:
      "Respondes con claridad y apoyas lo que afirmas en fuentes con enlace (Wikipedia, Wikidata, OpenAlex, Crossref, Europe PMC, Open Library). No inventas citas, DOI, cifras ni autores. Si las bases discrepan, lo dices.",
  },
];

export const ACTIVITY_MAP = Object.fromEntries(ACTIVITIES.map((activity) => [activity.id, activity])) as Record<
  ActivityId,
  Activity
>;

export const MODEL_LABEL: Record<ModelId, { api: string; title: string; recipe: string }> = {
  flash: { api: "deepseek-flash", title: "Flash", recipe: "DeepSeek-V4.1-Flash" },
  pro: { api: "deepseek-v4-pro", title: "Pro", recipe: "DeepSeek-V4-Pro" },
};

export const EFFORT_LABEL: Record<Effort, string> = {
  low: "Bajo",
  high: "Alto",
  max: "Máximo",
};

export function bogotaDate(now: Date): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);
}

export function systemPrompt(activity: Activity, notes: string, now?: Date): string {
  const lines = [
    activity.system,
    "Responde en el idioma de la persona. Si no está claro, responde en español.",
  ];
  if (now) lines.push(`Fecha en America/Bogota: ${bogotaDate(now)}.`);
  if (notes) {
    lines.push("", "Notas del taller, calculadas en el servidor. Úsalas y no las contradigas:", notes);
  }
  return lines.join("\n");
}
