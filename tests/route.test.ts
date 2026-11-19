import assert from "node:assert/strict";
import test from "node:test";
import { detectIntent } from "../lib/tools/route";
import { runActivity } from "../lib/tools/index";

test("detecta cuentas en Preguntar", () => {
  assert.equal(detectIntent("¿Cuánto es el 15% de 240?"), "calcular");
  assert.equal(detectIntent("integra x**2"), "calcular");
  assert.equal(detectIntent("Resuelve 2x + 5 = 17"), "calcular");
});

test("detecta investigación, estudio, emergencia y proyecto", () => {
  assert.equal(detectIntent("¿Dónde se ubica la pirámide de Giza?"), "investigar");
  assert.equal(detectIntent("Explícame las fracciones equivalentes"), "estudiar");
  assert.equal(detectIntent("primeros auxilios por incendio en casa"), "emergencia");
  assert.equal(detectIntent("plan para montar un huerto en balcón"), "proyecto");
  assert.equal(detectIntent("remedio casero para la resaca"), "cotidiano");
});

test("detecta traducir y programar", () => {
  assert.equal(detectIntent("Traduce al inglés: El curso empieza el lunes"), "traducir");
  assert.equal(
    detectIntent("```js\nfunction promedio(notas) {\n  return notas[0];\n}\n```"),
    "programar",
  );
});

test("no confunde pedidos de estilo con traducir", () => {
  assert.notEqual(
    detectIntent("Haz la respuesta anterior más informativa y detallada, en español, bien estructurada."),
    "traducir",
  );
  assert.notEqual(
    detectIntent("Haz la respuesta anterior más corta, en español, sin perder lo esencial."),
    "traducir",
  );
  assert.notEqual(
    detectIntent("Reescribe la respuesta anterior con un tono más natural y cercano, en español."),
    "traducir",
  );
});

test("preguntar enruta una cuenta y marca la herramienta", async () => {
  const result = await runActivity("preguntar", "¿Cuánto es el 15% de 240?");
  assert.equal(result.routedTo, "calcular");
  assert.match(result.answer, /Herramienta: Calcular/);
  assert.match(result.answer, /\*\*36\*\*/);
});
