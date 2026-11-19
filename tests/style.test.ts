import assert from "node:assert/strict";
import test from "node:test";
import { detectAnswerStyle, STYLE_QUICK_PROMPTS, styleInstruction } from "../lib/style";

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
