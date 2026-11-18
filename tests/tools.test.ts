import assert from "node:assert/strict";
import test from "node:test";
import { parseChatRequest } from "../lib/chat-request";
import { runActivity } from "../lib/tools/index";

test("15% de 240 es 36", () => {
  const result = runActivity("calcular", "¿Cuánto es el 15% de 240?");
  assert.equal(result.applicable, true);
  assert.match(result.answer, /\*\*36\*\*/);
});

test("ecuación lineal 2x + 5 = 17", () => {
  const result = runActivity("calcular", "Resuelve 2x + 5 = 17");
  assert.match(result.answer, /x = 6/);
  assert.match(result.answer, /Comprobación/);
});

test("mcd de 48 y 18", () => {
  const result = runActivity("calcular", "mcd de 48 y 18");
  assert.match(result.answer, /\*\*6\*\*/);
});

test("raíz cuadrada de 144", () => {
  const result = runActivity("calcular", "raíz cuadrada de 144");
  assert.match(result.answer, /\*\*12\*\*/);
});

test("la lectura de código marca el índice fuera por uno", () => {
  const result = runActivity(
    "programar",
    "```js\nfunction promedio(notas) {\n  var total = 0;\n  for (var i = 0; i <= notas.length; i++) {\n    total += notas[i];\n  }\n  console.log(total);\n}\n```",
  );
  assert.match(result.answer, /length - 1/);
  assert.match(result.answer, /var/);
});

test("organizar pone hoy antes que el viernes", () => {
  const result = runActivity(
    "organizar",
    "Mañana examen de cálculo, el viernes entregar el ensayo y hoy revisar los apuntes de Python.",
  );
  assert.equal(result.applicable, true);
  const lines = result.answer.split("\n").filter((line) => /^\d+\./.test(line));
  assert.match(lines[0] ?? "", /hoy/);
  assert.match(lines.at(-1) ?? "", /viernes/);
});

test("resumir extrae oraciones de un texto largo", () => {
  const text = Array.from({ length: 6 }, (_, index) => {
    return `El ciclo ${index} repite un bloque mientras la condición de las notas se cumple y la función devuelve un promedio.`;
  }).join(" ");
  const result = runActivity("resumir", text);
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

test("investigar responde qué es la metodología de investigación", () => {
  const result = runActivity("investigar", "que es la metodologia de investigacion");
  assert.match(result.answer, /conjunto de criterios/i);
  assert.match(result.answer, /enfoque/i);
  assert.doesNotMatch(result.answer, /^Subpreguntas para no responder/m);
});
