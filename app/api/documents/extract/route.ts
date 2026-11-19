import { connection } from "next/server";
import { requireIdentity } from "../../../../cursor/identity";
import { ragEngineUrl } from "@/lib/rag/engine-client";

export async function POST(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json({ error: "Inicia sesión en Cursor para usar Taller." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "No pude leer el archivo." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Falta el archivo." }, { status: 400 });
  }

  try {
    const body = new FormData();
    body.append("file", file, file.name || "documento");
    body.append("learn", "true");
    const response = await fetch(`${ragEngineUrl()}/documents/extract`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    const json = (await response.json()) as {
      ok?: boolean;
      text?: string;
      title?: string;
      filename?: string;
      indexed?: boolean;
      document_id?: string;
      detail?: string;
      error?: string;
    };
    if (!response.ok) {
      return Response.json(
        { error: json.detail || json.error || "No pude extraer el documento." },
        { status: response.status },
      );
    }
    return Response.json(json);
  } catch {
    return Response.json(
      {
        error: "Motor Python no disponible. Arranca `npm run rag:engine` tras `npm run rag:install`.",
      },
      { status: 503 },
    );
  }
}
