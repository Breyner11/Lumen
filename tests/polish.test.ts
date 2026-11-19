import assert from "node:assert/strict";
import test from "node:test";
import { OLLAMA_WARMUP_MESSAGE, polishAnswer } from "../lib/tools/polish";

test("si Ollama falla no vuelca el contexto crudo", async () => {
  const previous = process.env.OLLAMA_URL;
  process.env.OLLAMA_URL = "http://127.0.0.1:9";
  try {
    const result = await polishAnswer({
      question: "¿Qué es una hipótesis?",
      context: [
        "Contexto recuperado. Úsalo para redactar; no lo copies literal:",
        "",
        "[1] Aprendizaje · lección (score 0.40)",
        "Texto interno que no debe verse.",
      ].join("\n"),
      sources: [{ title: "Wikipedia", url: "https://es.wikipedia.org/wiki/Hipotesis" }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.text, OLLAMA_WARMUP_MESSAGE);
    assert.doesNotMatch(result.text, /Contexto recuperado/);
    assert.doesNotMatch(result.text, /Aprendizaje/);
    assert.equal(result.sources[0]?.title, "Wikipedia");
  } finally {
    if (previous === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = previous;
  }
});
