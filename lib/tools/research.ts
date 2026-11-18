export function researchBrief(input: string): { applicable: boolean; answer: string; notes: string } {
  const question = input.trim().replace(/\s+/g, " ");
  if (question.length < 8) {
    return {
      applicable: false,
      answer: "Escribe la pregunta que quieres investigar. La parto en subpreguntas, en evidencias que tendrías que encontrar y en un esquema corto.",
      notes: "",
    };
  }
  const lower = question.toLowerCase();
  let angles: string[];
  if (/compara|diferencia|versus|\bvs\b|frente a/.test(lower)) {
    angles = [
      "Qué es cada término, en una frase y sin mezclarlos.",
      "En qué criterio concreto se diferencian (tiempo, costo, causa, uso).",
      "Un caso donde el primero sirva y el segundo no.",
    ];
  } else if (/por qu[eé]|causa|motivo/.test(lower)) {
    angles = [
      "Cuál es el hecho que se quiere explicar.",
      "Qué causa está mejor sostenida y qué evidencia la muestra.",
      "Qué otra explicación quedaría en pie si esa evidencia fallara.",
    ];
  } else if (/c[oó]mo\b|pasos|manera de/.test(lower)) {
    angles = [
      "Cuál es el resultado que se quiere lograr.",
      "Cuáles son los pasos en orden y qué hace falta en cada uno.",
      "Dónde se suele romper el procedimiento.",
    ];
  } else {
    angles = [
      "Qué se está preguntando, en una sola frase.",
      "Por qué importa ahora, no en abstracto.",
      "Un ejemplo verificable y un caso que no encaje.",
    ];
  }
  const answer = [
    `**Pregunta:** ${question}`,
    "",
    "Subpreguntas para no responder de una sola vez:",
    "",
    ...angles.map((angle, index) => `${index + 1}. ${angle}`),
    "",
    "**Antes de dar una respuesta por cierta**",
    "",
    "- Un dato con número, fecha o nombre.",
    "- De dónde sale ese dato.",
    "- Qué encontraría alguien que quisiera contradecirlo.",
    "",
    "**Esquema de una página**",
    "",
    "1. La pregunta, reformulada.",
    "2. La respuesta en cuatro oraciones.",
    "3. La evidencia y su límite.",
    "4. Lo que sigue abierto.",
  ].join("\n");
  return {
    applicable: true,
    answer,
    notes: `Subpreguntas:\n${angles.map((angle) => `- ${angle}`).join("\n")}`,
  };
}
