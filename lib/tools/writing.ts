import { sentences, STOPWORDS, words } from "@/lib/tools/spanish";

export function reviewWriting(input: string): { applicable: boolean; answer: string; notes: string } {
  const text = input.trim();
  const draftRequest = text.match(
    /^(?:escribe|redacta|ayúdame a escribir|ayudame a escribir|haz(?:me)?|quiero escribir)\s+(?:un[a]?\s+)?(.+)/i,
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
        "- «Redacta una introducción sobre el reciclaje»",
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
    .filter(([, count]) => count >= 4)
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
  if (tokens.length > 120 && parts.length < 4) {
    notes.push("Para un texto de este tamaño ayudan tres bloques: de qué trata, el desarrollo y el cierre.");
  }

  const heaviest = [...parts].sort((a, b) => words(b).length - words(a).length)[0];
  if (heaviest && words(heaviest).length >= 22) {
    notes.push(`La oración más cargada empieza así: «${heaviest.slice(0, 90)}${heaviest.length > 90 ? "…" : ""}».`);
  }

  const answer = [
    `**${tokens.length} palabras** · ${sentenceCount} oraciones · unas ${Math.max(1, Math.round(tokens.length / 200))} min de lectura`,
    "",
    ...notes.map((note) => `- ${note}`),
    "",
    "Si quieres, pega solo la oración más pesada y te propongo una versión más clara.",
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
      "",
      "Ajústalo con fechas, nombres y el tono de tu institución.",
    ].join("\n");
    return { applicable: true, answer, notes: "Borrador de correo generado en el taller." };
  }

  if (/introducci[oó]n|ensayo|p[aá]rrafo|texto|relato|carta/.test(lower) || topic.length > 8) {
    const clean = topic.replace(/\.$/, "");
    const answer = [
      `**Borrador sobre:** ${clean}`,
      "",
      `${capitalize(clean)} importa porque permite entender el tema con orden y ejemplos concretos. En la vida diaria y en el estudio aparece cuando hay que explicar una idea a otra persona sin perder el hilo.`,
      "",
      "Para desarrollarlo conviene partir de una definición breve, mostrar un caso cercano y cerrar con lo que aún queda por comprobar. Así el texto no se queda en opiniones sueltas ni en listas sin argumento.",
      "",
      "En resumen, escribir sobre este punto ayuda a fijar lo esencial y a distinguir lo que sí se puede afirmar de lo que todavía es duda.",
      "",
      "Edita nombres, datos y el cierre según tu consignatura.",
    ].join("\n");
    return { applicable: true, answer, notes: `Borrador de párrafo sobre «${clean}».` };
  }

  return {
    applicable: false,
    answer: "Dime qué tipo de texto necesitas (correo, introducción, párrafo) y el tema.",
    notes: "",
  };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
