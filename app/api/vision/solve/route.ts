import { connection } from "next/server";
import { requireIdentity } from "../../../../cursor/identity";
import { engineVisionSolve, formatVisionAnswer } from "@/lib/rag/vision-client";

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
    return Response.json({ error: "No pude leer la imagen." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Falta el archivo de imagen." }, { status: 400 });
  }
  if (file.size > 8_000_000) {
    return Response.json({ error: "La imagen supera 8 MB." }, { status: 413 });
  }

  const remote = await engineVisionSolve(file, file.name || "problema.png");
  if (!remote) {
    return Response.json(
      {
        ok: false,
        error:
          "El motor Python no está disponible. Arranca `npm run rag:engine` y, para leer fotos, `ollama pull qwen2.5-vl:3b`.",
      },
      { status: 503 },
    );
  }

  return Response.json({
    ...remote,
    answer: formatVisionAnswer(remote),
  });
}
