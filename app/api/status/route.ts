import { connection } from "next/server";
import { getIdentity } from "../../../cursor/identity";

export async function GET(request: Request) {
  await connection();
  const identity = await getIdentity(request);
  const modelReady =
    identity.verified && identity.kind === "person" && Boolean(process.env.DEEPSEEK_API_KEY);
  return Response.json(
    { modelReady },
    { headers: { "cache-control": "private, no-store" } },
  );
}
