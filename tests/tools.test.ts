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
  assert.match(result.answer, /conjunto de criterios|Metodología|RAG|Contexto RAG/i);
  assert.doesNotMatch(result.answer, /^Subpreguntas para no responder/m);
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
