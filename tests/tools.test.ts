import assert from "node:assert/strict";
import test from "node:test";
import { composeConversation } from "../lib/compose";
import { parseChatRequest } from "../lib/chat-request";
import { findLesson, parseCorrectionMessage, upsertLesson } from "../lib/lessons";
import { runActivity } from "../lib/tools/index";

test("15% de 240 es 36", async () => {
  const result = await runActivity("calcular", "¿Cuánto es el 15% de 240?");
  assert.equal(result.applicable, true);
  assert.match(result.answer, /\*\*36\*\*/);
});

test("calcular no se corta en el primer +", async () => {
  const result = await runActivity("calcular", "50+20-100*125");
  assert.equal(result.applicable, true);
  assert.match(result.answer, /\*\*-12\.?430\*\*|\*\*-12430\*\*/);
  assert.doesNotMatch(result.answer, /^\*\*70\*\*$/m);
});

test("calcular resuelve expresión con raíz pegada", async () => {
  const result = await runActivity("calcular", "50+20-100/125*2654raiz2");
  assert.equal(result.applicable, true);
  assert.doesNotMatch(result.answer, /\*\*70\*\*/);
  // 70 - (100/125)*2654*sqrt(2) ≈ -2932.68
  assert.match(result.answer, /-2\.?932/);
});

test("ecuación lineal 2x + 5 = 17", async () => {
  const result = await runActivity("calcular", "Resuelve 2x + 5 = 17");
  assert.match(result.answer, /x = 6/);
  assert.match(result.answer, /Comprobación/);
});

test("mcd de 48 y 18", async () => {
  const result = await runActivity("calcular", "mcd de 48 y 18");
  assert.match(result.answer, /\*\*6\*\*/);
});

test("raíz cuadrada de 144", async () => {
  const result = await runActivity("calcular", "raíz cuadrada de 144");
  assert.match(result.answer, /\*\*12\*\*/);
});

test("la lectura de código marca el índice fuera por uno", async () => {
  const result = await runActivity(
    "programar",
    "```js\nfunction promedio(notas) {\n  var total = 0;\n  for (var i = 0; i <= notas.length; i++) {\n    total += notas[i];\n  }\n  console.log(total);\n}\n```",
  );
  assert.match(result.answer, /length - 1/);
  assert.match(result.answer, /var/);
});

test("organizar pone hoy antes que el viernes", async () => {
  const result = await runActivity(
    "organizar",
    "Mañana examen de cálculo, el viernes entregar el ensayo y hoy revisar los apuntes de Python.",
  );
  assert.equal(result.applicable, true);
  const lines = result.answer.split("\n").filter((line) => /^\d+\./.test(line));
  assert.match(lines[0] ?? "", /hoy/);
  assert.match(lines.at(-1) ?? "", /viernes/);
});

test("resumir extrae oraciones de un texto largo", async () => {
  const text = Array.from({ length: 6 }, (_, index) => {
    return `El ciclo ${index} repite un bloque mientras la condición de las notas se cumple y la función devuelve un promedio.`;
  }).join(" ");
  const result = await runActivity("resumir", text);
  assert.equal(result.applicable, true);
  assert.match(result.answer, /ideas/);
});

test("rechaza una conversación que no termina en la persona", () => {
  const parsed = parseChatRequest({
    activity: "calcular",
    model: "flash",
    effort: "high",
    thinking: true,
    messages: [{ role: "assistant", content: "hola" }],
  });
  assert.ok("error" in parsed);
});

test("investigar responde qué es la metodología de investigación", async () => {
  const result = await runActivity("investigar", "que es la metodologia de investigacion");
  assert.match(result.answer, /conjunto de criterios|Metodología|RAG|Contexto RAG|fuentes/i);
  assert.doesNotMatch(result.answer, /^Subpreguntas para no responder/m);
  assert.ok(result.answer.length > 200, "la respuesta de investigar debe ser informativa");
});

test("investigar define perrera con significados y ejemplos", async () => {
  const result = await runActivity("investigar", "Perrera");
  assert.match(result.answer, /lugar o instalaci[oó]n|alojar perros/i);
  assert.match(result.answer, /Refugio|Caseta|albergue/i);
  assert.doesNotMatch(result.answer, /Qué dicen las fuentes|injuries|SpanishDictionary/i);
});

test("investigar define casas en español sin ruido CASAS/Municipality", async () => {
  const result = await runActivity("investigar", "Casas");
  assert.match(result.answer, /plural de casa|vivienda o residencia/i);
  assert.match(result.answer, /Vivienda|Hogar|residencia/i);
  assert.doesNotMatch(result.answer, /Assessment Systems|Municipality|TOPSpro|kilometers/i);
  assert.doesNotMatch(result.answer, /Qué dicen las fuentes/i);
});

test("investigar define ciudades como ficha y no demografía", async () => {
  const result = await runActivity("investigar", "Ciudades");
  assert.match(result.answer, /asentamiento humano|servicios urbanos|ciudad/i);
  assert.doesNotMatch(result.answer, /Chiclayo|Huancayo|Iquitos|Lima Metropolitana|32\s*%/i);
  assert.doesNotMatch(result.answer, /Qué dicen las fuentes|Hechos clave/i);
});

test("investigar responde ejemplos de ciudad en formato overview", async () => {
  const { researchBrief } = await import("../lib/tools/research");
  const result = await researchBrief("ejemplos de ciudad", {
    webSearch: false,
    ollamaModel: process.env.OLLAMA_QUALITY_MODEL || "qwen2.5:7b",
  });
  // Offline: modelo local (7B preferido). No inventa fuentes web.
  assert.match(result.answer, /Respondido sin internet|Bogot[aá]|ciudad/i);
  assert.equal((result.sources || []).filter((s) => s.url?.startsWith("http")).length, 0);
  assert.doesNotMatch(result.answer, /Qué dicen las fuentes|Hechos clave|peciales|Ciudad Line\b/i);
  assert.doesNotMatch(result.answer, /Descubre qu[eé] es una ciudad|Spanish word for/i);
  assert.doesNotMatch(result.answer, /##|\b\d{1,2}:\d{2}\b/);
  if (result.applicable) {
    assert.match(result.answer, /Bogot[aá]|Medell[ií]n|Cali|ciudad/i);
  }
});

test("isUsableSourceSnippet rechaza scrapes truncados", async () => {
  const { isUsableSourceSnippet } = await import("../lib/tools/research");
  assert.equal(
    isUsableSourceSnippet(
      "peciales. Conoce la definición, la historia, los tipos y los problemas de las ciudades en el mundo.",
    ),
    false,
  );
  assert.equal(
    isUsableSourceSnippet(
      "En este artículo, exploraremos ejemplos de ciudad que destacan por su arquitectura impresionante.",
    ),
    false,
  );
  assert.equal(
    isUsableSourceSnippet(
      "El chihuahua es una de las razas más pequeñas del mundo y suele pesar menos de tres kilos.",
    ),
    true,
  );
});

test("buildDefinitionDraft estructura una definición desde fuentes", async () => {
  const { buildDefinitionDraft, looksLikeDefinitionQuery, isUsableDefinitionSentence } = await import(
    "../lib/tools/research"
  );
  assert.equal(looksLikeDefinitionQuery("Perrera"), true);
  assert.equal(looksLikeDefinitionQuery("razas de perros muy pequeños en zoológico"), false);
  assert.equal(
    isUsableDefinitionSentence(
      "n su territorio se encuentran tres bienes culturales de los treinta y cinco sitios Patrimonio de la Humanidad",
      "casa",
    ),
    false,
  );
  const draft = buildDefinitionDraft("canil", [
    {
      score: 0.5,
      chunk: {
        id: "1",
        documentId: "d1",
        title: "Canil",
        text: "Un canil es un recinto destinado a alojar perros. También se usa como sinónimo de perrera o refugio animal.",
        index: 0,
      },
    },
    {
      score: 0.2,
      chunk: {
        id: "2",
        documentId: "d2",
        title: "México",
        text: "n su territorio se encuentran tres bienes culturales de los treinta y cinco sitios Patrimonio de la Humanidad con los que cuenta el país.",
        index: 1,
      },
    },
  ]);
  assert.match(draft, /\*\*Canil\*\*/);
  assert.match(draft, /recinto destinado a alojar perros/i);
  assert.doesNotMatch(draft, /Qué dicen las fuentes/);
  assert.doesNotMatch(draft, /Patrimonio de la Humanidad|n su territorio/i);
});

test("no usa demografía peruana como significados de ciudad", async () => {
  const { buildDefinitionDraft, isFactualDump, isLexicalSense } = await import("../lib/tools/research");
  const junk =
    "Chiclayo y Huancayo; a éstas se les sumarían al año 2025 las ciudades de Iquitos y Cusco.";
  assert.equal(isFactualDump(junk), true);
  assert.equal(isLexicalSense(junk, "ciudades"), false);
  const draft = buildDefinitionDraft("ciudades", [
    {
      score: 0.5,
      chunk: {
        id: "1",
        documentId: "d1",
        title: "Ciudad",
        text: "Una ciudad es un asentamiento humano de tamaño considerable, con servicios urbanos.",
        index: 0,
      },
    },
    {
      score: 0.4,
      chunk: {
        id: "2",
        documentId: "d2",
        title: "Perú",
        text: junk + " Lima Metropolitana es la mayor concentración urbana con el 32 % de todos los habitantes.",
        index: 1,
      },
    },
  ]);
  assert.match(draft, /asentamiento humano/i);
  assert.doesNotMatch(draft, /Chiclayo|Huancayo|32\s*%|2025/i);
});

test("filtra colisiones en inglés y acrónimos para casas", async () => {
  const { buildDefinitionDraft, isAcronymOrForeignCollision, isEnglishHeavy } = await import(
    "../lib/tools/research"
  );
  assert.equal(
    isEnglishHeavy(
      "CASAS provides testing of basic and academic skills for youth and adults and curriculum tools",
    ),
    true,
  );
  assert.equal(
    isAcronymOrForeignCollision(
      {
        score: 0.1,
        chunk: {
          id: "x",
          documentId: "x",
          title: "CASAS",
          text: "Comprehensive Adult Student Assessment Systems provides testing of basic skills.",
          index: 0,
        },
      },
      "casas",
    ),
    true,
  );
  const draft = buildDefinitionDraft("casas", [
    {
      score: 0.9,
      chunk: {
        id: "1",
        documentId: "d1",
        title: "CASAS Municipality",
        text: "Casas Municipality is a rural administrative division in the central region of Tamaulipas, Mexico, encompassing 2,874 square kilometers.",
        index: 0,
      },
    },
    {
      score: 0.8,
      chunk: {
        id: "2",
        documentId: "d2",
        title: "CASAS",
        text: "CASAS provides testing of basic and academic skills for youth and adults.",
        index: 1,
      },
    },
  ]);
  assert.equal(draft, "");
});

test("buildResearchDraft arma secciones con fuentes", async () => {
  const { buildResearchDraft } = await import("../lib/tools/research");
  const draft = buildResearchDraft(
    "razas de perros pequeños",
    [
      {
        score: 0.5,
        chunk: {
          id: "1",
          documentId: "d1",
          title: "Chihuahua",
          text: "El chihuahua es una de las razas más pequeñas del mundo y suele pesar menos de tres kilos.",
          index: 0,
        },
      },
      {
        score: 0.4,
        chunk: {
          id: "2",
          documentId: "d2",
          title: "Aprendizaje: perros",
          text: "# Aprendizaje web: perros Fecha (America/Bogota): 2026-11-18 El pomerania es un perro pequeño de compañía.",
          index: 1,
        },
      },
    ],
  );
  assert.match(draft, /Chihuahua|pomerania/i);
  assert.doesNotMatch(draft, /Qué dicen las fuentes/);
  assert.doesNotMatch(draft, /Conviene contrastar los puntos anteriores/);
  assert.doesNotMatch(draft, /Aprendizaje: perros/);
  assert.doesNotMatch(draft, /# Aprendizaje/);
  assert.doesNotMatch(draft, /guanaco|caballo/i);
});

test("overview limpia scrapes y formatea respuesta directa + lista", async () => {
  const {
    prepareContextSnippets,
    buildOverviewFallback,
    formatOverviewMarkdown,
    looksLikeCleanOverview,
    scrubSnippet,
  } = await import("../lib/tools/overview");
  const dirty =
    "09:55 ## Hechos clave - peciales. Conoce la definición. Spanish word for city. See 2 authoritative tra";
  const scrubbed = scrubSnippet(dirty);
  assert.doesNotMatch(scrubbed, /##|\b09:55\b|Hechos clave/i);
  const snippets = prepareContextSnippets([
    {
      score: 0.5,
      chunk: {
        id: "1",
        documentId: "d1",
        title: "Aprendizaje: ejemplos de ciudad",
        text: dirty,
        index: 0,
      },
    },
    {
      score: 0.4,
      chunk: {
        id: "2",
        documentId: "d2",
        title: "Bogotá",
        text: "Bogotá es la capital de Colombia y centro administrativo del país.",
        index: 1,
      },
    },
  ]);
  assert.equal(snippets.some((s) => /peciales|Hechos clave/i.test(s.text)), false);
  const draft = buildOverviewFallback({
    question: "ejemplos de ciudad",
    snippets,
  });
  assert.ok(draft);
  const markdown = formatOverviewMarkdown(draft!);
  assert.match(markdown, /Bogot[aá]/i);
  assert.equal(looksLikeCleanOverview(markdown), true);
  assert.doesNotMatch(markdown, /Qué dicen las fuentes|##|Hechos clave/i);
});

test("splitToolBadge separa la etiqueta de herramienta", async () => {
  const { splitToolBadge } = await import("../lib/tool-badge");
  const split = splitToolBadge("_Herramienta: Investigar_\n\n**perros**\n\nTexto");
  assert.equal(split.tool, "Investigar");
  assert.match(split.content, /^\*\*perros\*\*/);
  assert.doesNotMatch(split.content, /Herramienta/);
});

test("chooseResearchAnswer conserva el borrador si el polish es relleno", async () => {
  const { buildResearchDraft, chooseResearchAnswer } = await import("../lib/tools/research");
  const draft = buildResearchDraft("perros pequeños", [
    {
      score: 0.5,
      chunk: {
        id: "1",
        documentId: "d1",
        title: "Chihuahua",
        text: "El chihuahua es una de las razas más pequeñas del mundo y suele pesar menos de tres kilos.",
        index: 0,
      },
    },
  ]);
  const padded = [
    "**Perros**",
    "",
    "1. **Aprendizaje: perros chiquitos** texto",
    "2. **Aprendizaje: perros chiquitos** texto",
    "3. **Aprendizaje: perros chiquitos** texto",
    "4. **Aprendizaje: perros chiquitos** texto",
    "5. **Aprendizaje: perros chiquitos** texto",
    "6. **Aprendizaje: perros chiquitos** texto",
  ].join("\n");
  const chosen = chooseResearchAnswer(padded, draft, "informativo", true);
  assert.match(chosen, /Chihuahua/);
  assert.doesNotMatch(chosen, /Aprendizaje: perros chiquitos/);
});

test("investigar ubica la pirámide de Giza con RAG", async () => {
  const result = await runActivity("investigar", "donde se ubica la piramide de giza");
  assert.equal(result.applicable, true);
  // Con Ollama: respuesta redactada. Sin Ollama: error detallado (nunca contexto crudo).
  assert.match(result.answer, /Guiza|Giza|Egipto|El Cairo|Detalle:|Ollama/i);
  assert.doesNotMatch(result.answer, /Contexto recuperado\. Úsalo para redactar/i);
});

test("RAG recupera fragmentos de un documento indexado", async () => {
  const { buildRagIndex, searchRagIndex } = await import("../lib/rag/index");
  const index = buildRagIndex([
    {
      id: "d1",
      title: "Apunte de ciclismo",
      text: "La bicicleta tiene dos ruedas. El pedaleo transmite fuerza a la cadena. Frenar a tiempo evita caídas en bajada.",
      source: "test",
      createdAt: Date.now(),
    },
  ]);
  const hits = searchRagIndex(index, "cómo frena una bicicleta en bajada", 2, 0.01);
  assert.ok(hits.length >= 1);
  assert.match(hits[0]!.chunk.text, /Frenar|ruedas|cadena/i);
});

test("motor Python RAG responde health si está arriba", async () => {
  const { engineHealth } = await import("../lib/rag/engine-client");
  const health = await engineHealth();
  if (!health) {
    assert.equal(health, null);
    return;
  }
  assert.equal(health.ok, true);
  assert.match(String(health.search || "duckduckgo"), /duckduckgo/i);
});

test("traducir pasa inglés a español", async () => {
  const result = await runActivity("traducir", "Hello world. The course starts on Monday.");
  assert.equal(result.applicable, true);
  assert.match(result.answer, /Hola|mundo|lunes|curso/i);
});

test("escribir arma un borrador de correo", async () => {
  const result = await runActivity("escribir", "Escribe un correo para pedir prórroga del ensayo");
  assert.equal(result.applicable, true);
  assert.match(result.answer, /Asunto|Buenos días/i);
});

test("programar genera un promedio en python", async () => {
  const result = await runActivity("programar", "Escribe una función en python para el promedio de una lista");
  assert.equal(result.applicable, true);
  assert.match(result.answer, /def promedio/);
});

test("programar cuenta bananas aunque el pedido suene raro", async () => {
  const result = await runActivity(
    "programar",
    "escribe una función en python que cuente cuántas veces aparece la palabra banana en un texto",
  );
  assert.equal(result.applicable, true);
  assert.match(result.answer, /def contar_palabra|banana/);
});

test("calcular resuelve patas de elefantes y mesas", async () => {
  const result = await runActivity("calcular", "cuántas patas tienen 3 elefantes y 2 mesas");
  assert.equal(result.applicable, true);
  assert.match(result.answer, /\*\*20\*\*/);
});

test("escribir redacta un párrafo absurdo pedido", async () => {
  const result = await runActivity(
    "escribir",
    "escribe un párrafo absurdo sobre un plátano que da clases de historia",
  );
  assert.equal(result.applicable, true);
  assert.match(result.answer, /plátano|tiza|clase/i);
  assert.doesNotMatch(result.answer, /importa porque permite entender el tema/);
});

test("estudiar arma plan para fotosíntesis", async () => {
  const result = await runActivity(
    "estudiar",
    "explica cómo estudiar para un examen de mañana sobre fotosíntesis",
  );
  assert.equal(result.applicable, true);
  assert.match(result.answer, /Fotosíntesis|clorofila|Plan para estudiar/i);
});

test("aprende una corrección y la reutiliza", async () => {
  const lessons = upsertLesson([], {
    activity: "calcular",
    question: "50+20-100*125",
    answer: "**-12430**",
  });
  const found = findLesson(lessons, "calcular", "50+20-100*125");
  assert.ok(found);
  const composed = await composeConversation({
    activity: "calcular",
    model: "flash",
    effort: "high",
    thinking: false,
    messages: [{ role: "user", content: "50+20-100*125" }],
    lessons,
  });
  assert.match(composed.answer, /-12430/);
  assert.equal(composed.learnedFrom, found!.id);
});

test("detecta mensajes de corrección", () => {
  const parsed = parseCorrectionMessage("está mal, la respuesta es -12430");
  assert.ok(parsed);
  assert.match(parsed!.answer, /-12430/);
});
