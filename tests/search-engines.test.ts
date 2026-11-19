import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SEARCH_ENGINE_PREFS,
  formatEnginesUsedNote,
  sanitizeSearchEnginePrefs,
  SEARCH_ENGINE_META,
} from "../lib/search/engines";

test("prefs por defecto son gratuitas y sin Brave/Tavily", () => {
  const prefs = sanitizeSearchEnginePrefs({});
  assert.equal(prefs.searxng, true);
  assert.equal(prefs.wikipedia, true);
  assert.equal(prefs.wikidata, true);
  assert.equal(prefs.duckduckgo, true);
  assert.ok(!("brave" in prefs));
  assert.ok(!("tavily" in prefs));
  assert.equal(SEARCH_ENGINE_META.duckduckgo.floss, false);
  assert.equal(SEARCH_ENGINE_META.searxng.floss, true);
  assert.match(prefs.searxngUrl, /127\.0\.0\.1:8080/);
});

test("sanitizeSearchEnginePrefs respeta toggles y URL", () => {
  const prefs = sanitizeSearchEnginePrefs({
    ...DEFAULT_SEARCH_ENGINE_PREFS,
    duckduckgo: false,
    searxngUrl: "http://localhost:8888/",
  });
  assert.equal(prefs.duckduckgo, false);
  assert.equal(prefs.searxngUrl, "http://localhost:8888");
});

test("formatEnginesUsedNote lista etiquetas", () => {
  assert.equal(formatEnginesUsedNote([]), "");
  assert.match(formatEnginesUsedNote(["wikipedia", "searxng"]), /Wikipedia/);
  assert.match(formatEnginesUsedNote(["wikipedia", "searxng"]), /SearXNG/);
});
