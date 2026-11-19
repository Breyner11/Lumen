import { connection } from "next/server";
import { requireIdentity } from "../../../../cursor/identity";
import { detectHardware } from "@/lib/hardware";
import {
  describeHardware,
  OLLAMA_CHAT_MODELS,
  pickDefaultOllamaModel,
} from "@/lib/ollama-models";
import { listOllamaModels, modelIsInstalled, ollamaUrl } from "@/lib/ollama";

export async function GET(request: Request) {
  await connection();
  const identity = await requireIdentity(request);
  if (identity instanceof Response) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const [hardware, installed] = await Promise.all([detectHardware(), listOllamaModels()]);
  const recommended = pickDefaultOllamaModel(hardware);
  const models = OLLAMA_CHAT_MODELS.map((option) => ({
    ...option,
    installed: modelIsInstalled(installed, option.id),
    recommended: option.id === recommended,
  }));

  return Response.json(
    {
      ollamaUrl: ollamaUrl(),
      hardware,
      hardwareLabel: describeHardware(hardware),
      recommended,
      models,
      installed,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
