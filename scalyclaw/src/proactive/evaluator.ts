import { getConfigRef, type ScalyClawConfig } from '../core/config.js';
import { recordUsage } from '../core/db.js';
import { log } from '@scalyclaw/shared/core/logger.js';
import { selectModel, parseModelId } from '../models/provider.js';
import { getProvider } from '../models/registry.js';
import { buildProactivePrompt } from '../prompt/proactive.js';
import type { ProactiveContext, EvaluationResult, TriggerType } from './types.js';

function resolveModel(config: Readonly<ScalyClawConfig>): string | null {
  return config.proactive.model
    || selectModel(config.orchestrator.models)
    || selectModel(config.models.models.filter(m => m.enabled).map(m => ({ model: m.id, weight: m.weight, priority: m.priority })));
}

const VALID_TRIGGER_TYPES: readonly TriggerType[] = ['urgent', 'deliverable', 'insight', 'check_in'] as const;

function coerceTriggerType(raw: unknown, fallback: TriggerType): TriggerType {
  return typeof raw === 'string' && (VALID_TRIGGER_TYPES as readonly string[]).includes(raw)
    ? (raw as TriggerType)
    : fallback;
}

/**
 * Single merged LLM call: decides engage/skip AND produces the final message in
 * one round-trip. Replaces the old two-stage evaluate-then-generate pipeline.
 * Returns `{engage: false, message: null}` when the model decides to stay quiet,
 * or `{engage: true, message, triggerType}` when there is a message ready to send.
 */
export async function evaluateAndGenerate(ctx: ProactiveContext): Promise<EvaluationResult> {
  const config = getConfigRef();
  const modelId = resolveModel(config);
  if (!modelId) {
    log('warn', 'No model available for proactive evaluation');
    return { engage: false, triggerType: ctx.trigger.type, message: null, reasoning: 'No model available' };
  }

  const { provider: providerId, model } = parseModelId(modelId);
  const provider = getProvider(providerId);
  const { system, user } = buildProactivePrompt(ctx);

  const response = await provider.chat({
    model,
    systemPrompt: system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 512,
    temperature: 0.5,
  });

  recordUsage({
    model: modelId,
    provider: providerId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    type: 'proactive',
  });

  // Extract JSON. Strip code fences if the model added them.
  const text = response.content.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    log('warn', 'Proactive eval: no JSON in response', { preview: text.slice(0, 200) });
    return { engage: false, triggerType: ctx.trigger.type, message: null, reasoning: 'Unparseable response' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      engage?: boolean;
      triggerType?: string;
      message?: string;
      reasoning?: string;
    };

    if (parsed.engage !== true) {
      return {
        engage: false,
        triggerType: ctx.trigger.type,
        message: null,
        reasoning: parsed.reasoning ?? 'Model chose not to engage',
      };
    }

    const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
    if (!message) {
      return {
        engage: false,
        triggerType: ctx.trigger.type,
        message: null,
        reasoning: 'Model engaged but produced empty message',
      };
    }

    return {
      engage: true,
      triggerType: coerceTriggerType(parsed.triggerType, ctx.trigger.type),
      message,
      reasoning: parsed.reasoning ?? '',
    };
  } catch (err) {
    log('warn', 'Proactive eval: JSON parse failed', { error: String(err) });
    return { engage: false, triggerType: ctx.trigger.type, message: null, reasoning: 'JSON parse error' };
  }
}
