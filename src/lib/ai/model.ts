import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getGeminiModelName } from "@/lib/env";

export function getGeminiModel(modelOverride?: string) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY não configurada. Adicione sua chave do Google AI Studio no .env.local."
    );
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return google(modelOverride ?? getGeminiModelName());
}
