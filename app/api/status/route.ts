import { connection } from "next/server";
import { requireIdentity } from "../../../cursor/identity";

export async function GET(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json(
      { modelReady: false, error: "unauthorized" },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  if (identity.kind !== "person") {
    return Response.json(
      { modelReady: false, error: "forbidden" },
      { status: 403, headers: { "cache-control": "private, no-store" } },
    );
  }
  return Response.json(
    { modelReady: Boolean(process.env.DEEPSEEK_API_KEY) },
    { headers: { "cache-control": "private, no-store" } },
  );
}
