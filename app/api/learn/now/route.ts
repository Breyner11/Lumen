import { connection } from "next/server";
import { requireIdentity } from "../../../../cursor/identity";
import { engineLearnNow } from "@/lib/rag/engine-client";

export async function POST(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json({ error: "Inicia sesión en Cursor para usar Taller." }, { status: 401 });
  }

  let topics: string[] | undefined;
  try {
    const body = (await request.json()) as { topics?: string[] };
    topics = body.topics;
  } catch {
    topics = undefined;
  }

  const result = await engineLearnNow({ topics, maxTopics: 3 });
  if (!result) {
    return Response.json(
      { error: "Motor Python no disponible. Arranca `npm run rag:engine`." },
      { status: 503 },
    );
  }
  return Response.json(result);
}
