import { connection } from "next/server";
import { requireIdentity } from "../../../../cursor/identity";
import { engineHealth } from "@/lib/rag/engine-client";

export async function GET(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json({ error: "Inicia sesión en Cursor para usar Taller." }, { status: 401 });
  }
  const health = await engineHealth();
  return Response.json(
    {
      engine: Boolean(health?.ok),
      ollama: Boolean(health?.ollama),
      embedModel: health?.embed_model ?? "tfidf-local",
      search: health?.search ?? "duckduckgo-fallback",
      visionModel: (health as { vision_model?: string | null } | null)?.vision_model ?? null,
      mathModel: (health as { math_model?: string | null } | null)?.math_model ?? null,
      chatModel: (health as { chat_model?: string | null } | null)?.chat_model ?? null,
      sympy: Boolean((health as { sympy?: boolean } | null)?.sympy),
      internet: Boolean((health as { internet?: boolean } | null)?.internet),
      detail: health,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
