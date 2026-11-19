import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeNewsCheck, verifyNewsPost } from "../lib/tools/news-check";
import { buildTutorPack, looksLikeTutorRequest } from "../lib/tools/tutor";
import {
  answerUnadCampusFaq,
  findUnadArticles,
  looksLikeUnadCampus,
  SEED_UNAD_KB,
} from "../lib/tools/unad";

test("detecta pedidos de tutor y noticias", () => {
  assert.equal(looksLikeTutorRequest("ayúdame a estudiar con quiz y tarjetas"), true);
  assert.equal(looksLikeNewsCheck("verifica esta noticia sobre el alza"), true);
  assert.equal(looksLikeUnadCampus("cómo recupero la contraseña del campus UNAD"), true);
});

test("FAQ UNAD cita artículo base y no inventa si no hay match fuerte", () => {
  const hit = answerUnadCampusFaq("olvidé la contraseña del campus", SEED_UNAD_KB);
  assert.match(hit.answer, /Artículo base/i);
  assert.match(hit.answer, /contraseña|campus/i);
  const articles = findUnadArticles("recibo de pago liquidación", SEED_UNAD_KB);
  assert.ok(articles.length >= 1);
  assert.match(articles[0]!.title, /pago/i);
});

test("verificador con web apagada advierte que no pudo verificar", async () => {
  const result = await verifyNewsPost({
    text: "El gobierno anunció hoy una medida inédita que reduce el precio de la gasolina a cero en todo el país según un mensaje de WhatsApp sin fuente.",
    webSearch: false,
  });
  assert.equal(result.applicable, true);
  assert.equal(result.usedWeb, false);
  assert.match(result.answer, /no pude verificar/i);
  assert.ok(result.note.length <= 500);
});

test("tutor genera quiz, tarjetas y plan", async () => {
  const pack = await buildTutorPack({
    topicOrText: "La fotosíntesis convierte luz, agua y CO2 en glucosa y oxígeno en las plantas.",
  });
  assert.equal(pack.applicable, true);
  assert.ok(pack.quiz.length >= 2);
  assert.ok(pack.flashcards.length >= 2);
  assert.ok(pack.weeklyPlan.length >= 3);
  assert.match(pack.answer, /Quiz|Tarjetas|Plan semanal/i);
});
