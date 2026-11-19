import { connection } from "next/server";
import { requireIdentity } from "../../../../cursor/identity";
import { isOllamaChatModelId } from "@/lib/ollama-models";
import { studyFromDocumentText } from "@/lib/tools/file-study";

export const maxDuration = 300;

export async function POST(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json({ error: "Inicia sesión en Cursor para usar Lumen." }, { status: 401 });
  }

  let body: { title?: string; text?: string; ollamaModel?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title : "Documento";
  const text = typeof body.text === "string" ? body.text : "";
  const model =
    typeof body.ollamaModel === "string" &&
    (isOllamaChatModelId(body.ollamaModel) || /^[a-z0-9._:-]+$/i.test(body.ollamaModel))
      ? body.ollamaModel
      : undefined;

  const result = await studyFromDocumentText({ title, text, model });
  return Response.json(result);
}
