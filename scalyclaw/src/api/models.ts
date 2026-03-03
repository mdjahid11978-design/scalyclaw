import type { FastifyInstance } from 'fastify';
import { getConfig, saveConfig } from '../core/config.js';
import { log } from '@scalyclaw/shared/core/logger.js';

export function registerModelsRoutes(server: FastifyInstance): void {
  // GET /api/models — list configured models
  server.get('/api/models', async () => {
    const config = getConfig();
    return {
      providers: Object.keys(config.models.providers),
      models: config.models.models.map((m) => ({ ...m, enabled: m.enabled !== false })),
      embeddingModels: config.models.embeddingModels.map((m) => ({ ...m, enabled: m.enabled !== false })),
    };
  });

  // PATCH /api/models/:id — toggle enabled (searches both models and embeddingModels)
  server.patch<{
    Params: { id: string };
    Body: { enabled: boolean };
  }>('/api/models/:id', async (request, reply) => {
    const { id } = request.params;
    const { enabled } = request.body ?? {};
    const config = getConfig();

    const model = config.models.models.find((m) => m.id === id);
    if (model) {
      model.enabled = enabled;
      await saveConfig(config);
      return { enabled };
    }

    const embeddingModel = config.models.embeddingModels.find((m) => m.id === id);
    if (embeddingModel) {
      embeddingModel.enabled = enabled;
      await saveConfig(config);
      return { enabled };
    }

    return reply.status(404).send({ error: 'Model not found' });
  });

  // POST /api/models/test — test a model provider connection
  server.post<{ Body: { model: string } }>('/api/models/test', async (request, reply) => {
    const { model } = request.body ?? {};
    if (!model) return reply.status(400).send({ error: 'model is required' });

    try {
      const { parseModelId } = await import('../models/provider.js');
      const { getProvider } = await import('../models/registry.js');

      const { provider: providerId, model: modelName } = parseModelId(model);
      const provider = getProvider(providerId);
      if (!provider) {
        return reply.status(404).send({ error: `Provider not found: ${providerId}` });
      }

      const ok = await provider.ping(modelName);
      return { model, provider: providerId, ok };
    } catch (err) {
      log('error', 'Model test failed', { model, error: String(err) });
      return reply.status(500).send({ error: 'Model test failed' });
    }
  });

  // POST /api/models/test-embedding — test an embedding model by generating a small vector
  server.post<{ Body: { model: string } }>('/api/models/test-embedding', async (request, reply) => {
    const { model } = request.body ?? {};
    if (!model) return reply.status(400).send({ error: 'model is required' });

    try {
      const { parseModelId } = await import('../models/provider.js');
      const { provider: providerName, model: modelName } = parseModelId(model);
      const config = getConfig();
      const providerConfig = config.models.providers[providerName];
      if (!providerConfig) {
        return reply.status(404).send({ error: `Provider "${providerName}" not configured` });
      }

      const testText = 'embedding test';
      let dimensions = 0;

      switch (providerName) {
        case 'openai':
        case 'openrouter':
        case 'lmstudio':
        case 'google':
        case 'mistral':
        case 'cohere':
        case 'custom': {
          const { default: OpenAI } = await import('openai');
          const client = new OpenAI({
            apiKey: providerConfig.apiKey || 'lm-studio',
            baseURL: providerConfig.baseUrl || (providerName === 'lmstudio' ? 'http://localhost:1234/v1' : undefined),
          });
          const result = await client.embeddings.create({ model: modelName, input: testText });
          dimensions = result.data[0].embedding.length;
          break;
        }
        case 'ollama': {
          const baseUrl = providerConfig.baseUrl || 'http://localhost:11434';
          const response = await fetch(`${baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelName, prompt: testText }),
          });
          if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
          const data = await response.json() as { embedding: number[] };
          dimensions = data.embedding.length;
          break;
        }
        default:
          return reply.status(400).send({ error: `Embedding test not supported for provider "${providerName}"` });
      }

      return { model, provider: providerName, ok: true, dimensions };
    } catch (err) {
      log('error', 'Embedding model test failed', { model, error: String(err) });
      return { model, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
