import assert from "node:assert/strict";
import test from "node:test";
import {
  detectAnswerStyle,
  isStyleRewriteRequest,
  STYLE_QUICK_PROMPTS,
  styleInstruction,
} from "../lib/style";

test("detecta estilos desde el historial reciente", () => {
  assert.equal(detectAnswerStyle([{ role: "user", content: "hazlo más corto" }]), "corto");
  assert.equal(
    detectAnswerStyle([{ role: "user", content: "más informativo por favor" }]),
    "informativo",
  );
  assert.equal(detectAnswerStyle([{ role: "user", content: "más natural" }]), "natural");
  assert.equal(detectAnswerStyle([{ role: "user", content: "¿qué es una hipótesis?" }]), "default");
});

test("instrucciones y botones rápidos en español", () => {
  assert.match(styleInstruction("corto"), /MÁS CORTO/i);
  assert.match(styleInstruction("informativo"), /INFORMATIVO/i);
  assert.match(styleInstruction("natural"), /NATURAL/i);
  assert.match(STYLE_QUICK_PROMPTS.corto, /corta/);
  assert.match(STYLE_QUICK_PROMPTS.informativo, /informativa/);
  assert.match(STYLE_QUICK_PROMPTS.natural, /natural/);
});

test("reconoce reescritura de estilo de la respuesta anterior", () => {
  assert.equal(isStyleRewriteRequest(STYLE_QUICK_PROMPTS.informativo), true);
  assert.equal(isStyleRewriteRequest(STYLE_QUICK_PROMPTS.corto), true);
  assert.equal(isStyleRewriteRequest(STYLE_QUICK_PROMPTS.natural), true);
  assert.equal(isStyleRewriteRequest("Traduce al inglés: Hola"), false);
});

test("rewriteAnswerStyle no inventa temas y limpia markdown roto", async () => {
  const { rewriteAnswerStyle, sanitizeBrokenMarkdown } = await import("../lib/style-rewrite");
  const previous = [
    "**Perros pequeños**",
    "",
    "**Qué dicen las fuentes**",
    "",
    "- **Chihuahua:** Raza muy pequeña, suele pesar menos de tres kilos.",
    "- **Pomerania:** Compañía, pelaje abundante y carácter alerta.",
  ].join("\n");
  const informative = rewriteAnswerStyle(previous, "informativo");
  assert.match(informative, /Chihuahua|Pomerania|Más detalle/i);
  assert.doesNotMatch(informative, /bummerator/i);
  const corto = rewriteAnswerStyle(previous, "corto");
  assert.ok(corto.length < previous.length + 40);
  assert.match(sanitizeBrokenMarkdown("** Subtítulo 1: ** texto"), /\*\*Subtítulo 1:\*\*/);
});
