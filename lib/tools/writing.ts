import { sentences, STOPWORDS, words } from "@/lib/tools/spanish";

export function reviewWriting(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  const draftRequest = text.match(
    /^(?:escribe|redacta|ayúdame a escribir|ayudame a escribir|haz(?:me)?|quiero escribir|inventar?|cuéntame|cuentame)\s+(?:un[a]?\s+)?(.+)/i,
  );
  if (draftRequest?.[1]) {
    return draftText(draftRequest[1].trim(), text);
  }

  const tokens = words(text);
  if (tokens.length < 12) {
    return {
      applicable: false,
      answer: [
        "Pega el párrafo para revisarlo, o pide un borrador:",
        "",
        "- «Escribe un correo para pedir prórroga del ensayo»",
        "- «Redacta un párrafo absurdo sobre un plátano que da clases»",
      ].join("\n"),
      notes: "",
    };
  }

  const parts = sentences(text);
  const sentenceCount = Math.max(parts.length, 1);
  const average = tokens.length / sentenceCount;
  const counts = new Map<string, number>();
  for (const word of tokens) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const repeats = [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const notes: string[] = [];
  if (average > 28) {
    notes.push(
      `Las oraciones promedian ${average.toFixed(0)} palabras. Parte en dos las que expliquen más de una idea.`,
    );
  } else if (average < 10 && sentenceCount > 3) {
    notes.push("Las oraciones son muy cortas seguidas. Une las que formen una sola idea.");
  } else {
    notes.push(`El largo medio es de ${average.toFixed(0)} palabras por oración, cómodo para leer.`);
  }
  if (!/[.!?]$/.test(text)) {
    notes.push("El texto no cierra con punto, interrogación o exclamación.");
  }
  if (repeats.length) {
    notes.push(
      `Se repiten: ${repeats.map(([word, count]) => `${word} (${count})`).join(", ")}. Cambia alguna por un dato concreto.`,
    );
  }
  if (/muy importante|muy útil|para todo/.test(text.toLowerCase())) {
    notes.push(
      "Hay muletillas («muy importante», «muy útil», «para todo»). Sustitúyelas por un ejemplo concreto.",
    );
  }
  if (tokens.length > 120 && parts.length < 4) {
    notes.push("Para un texto de este tamaño ayudan tres bloques: de qué trata, el desarrollo y el cierre.");
  }

  const heaviest = [...parts].sort((a, b) => words(b).length - words(a).length)[0];
  let rewrite = "";
  if (heaviest && words(heaviest).length >= 22) {
    notes.push(`La oración más cargada empieza así: «${heaviest.slice(0, 90)}${heaviest.length > 90 ? "…" : ""}».`);
    rewrite = [
      "",
      "**Versión más clara (propuesta)**",
      "",
      splitHeavySentence(heaviest),
    ].join("\n");
  }

  const answer = [
    `**${tokens.length} palabras** · ${sentenceCount} oraciones · unas ${Math.max(1, Math.round(tokens.length / 200))} min de lectura`,
    "",
    ...notes.map((note) => `- ${note}`),
    rewrite,
  ].join("\n");
  return {
    applicable: true,
    answer,
    notes: `${tokens.length} palabras, ${sentenceCount} oraciones. ${notes.join(" ")}`,
  };
}

function draftText(topic: string, original: string): { applicable: boolean; answer: string; notes: string } {
  const lower = original.toLowerCase();
  if (/correo|email|e-mail|mensaje/.test(lower)) {
    const answer = [
      "**Borrador de correo**",
      "",
      "Asunto: Solicitud relacionada con " + clip(topic, 60),
      "",
      "Buenos días:",
      "",
      `Le escribo para ${topic.replace(/^para\s+/i, "")}.`,
      "",
      "Quedo atento(a) a su respuesta. Gracias por su tiempo.",
      "",
      "Saludos cordiales,",
      "[Tu nombre]",
    ].join("\n");
    return { applicable: true, answer, notes: "Borrador de correo." };
  }

  if (/absurdo|loco|raro|humor|pl[aá]tano|unicornio|drag[oó]n|banana/.test(lower) || /absurdo/.test(topic.toLowerCase())) {
    const subject = topic
      .replace(/^p[aá]rrafo\s+/i, "")
      .replace(/^absurdo\s+(sobre\s+)?/i, "")
      .replace(/^sobre\s+/i, "")
      .trim();
    const answer = [
      `**Párrafo pedido:** ${subject}`,
      "",
      `Nadie esperaba que ${subject} abriera la clase con una tiza en la mano y un mapa del siglo XIX bajo el brazo. Declaró, con total seriedad, que las guerras se entienden mejor si uno parte de la cáscara y llega al centro, y que todo imperio cae cuando se pone negro por fuera. Los alumnos tomaron apuntes. El director aplaudió. Al recreo, ${subject.split(" ")[0] || "el protagonista"} repartió tareas: memoricen tres fechas y no me pelen la paciencia.`,
      "",
      "Si quieres otro tono (más serio, más corto o en primera persona), dímelo.",
    ].join("\n");
    return { applicable: true, answer, notes: `Párrafo creativo sobre «${subject}».` };
  }

  const clean = topic.replace(/\.$/, "");
  const answer = [
    `**Borrador sobre:** ${clean}`,
    "",
    `${capitalize(clean)} se entiende mejor cuando se explica con un ejemplo cercano y un límite claro. En la práctica, conviene empezar por la idea central, mostrar un caso concreto y cerrar con lo que todavía no se puede afirmar.`,
    "",
    `Por eso, al escribir sobre ${clean}, ayuda fijar tres bloques: qué es, para qué sirve y qué malentendido hay que evitar. Así el texto no se queda en opiniones sueltas.`,
    "",
    "Edita nombres, fechas y el cierre según tu consignatura.",
  ].join("\n");
  return { applicable: true, answer, notes: `Borrador sobre «${clean}».` };
}

function splitHeavySentence(sentence: string): string {
  const parts = sentence.split(/\s+y\s+/i);
  if (parts.length >= 3) {
    return `${parts[0]}. Además, ${parts.slice(1, -1).join(", y ")}. Por último, ${parts.at(-1)}`;
  }
  if (parts.length === 2) {
    return `${parts[0]}. ${capitalize(parts[1])}`;
  }
  const because = sentence.split(/\sporque\s+/i);
  if (because.length === 2) {
    return `${because[0]}. La razón es que ${because[1]}`;
  }
  return sentence;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
