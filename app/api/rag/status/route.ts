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
      detail: health,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
