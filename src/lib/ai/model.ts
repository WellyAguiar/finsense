import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getGeminiModelName } from "@/lib/env";

/**
 * Wrapper oficial de compatibilidade para Gemini 3.x com @ai-sdk/google v1.x:
 * garante que functionCall parts em chamadas multi-etapas incluam o marcador
 * oficial `skip_thought_signature_validator` quando o SDK não propagou a assinatura.
 */
const geminiCompatibleFetch: typeof fetch = async (input, init) => {
  if (init?.body && typeof init.body === "string") {
    try {
      const parsed = JSON.parse(init.body) as {
        contents?: Array<{
          parts?: Array<{
            functionCall?: unknown;
            thoughtSignature?: string;
          }>;
        }>;
      };
      if (Array.isArray(parsed.contents)) {
        let modified = false;
        for (const content of parsed.contents) {
          if (!Array.isArray(content.parts)) continue;
          for (const part of content.parts) {
            if (part.functionCall && !part.thoughtSignature) {
              part.thoughtSignature = "skip_thought_signature_validator";
              modified = true;
            }
          }
        }
        if (modified) {
          return fetch(input, { ...init, body: JSON.stringify(parsed) });
        }
      }
    } catch {
      // Corpo não-JSON — segue fetch padrão
    }
  }
  return fetch(input, init);
};

export function getGeminiModel(modelOverride?: string) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY não configurada. Adicione sua chave do Google AI Studio no .env.local."
    );
  }
  const google = createGoogleGenerativeAI({
    apiKey,
    fetch: geminiCompatibleFetch,
  });
  return google(modelOverride ?? getGeminiModelName());
}
