import assert from "node:assert/strict";
import test from "node:test";
import { appendCitations, stripCitationBlocks } from "../lib/rag/citations";

test("codifica y decodifica imágenes y fuentes", () => {
  const packed = appendCitations("Respuesta corta", {
    images: [{ url: "https://example.com/a.jpg", title: "Rueda" }],
    sources: [{ title: "Wikipedia: Rueda", url: "https://es.wikipedia.org/wiki/Rueda" }],
  });
  assert.match(packed, /:::taller-images/);
  assert.match(packed, /:::taller-sources/);
  const parsed = stripCitationBlocks(packed);
  assert.equal(parsed.content, "Respuesta corta");
  assert.equal(parsed.images[0]?.url, "https://example.com/a.jpg");
  assert.equal(parsed.sources[0]?.title, "Wikipedia: Rueda");
});
