import OpenAI from 'openai';
import type { ModelProvider, ModelResponse } from '../provider.js';
import { log } from '@scalyclaw/shared/core/logger.js';

/**
 * Strip reasoning traces and local-model chat artifacts from content.
 * Safe no-op for clean providers; necessary for LM Studio / Ollama / DeepSeek-R1
 * which leak <think> blocks and ChatML tokens into the output.
 */
export function defaultCleanContent(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Gemma 4 emits <|channel>thought\n...<channel|>
  text = text.replace(/<\|channel>thought[\s\S]*?<channel\|>/g, '');
  const imEndIdx = text.indexOf('<|im_end|>');
  if (imEndIdx !== -1) text = text.slice(0, imEndIdx);
  text = text.replace(/<\|[^|]*\|>/g, '').trim();
  return text;
}

function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      try { return JSON.parse(parsed) as Record<string, unknown>; } catch { return {}; }
    }
    return (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * OpenAI reasoning models (o1/o3/o4 and gpt-5 series) require different params:
 *   - max_completion_tokens instead of max_tokens
 *   - no temperature / top_p / penalties
 * Match on common prefixes — works for openai: provider and openrouter:openai/... ids.
 */
function isOpenAIReasoningModel(model: string): boolean {
  const lower = model.toLowerCase();
  const bare = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;
  return /^o[1-9](-|$)/.test(bare) || /^gpt-5(-|$)/.test(bare);
}

export interface OpenAICompatibleOptions {
  id: string;
  apiKey: string;
  baseUrl: string;
  cleanContent?: (s: string) => string;
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ModelProvider {
  const { id, apiKey, baseUrl, cleanContent = defaultCleanContent } = options;
  const client = new OpenAI({ apiKey: apiKey || 'not-required', baseURL: baseUrl });

  return {
    id,

    async chat({ model, systemPrompt, messages, tools, maxTokens, temperature, reasoningEnabled, signal }): Promise<ModelResponse> {
      const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id || '' };
          }
          if (m.role === 'assistant') {
            const cleaned = cleanContent(m.content || '');
            if (m.tool_calls && m.tool_calls.length > 0) {
              return {
                role: 'assistant' as const,
                content: cleaned || null,
                tool_calls: m.tool_calls.map(tc => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: { name: tc.name, arguments: JSON.stringify(tc.input) },
                })),
              };
            }
            return { role: 'assistant', content: cleaned };
          }
          return { role: 'user', content: m.content };
        }),
      ];

      const openaiTools = tools?.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));

      // Per-provider reasoning knobs.
      //   OpenAI reasoning models: reasoning_effort + max_completion_tokens, drop temperature.
      //   Ollama / Google / LM Studio (recent versions): reasoning_effort passthrough on /v1/chat/completions.
      //   DeepSeek-R1 / Qwen3.x / Gemma4: auto-think; no param needed — they emit <think> which cleanContent removes.
      const isReasoning = isOpenAIReasoningModel(model);
      const effort: 'low' | 'medium' | 'high' | undefined = reasoningEnabled ? 'medium' : undefined;

      const requestBody: Record<string, unknown> = {
        model,
        messages: openaiMessages,
        tools: openaiTools,
      };

      if (isReasoning) {
        requestBody.max_completion_tokens = maxTokens ?? 8192;
        // reasoning models reject temperature for some providers
      } else {
        requestBody.max_tokens = maxTokens ?? 8192;
        requestBody.temperature = temperature ?? 0.7;
      }

      if (effort) requestBody.reasoning_effort = effort;

      log('debug', `${id} API call`, { model, messageCount: openaiMessages.length, toolCount: openaiTools?.length ?? 0, maxTokens, temperature, reasoning: effort });
      const startTime = Date.now();
      const response = await client.chat.completions.create(
        requestBody as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        { signal },
      );
      log('debug', `${id} API response`, { model, durationMs: Date.now() - startTime, finishReason: response.choices[0]?.finish_reason, promptTokens: response.usage?.prompt_tokens, completionTokens: response.usage?.completion_tokens });

      const choice = response.choices[0];
      const message = choice.message as typeof choice.message & { reasoning_content?: string; reasoning?: string };

      // DeepSeek-R1 returns chain-of-thought in `reasoning_content` (OpenRouter uses `reasoning`).
      // We log the trace for observability but don't surface it to downstream consumers — the
      // API docs require us NOT to echo reasoning_content back in subsequent requests.
      if (message.reasoning_content || message.reasoning) {
        const trace = message.reasoning_content ?? message.reasoning ?? '';
        log('debug', `${id} reasoning trace captured`, { model, traceLength: trace.length });
      }

      const content = cleanContent(message.content || '');
      const toolCalls: ModelResponse['toolCalls'] = [];

      if (message.tool_calls) {
        for (const tc of message.tool_calls) {
          if (tc.type !== 'function') continue;
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            input: parseToolArgs(tc.function.arguments),
          });
        }
      }

      let stopReason: ModelResponse['stopReason'];
      if (choice.finish_reason === 'tool_calls' || toolCalls.length > 0) {
        stopReason = 'tool_use';
      } else if (choice.finish_reason === 'length') {
        stopReason = 'max_tokens';
      } else {
        stopReason = 'end_turn';
      }

      if (toolCalls.length > 0 && choice.finish_reason !== 'tool_calls') {
        log('warn', `${id} finish_reason/tool_calls mismatch`, {
          finishReason: choice.finish_reason,
          toolCallCount: toolCalls.length,
          toolNames: toolCalls.map(tc => tc.name),
        });
      }

      return {
        content,
        toolCalls,
        stopReason,
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    },

    async ping(model: string): Promise<boolean> {
      try {
        const pingBody: Record<string, unknown> = {
          model,
          messages: [{ role: 'user', content: 'ping' }],
        };
        if (isOpenAIReasoningModel(model)) {
          pingBody.max_completion_tokens = 1;
        } else {
          pingBody.max_tokens = 1;
        }
        await client.chat.completions.create(
          pingBody as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        );
        return true;
      } catch (err) {
        log('warn', `${id} ping failed`, { model, error: String(err) });
        return false;
      }
    },
  };
}
