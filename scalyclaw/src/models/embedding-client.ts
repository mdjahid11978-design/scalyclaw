import OpenAI from 'openai';
import { PROVIDER_SPECS } from './providers/index.js';

export interface EmbeddingClient {
  embed(text: string, model: string): Promise<number[]>;
}

/**
 * Build an embedding client for any OpenAI-compatible provider or Ollama.
 * Uses the OpenAI SDK with baseURL swapping — Ollama exposes /v1/embeddings,
 * LM Studio exposes /v1/embeddings, and cloud providers likewise. This unifies
 * what used to be a fragmented switch across embeddings.ts and api/models.ts.
 */
export function createEmbeddingClient(
  providerName: string,
  providerConfig: { apiKey?: string; baseUrl?: string },
): EmbeddingClient {
  if (providerName === 'anthropic') {
    throw new Error('Anthropic has no embeddings API — choose another provider');
  }

  const spec = PROVIDER_SPECS[providerName];
  const defaultBase = spec?.defaultBaseUrl ?? '';
  const baseURL = providerConfig.baseUrl || defaultBase;
  if (!baseURL) {
    throw new Error(`Embedding provider "${providerName}" has no baseUrl configured`);
  }

  const apiKey =
    providerConfig.apiKey ||
    (providerName === 'lmstudio' ? 'lm-studio' : providerName === 'ollama' ? 'ollama' : 'not-required');

  const client = new OpenAI({ apiKey, baseURL });

  return {
    async embed(text: string, model: string): Promise<number[]> {
      const result = await client.embeddings.create({
        model,
        input: text,
        encoding_format: 'float',
      });
      return result.data[0].embedding;
    },
  };
}
