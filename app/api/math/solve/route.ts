import { connection } from "next/server";
import { requireIdentity } from "../../../../cursor/identity";
import { engineMathSolve, formatMathEngineAnswer } from "@/lib/rag/vision-client";
import { solveMath } from "@/lib/tools/math";

export async function POST(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json({ error: "Inicia sesión en Cursor para usar Taller." }, { status: 401 });
  }

  let body: { problem?: string; webContext?: boolean };
  try {
    body = (await request.json()) as { problem?: string; webContext?: boolean };
  } catch {
    return Response.json({ error: "No pude leer el problema." }, { status: 400 });
  }
  const problem = body.problem?.trim() ?? "";
  if (problem.length < 1) {
    return Response.json({ error: "Escribe el problema." }, { status: 400 });
  }

  const remote = await engineMathSolve(problem, Boolean(body.webContext));
  if (remote?.ok) {
    return Response.json({
      ok: true,
      answer: formatMathEngineAnswer(remote),
      engine: true,
      backend: remote.backend,
      remembered: remote.remembered ?? false,
    });
  }

  const local = solveMath(problem);
  return Response.json({
    ok: local.applicable,
    answer: local.answer,
    engine: false,
    backend: "taller-local",
    error: remote?.error,
  });
}
