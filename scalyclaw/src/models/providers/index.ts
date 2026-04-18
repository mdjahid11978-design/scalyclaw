import type { ModelProvider } from '../provider.js';
import { registerProvider } from '../registry.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import { createAnthropicProvider } from './anthropic.js';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

interface ProviderSpec {
  defaultBaseUrl: string;
  requiresKey: boolean;
  build: (id: string, cfg: ProviderConfig, baseUrl: string) => ModelProvider;
}

const openAICompatibleBuilder = (id: string, cfg: ProviderConfig, baseUrl: string): ModelProvider =>
  createOpenAICompatibleProvider({ id, apiKey: cfg.apiKey ?? '', baseUrl });

export const PROVIDER_SPECS: Record<string, ProviderSpec> = {
  openai: {
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  anthropic: {
    defaultBaseUrl: 'https://api.anthropic.com',
    requiresKey: true,
    build: (id, cfg, baseUrl) => createAnthropicProvider({ id, apiKey: cfg.apiKey ?? '', baseUrl }),
  },
  openrouter: {
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  minimax: {
    defaultBaseUrl: 'https://api.minimax.io/v1',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  ollama: {
    defaultBaseUrl: 'http://localhost:11434/v1',
    requiresKey: false,
    build: (id, cfg, baseUrl) => createOpenAICompatibleProvider({ id, apiKey: cfg.apiKey || 'ollama', baseUrl }),
  },
  google: {
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  mistral: {
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  groq: {
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  xai: {
    defaultBaseUrl: 'https://api.x.ai/v1',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  deepseek: {
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  cohere: {
    defaultBaseUrl: 'https://api.cohere.com/compatibility/v1',
    requiresKey: true,
    build: openAICompatibleBuilder,
  },
  lmstudio: {
    defaultBaseUrl: 'http://localhost:1234/v1',
    requiresKey: false,
    build: (id, cfg, baseUrl) => createOpenAICompatibleProvider({ id, apiKey: cfg.apiKey || 'lm-studio', baseUrl }),
  },
  custom: {
    defaultBaseUrl: '',
    requiresKey: false,
    build: openAICompatibleBuilder,
  },
};

export function isKnownProvider(id: string): boolean {
  return id in PROVIDER_SPECS;
}

/**
 * Register every provider found in config.models.providers. Unknown keys are
 * warned and skipped; requires-key providers without an apiKey are skipped.
 * Safe to call repeatedly — re-registration overwrites the existing instance.
 */
export function registerProviders(providers: Record<string, ProviderConfig>): void {
  for (const [id, cfg] of Object.entries(providers)) {
    const spec = PROVIDER_SPECS[id];
    if (!spec) {
      log('warn', 'Unknown provider in config, skipping', { id });
      continue;
    }
    if (spec.requiresKey && !cfg.apiKey) {
      log('warn', 'Provider missing apiKey, skipping', { id });
      continue;
    }
    const baseUrl = cfg.baseUrl || spec.defaultBaseUrl;
    if (!baseUrl) {
      log('warn', 'Provider has no baseUrl and no default, skipping', { id });
      continue;
    }
    try {
      const instance = spec.build(id, cfg, baseUrl);
      registerProvider(instance, id);
      log('info', 'Registered provider', { id, baseUrl });
    } catch (err) {
      log('error', 'Failed to register provider', { id, error: String(err) });
    }
  }
}
