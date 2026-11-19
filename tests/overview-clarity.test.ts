import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatOverviewMarkdown,
  isTrivialOverviewQuestion,
  scoreOverviewClarity,
  validateOverviewDraft,
  type OverviewDraft,
} from "../lib/tools/overview";

const ciudadMedia: OverviewDraft = {
  lead:
    "Una ciudad es un asentamiento grande con servicios, comercio y gobierno local. En Colombia, ejemplos claros son Bogotá, Medellín y Cali. Sirven para entender cómo se organiza la vida urbana en el país.",
  sectionTitle: "Ejemplos de ciudades en Colombia",
  items: [
    {
      title: "Bogotá",
      text: "Es la capital de Colombia y sede del gobierno nacional. Concentra muchas universidades y oficinas públicas.",
    },
    {
      title: "Medellín",
      text: "Es la ciudad principal de Antioquia. Destaca por su industria, el clima de valle y el transporte público.",
    },
    {
      title: "Cali",
      text: "Es la capital del Valle del Cauca. Es un centro cultural y económico del Pacífico colombiano.",
    },
  ],
  closing: {
    title: "En resumen",
    text: "Bogotá, Medellín y Cali son tres ciudades grandes de Colombia con roles distintos en política, industria y cultura.",
  },
};

test("validador rechaza títulos Wikipedia y scrapes", () => {
  const draft: OverviewDraft = {
    lead: "Un ejemplo claro es conurbación, conocida como.",
    sectionTitle: "Ejemplos de ciudades en Colombia",
    items: [
      { title: "conurbación", text: "conocida como zona metropolitana del valle de méxico." },
      { title: "Ciudad - Wikipedia, la enciclopedia libre", text: "definición de ciudad." },
    ],
  };
  const result = validateOverviewDraft("Ejemplos de ciudad", draft);
  assert.equal(result.ok, false);
});

test("validador acepta overview de extensión media y clara", () => {
  const result = validateOverviewDraft("Ejemplos de ciudad", ciudadMedia);
  assert.equal(result.ok, true, result.ok ? "" : result.reasons.join(","));
  const clarity = scoreOverviewClarity(ciudadMedia, "Ejemplos de ciudad");
  assert.equal(clarity.clear, true, clarity.note);
  assert.match(formatOverviewMarkdown(ciudadMedia), /\*\*En resumen\*\*/);
});

test("claridad marca lead demasiado larga (más de 3 frases)", () => {
  const draft: OverviewDraft = {
    lead: "Primera idea completa sobre el tema. Segunda idea también completa. Tercera idea sigue bien. Cuarta idea que ya sobra en la respuesta directa.",
    sectionTitle: "Puntos clave",
    items: [
      { title: "A", text: "Detalle con un dato concreto: por ejemplo, el 10% del total." },
      { title: "B", text: "Otro detalle útil con contexto breve para el estudiante." },
      { title: "C", text: "Un tercer punto con ejemplo, como una ciudad o un número." },
    ],
  };
  const clarity = scoreOverviewClarity(draft, "¿Qué es la fotosíntesis?");
  assert.equal(clarity.clear, false);
  assert.ok(/larga|directa/i.test(clarity.note));
});

test("claridad marca texto demasiado corto en pregunta normal", () => {
  const draft: OverviewDraft = {
    lead: "La fotosíntesis hace comida con luz.",
    sectionTitle: "Puntos",
    items: [
      { title: "Luz", text: "Usa el sol." },
      { title: "Planta", text: "Hace azúcar." },
    ],
  };
  const clarity = scoreOverviewClarity(draft, "¿Qué es la fotosíntesis?");
  assert.equal(clarity.clear, false);
});

test("preguntas triviales permiten respuesta más breve", () => {
  assert.equal(isTrivialOverviewQuestion("15% de 240"), true);
  const draft: OverviewDraft = {
    lead: "El 15% de 240 es 36. Se calcula multiplicando 240 por 0,15.",
    sectionTitle: "Pasos",
    items: [
      { title: "Procedimiento", text: "240 × 0,15 = 36." },
      { title: "Ejemplo", text: "El 10% de 240 sería 24; el 15% suma la mitad de eso, o sea 12, y da 36." },
    ],
  };
  const clarity = scoreOverviewClarity(draft, "15% de 240");
  assert.equal(clarity.clear, true, clarity.note);
});
