import { connection } from "next/server";
import { requireIdentity } from "../../../../cursor/identity";
import { ragEngineUrl } from "@/lib/rag/engine-client";

export async function POST(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json({ error: "Inicia sesión en Cursor para usar Taller." }, { status: 401 });
  }

  let body: { query?: string; topK?: number };
  try {
    body = (await request.json()) as { query?: string; topK?: number };
  } catch {
    return Response.json({ error: "No pude leer la consulta." }, { status: 400 });
  }
  const query = body.query?.trim() ?? "";
  if (query.length < 2) {
    return Response.json({ error: "Escribe al menos 2 caracteres." }, { status: 400 });
  }

  try {
    const response = await fetch(`${ragEngineUrl()}/images/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, top_k: body.topK ?? 5 }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const json = (await response.json()) as { hits?: unknown[]; detail?: string };
    if (!response.ok) {
      return Response.json(
        { error: json.detail || "El motor no pudo buscar imágenes." },
        { status: response.status },
      );
    }
    return Response.json(json);
  } catch {
    return Response.json(
      {
        error: "Motor Python no disponible. Arranca `npm run rag:engine` y sube fotos desde Calcular.",
        hits: [],
      },
      { status: 503 },
    );
  }
}
