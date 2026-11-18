import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderRecipePrompt } from "../lib/recipe-prompt";
import type { Effort, ModelId, RecipeMessage } from "../lib/types";

type Fixture = {
  name: string;
  model: ModelId;
  thinking: boolean;
  effort: Effort;
  messages: RecipeMessage[];
  prompt: string;
};

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/prompts.json", import.meta.url), "utf8")) as Fixture[];

for (const fixture of fixtures) {
  test(`prompt ${fixture.name} matches deepseek-recipe 0.2.0`, () => {
    const prompt = renderRecipePrompt({
      model: fixture.model,
      thinking: fixture.thinking,
      effort: fixture.effort,
      messages: fixture.messages,
    });
    assert.equal(prompt, fixture.prompt);
  });
}
