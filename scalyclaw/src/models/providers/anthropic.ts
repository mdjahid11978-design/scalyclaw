import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ModelProvider, ModelResponse } from '../provider.js';
import { log } from '@scalyclaw/shared/core/logger.js';

type AnthropicMessageParam = Anthropic.Messages.MessageParam;
type AnthropicContentBlock = Anthropic.Messages.ContentBlockParam;

function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessageParam[] {
  const result: AnthropicMessageParam[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      // systemPrompt is passed separately; any inline system messages fold into user context
      result.push({ role: 'user', content: m.content });
      continue;
    }

    if (m.role === 'tool') {
      const last = result[result.length - 1];
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id || '',
        content: m.content,
      };
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as AnthropicContentBlock[]).push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (m.content && m.content.trim().length > 0) {
        blocks.push({ type: 'text', text: m.content });
      }
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '' });
      result.push({ role: 'assistant', content: blocks });
      continue;
    }

    // user
    result.push({ role: 'user', content: m.content });
  }

  return result;
}

const REASONING_SUPPORTED = /^claude-(opus-4|sonnet-4|haiku-4)/i;

export interface AnthropicProviderOptions {
  id?: string;
  apiKey: string;
  baseUrl?: string;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): ModelProvider {
  const { apiKey, baseUrl, id = 'anthropic' } = options;
  const client = new Anthropic({ apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });

  return {
    id,

    async chat({ model, systemPrompt, messages, tools, maxTokens, temperature, reasoningEnabled, signal }): Promise<ModelResponse> {
      const anthropicMessages = toAnthropicMessages(messages);
      const anthropicTools = tools?.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
      }));

      const useThinking = reasoningEnabled && REASONING_SUPPORTED.test(model);

      log('debug', `${id} API call`, { model, messageCount: anthropicMessages.length, toolCount: anthropicTools?.length ?? 0, maxTokens, temperature, thinking: useThinking });
      const startTime = Date.now();
      const response = await client.messages.create({
        model,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: anthropicTools,
        max_tokens: maxTokens ?? 8192,
        // Anthropic requires temperature=1 when thinking is enabled
        temperature: useThinking ? 1 : (temperature ?? 0.7),
        ...(useThinking ? { thinking: { type: 'enabled', budget_tokens: Math.min(maxTokens ?? 8192, 8000) } } : {}),
      }, { signal });
      log('debug', `${id} API response`, { model, durationMs: Date.now() - startTime, stopReason: response.stop_reason, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

      let content = '';
      const toolCalls: ModelResponse['toolCalls'] = [];
      for (const block of response.content) {
        if (block.type === 'text') content += block.text;
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }

      let stopReason: ModelResponse['stopReason'];
      if (response.stop_reason === 'tool_use' || toolCalls.length > 0) stopReason = 'tool_use';
      else if (response.stop_reason === 'max_tokens') stopReason = 'max_tokens';
      else stopReason = 'end_turn';

      return {
        content,
        toolCalls,
        stopReason,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },

    async ping(model: string): Promise<boolean> {
      try {
        await client.messages.create({
          model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        });
        return true;
      } catch (err) {
        log('warn', `${id} ping failed`, { model, error: String(err) });
        return false;
      }
    },
  };
}
