import assert from "node:assert/strict";
import { test } from "node:test";
import { OFFLINE_NOTE, appendOfflineFooter } from "../lib/tools/overview";
import { looksLikeFreshWebQuery, researchBrief } from "../lib/tools/research";

test("looksLikeFreshWebQuery detecta noticias y precios", () => {
  assert.equal(looksLikeFreshWebQuery("noticias de hoy en Colombia"), true);
  assert.equal(looksLikeFreshWebQuery("qué es la fotosíntesis"), false);
});

test("appendOfflineFooter marca Respondido sin internet", () => {
  const text = appendOfflineFooter("Hola", { confidence: "local" });
  assert.match(text, /Respondido sin internet/);
  assert.match(text, /Nota de confianza/);
  assert.ok(text.includes(OFFLINE_NOTE));
});

test("investigar offline no inventa fuentes http", async () => {
  const result = await researchBrief("que es la metodologia de investigacion", {
    webSearch: false,
  });
  assert.equal(result.offline, true);
  assert.equal(result.usedWeb, false);
  assert.match(result.answer, /Respondido sin internet|Metodolog/i);
  const httpSources = (result.sources || []).filter((s) => s.url?.startsWith("http"));
  assert.equal(httpSources.length, 0);
});
