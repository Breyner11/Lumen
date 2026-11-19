import { connection } from "next/server";
import { engineHealth } from "@/lib/rag/engine-client";

export async function GET() {
  await connection();
  const health = await engineHealth();
  return Response.json(
    {
      engine: Boolean(health?.ok),
      ollama: Boolean(health?.ollama),
      embedModel: health?.embed_model ?? "tfidf-local",
      search: health?.search ?? "duckduckgo-fallback",
      visionModel: (health as { vision_model?: string | null } | null)?.vision_model ?? null,
      mathModel: (health as { math_model?: string | null } | null)?.math_model ?? null,
      sympy: Boolean((health as { sympy?: boolean } | null)?.sympy),
      detail: health,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
