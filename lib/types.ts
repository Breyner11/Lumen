export const MODEL_IDS = ["flash", "pro"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const EFFORTS = ["low", "high", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const ACTIVITY_IDS = [
  "estudiar",
  "programar",
  "escribir",
  "calcular",
  "organizar",
  "traducir",
  "resumir",
  "investigar",
] as const;
export type ActivityId = (typeof ACTIVITY_IDS)[number];

export type ChatRole = "system" | "user" | "assistant";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type StoredMessage = ChatTurn & {
  reasoning?: string;
  mode?: "model" | "taller";
};

export type RecipeMessage = {
  role: ChatRole;
  content: string;
};
