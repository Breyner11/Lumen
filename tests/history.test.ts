import assert from "node:assert/strict";
import test from "node:test";
import { pushHistory, sanitizeHistory } from "../lib/history";

test("pushHistory pone lo nuevo primero y evita duplicados del mismo oficio", () => {
  const first = pushHistory([], {
    activity: "calcular",
    query: "15% de 240",
    preview: "36",
  });
  const second = pushHistory(first, {
    activity: "calcular",
    query: "2x + 5 = 17",
    preview: "x = 6",
  });
  const again = pushHistory(second, {
    activity: "calcular",
    query: "15% de 240",
    preview: "36 otra vez",
  });
  assert.equal(again[0]?.query, "15% de 240");
  assert.equal(again.length, 2);
});

test("sanitizeHistory descarta entradas rotas", () => {
  const clean = sanitizeHistory([
    { id: "a", activity: "calcular", query: "hola", preview: "ok", at: 1 },
    { id: "b", activity: "nope", query: "x", preview: "y", at: 2 },
    null,
  ]);
  assert.equal(clean.length, 1);
  assert.equal(clean[0]?.id, "a");
});
