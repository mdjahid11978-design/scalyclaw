import { getConfigRef, type ScalyClawConfig } from '../core/config.js';
import { recordUsage } from '../core/db.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { getProvider } from '../models/registry.js';
import { buildEvalPrompt } from '../prompt/proactive-eval.js';
import { buildGenPrompt } from '../prompt/proactive-gen.js';
import type { ProactiveContext, EvaluationResult, TriggerType } from './types.js';

// ─── Model Resolution ───────────────────────────────────────────────

function resolveModel(config: Readonly<ScalyClawConfig>): string | null {
  return config.proactive.model
    || selectModel(config.orchestrator.models)
    || selectModel(config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })));
}

// ─── Phase 1: Should-Engage Decision ────────────────────────────────

export async function evaluateShouldEngage(ctx: ProactiveContext): Promise<EvaluationResult> {
  const config = getConfigRef();
  const modelId = resolveModel(config);
  if (!modelId) {
    log('warn', 'No model available for proactive evaluation');
    return { engage: false, triggerType: ctx.trigger.type, confidence: 0, reasoning: 'No model available' };
  }

  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);
  const { system, user } = buildEvalPrompt(ctx);

  const response = await provider.chat({
    model,
    systemPrompt: system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 256,
    temperature: 0.3,
  });

  recordUsage({
    model: modelId,
    provider: providerId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    type: 'proactive',
  });

  // Parse JSON response
  try {
    const text = response.content.trim();
    // Extract JSON from potential markdown code blocks
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log('warn', 'Proactive eval: no JSON in response', { text: text.slice(0, 200) });
      return { engage: false, triggerType: ctx.trigger.type, confidence: 0, reasoning: 'Failed to parse response' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      engage: boolean;
      triggerType?: string;
      confidence?: number;
      reasoning?: string;
    };

    return {
      engage: parsed.engage === true,
      triggerType: (parsed.triggerType as TriggerType) || ctx.trigger.type,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      reasoning: parsed.reasoning ?? '',
    };
  } catch (err) {
    log('warn', 'Proactive eval: JSON parse failed', { error: String(err) });
    return { engage: false, triggerType: ctx.trigger.type, confidence: 0, reasoning: 'JSON parse error' };
  }
}

// ─── Phase 2: Message Generation ────────────────────────────────────

export async function generateMessage(ctx: ProactiveContext, triggerType: TriggerType): Promise<string | null> {
  const config = getConfigRef();
  const modelId = resolveModel(config);
  if (!modelId) {
    log('warn', 'No model available for proactive message generation');
    return null;
  }

  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);
  const { system, user } = buildGenPrompt(ctx, triggerType);

  const response = await provider.chat({
    model,
    systemPrompt: system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 256,
    temperature: 0.7,
  });

  recordUsage({
    model: modelId,
    provider: providerId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    type: 'proactive',
  });

  const text = response.content.trim();
  if (!text || text.includes('[SKIP]')) return null;

  return text;
}
