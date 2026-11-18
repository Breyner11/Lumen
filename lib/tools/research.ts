type ToolResult = { applicable: boolean; answer: string; notes: string };

/** Known short explanations for frequent school/university questions. */
const KNOWN: Array<{ match: RegExp; title: string; body: string }> = [
  {
    match: /metodolog[ií]a\s+de\s+(?:la\s+)?investigaci[oó]n|metodolog[ií]a\s+investigativa/,
    title: "Metodología de investigación",
    body: [
      "Es el **conjunto de criterios, pasos y técnicas** que usas para plantear un problema, recoger información, analizarla y llegar a conclusiones de forma ordenada y comprobable.",
      "",
      "No es solo “el método” suelto: es la justificación de **por qué** eliges un enfoque (cualitativo, cuantitativo o mixto), **cómo** vas a obtener datos (encuestas, entrevistas, observación, documentos, experimentos) y **con qué reglas** vas a interpretarlos.",
      "",
      "**Partes habituales**",
      "",
      "1. **Problema y pregunta.** Qué quieres saber y por qué importa.",
      "2. **Objetivos.** Qué vas a lograr (general y específicos).",
      "3. **Enfoque.** Cuantitativo (medir y comparar), cualitativo (comprender sentidos y contextos) o mixto.",
      "4. **Diseño.** Cómo se organiza el estudio (descriptivo, correlacional, experimental, estudio de caso, etc.).",
      "5. **Población y muestra.** A quién o a qué estudias, y cómo lo eliges.",
      "6. **Técnicas e instrumentos.** Encuesta, entrevista, guía de observación, rúbrica, prueba…",
      "7. **Análisis.** Cómo tratas los datos (estadística, categorías, triangulación).",
      "8. **Ética y límites.** Consentimiento, privacidad y qué no puedes afirmar.",
      "",
      "**Ejemplo rápido.** Si preguntas «¿cómo estudian los estudiantes de primer semestre?», la metodología diría: enfoque mixto, encuesta a 120 estudiantes y 8 entrevistas, análisis de frecuencias y de temas, y no generalizar a toda la universidad.",
      "",
      "En un trabajo académico, la metodología se escribe para que otra persona pueda **entender y, en lo posible, repetir** lo que hiciste.",
    ].join("\n"),
  },
  {
    match: /investigaci[oó]n\s+cient[ií]fica/,
    title: "Investigación científica",
    body: [
      "Es un proceso **sistemático** para producir conocimiento confiable: se parte de una pregunta, se revisa lo ya sabido, se elige un método, se recogen datos y se contrastan las conclusiones con la evidencia.",
      "",
      "Se distingue de una opinión porque deja ver **cómo** se llegó al resultado y admite revisión o crítica.",
    ].join("\n"),
  },
  {
    match: /\bhip[oó]tesis\b/,
    title: "Hipótesis",
    body: [
      "Es una **respuesta provisional** a la pregunta de investigación, formulada de modo que se pueda poner a prueba con datos.",
      "",
      "Ejemplo: «Los estudiantes que estudian con fichas recuerdan más conceptos a las dos semanas que quienes solo releen.» Luego se mide y se acepta, ajusta o rechaza esa idea.",
    ].join("\n"),
  },
  {
    match: /\bvariable(?:s)?\b.*investig|\binvestig.*\bvariable/,
    title: "Variables en investigación",
    body: [
      "Una **variable** es una característica que puede cambiar y que mides o describes en el estudio (edad, nota, motivación, temperatura).",
      "",
      "En diseños con causa y efecto suele hablarse de variable **independiente** (la que se manipula o se toma como factor) y **dependiente** (la que se observa como resultado).",
    ].join("\n"),
  },
];

export function researchBrief(input: string): ToolResult {
  const question = input.trim().replace(/\s+/g, " ");
  if (question.length < 3) {
    return {
      applicable: false,
      answer:
        "Escribe la pregunta. Te doy una respuesta clara y, si hace falta, cómo profundizarla con evidencia.",
      notes: "",
    };
  }

  const lower = question.toLowerCase();
  const known = KNOWN.find((item) => item.match.test(lower));
  if (known) {
    const answer = [`**${known.title}**`, "", known.body, "", deepen(lower)].join("\n");
    return {
      applicable: true,
      answer,
      notes: `${known.title}: explicación del taller sobre la pregunta del usuario.`,
    };
  }

  const definition = extractDefinitionTopic(lower, question);
  if (definition) {
    const answer = explainDefinition(definition);
    return {
      applicable: true,
      answer,
      notes: `Explicación local del concepto «${definition}».`,
    };
  }

  if (/por qu[eé]|causa|motivo/.test(lower)) {
    return {
      applicable: true,
      answer: [
        `**Respuesta corta.** Para «${question}» conviene separar el **hecho** de la **causa probable**.`,
        "",
        "1. **Hecho.** Di en una frase qué ocurre (sin explicar todavía).",
        "2. **Mecanismo.** Nombra la causa más plausible y cómo se conecta con el hecho.",
        "3. **Comprobación.** Qué dato, medición o comparación lo sostendría.",
        "4. **Alternativa.** Qué otra explicación quedaría si ese dato fallara.",
        "",
        "Si me das el tema con un poco más de contexto (curso, lugar o ejemplo), te armo la explicación completa en ese marco.",
        "",
        deepen(lower),
      ].join("\n"),
      notes: "Guía causal + pedido de contexto para completar la respuesta.",
    };
  }

  if (/c[oó]mo\b|pasos|manera de|procedimiento/.test(lower)) {
    return {
      applicable: true,
      answer: [
        `**Cómo enfocarlo:** ${question}`,
        "",
        "1. Define el resultado que quieres obtener.",
        "2. Lista los materiales o datos que hacen falta.",
        "3. Ordena los pasos de principio a fin.",
        "4. Marca el punto donde suele fallar el proceso.",
        "5. Di cómo sabrás que quedó bien hecho.",
        "",
        "Si concreta el caso (por ejemplo, un trabajo de la UNAD o un experimento de clase), te escribo los pasos ya aplicados a ese caso.",
        "",
        deepen(lower),
      ].join("\n"),
      notes: "Procedimiento general para la pregunta del usuario.",
    };
  }

  if (/compara|diferencia|versus|\bvs\b|frente a/.test(lower)) {
    return {
      applicable: true,
      answer: [
        `**Comparación pedida:** ${question}`,
        "",
        "Para no mezclar los términos:",
        "",
        "1. Define cada uno en una frase.",
        "2. Elige un criterio (propósito, método, resultado o ejemplo).",
        "3. Di en qué coinciden y en qué no.",
        "4. Da un caso donde el primero sirva y el segundo no.",
        "",
        "Si me nombras los dos conceptos con claridad, te dejo la tabla ya escrita.",
        "",
        deepen(lower),
      ].join("\n"),
      notes: "Plantilla de comparación lista para completar.",
    };
  }

  return {
    applicable: true,
    answer: [
      `Sobre **«${question}»**:`,
      "",
      "En modo taller te respondo con una explicación directa cuando el tema es claro (por ejemplo «qué es la metodología de investigación»).",
      "",
      "Para esta pregunta, lo más útil ahora es:",
      "",
      "1. **Reformúlala** en una sola frase interrogativa.",
      "2. **Acota el campo** (asignatura, nivel, país o ejemplo).",
      "3. **Pide el tipo de respuesta** que quieres: definición, causas, pasos o comparación.",
      "",
      "Ejemplo: «¿Qué es la metodología de investigación en un proyecto de grado?»",
      "",
      deepen(lower),
    ].join("\n"),
    notes: "Pedido de acotación para poder explicar con precisión.",
  };
}

function extractDefinitionTopic(lower: string, original: string): string | null {
  const patterns = [
    /^(?:qu[eé]\s+es(?:\s+la|\s+el|\s+los|\s+las)?|qu[eé]\s+significa|define|definici[oó]n\s+de|expl[ií]came\s+(?:qu[eé]\s+es)|habla(?:me)?\s+de)\s+(.+?)[\?¿!.]*$/i,
  ];
  for (const pattern of patterns) {
    const match = original.match(pattern);
    if (match?.[1]) return cleanTopic(match[1]);
  }
  if (/^qu[eé]\s+es\b/i.test(lower)) {
    return cleanTopic(original.replace(/^qu[eé]\s+es(?:\s+la|\s+el|\s+los|\s+las)?\s+/i, "").replace(/[\?¿!.]+$/g, ""));
  }
  return null;
}

function cleanTopic(topic: string): string {
  return topic.replace(/[\?¿!.]+$/g, "").replace(/\s+/g, " ").trim();
}

function explainDefinition(topic: string): string {
  const nice = topic.charAt(0).toUpperCase() + topic.slice(1);
  return [
    `**${nice}**`,
    "",
    `En pocas palabras: **${nice}** es el conjunto de ideas, reglas o prácticas que organizan ese tema para poder entenderlo, usarlo o estudiarlo con criterio.`,
    "",
    "Para explicarlo bien en clase o en un trabajo, suele bastar este orden:",
    "",
    `1. **Definición.** Qué es ${topic}, en una o dos oraciones.`,
    "2. **Para qué sirve.** Qué problema resuelve o qué permite hacer.",
    "3. **Partes o tipos.** Cómo se divide o en qué variantes aparece.",
    "4. **Ejemplo.** Un caso concreto de tu carrera o de la vida diaria.",
    "5. **Límite.** Con qué se confunde y cómo no usarlo mal.",
    "",
    "Si quieres, en el siguiente mensaje dime el **curso** (por ejemplo metodología, programación o estadística) y te dejo la definición ya redactada en tono de apunte.",
    "",
    deepen(topic.toLowerCase()),
  ].join("\n");
}

function deepen(lower: string): string {
  return [
    "**Para profundizar**",
    "",
    "- Busca una definición en tu guía o libro de la asignatura y compárala con esta.",
    "- Anota un ejemplo propio.",
    lower.includes("metodolog")
      ? "- Revisa si tu trabajo pide enfoque, diseño, población e instrumentos: ahí suele ir la metodología."
      : "- Si necesitas citas o un texto más largo, agrega la clave de DeepSeek o pégame el párrafo de tus apuntes.",
  ].join("\n");
}
