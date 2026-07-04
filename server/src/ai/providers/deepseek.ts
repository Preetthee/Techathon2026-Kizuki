/**
 * DeepSeek provider
 *
 * DeepSeek exposes an OpenAI-compatible API at https://api.deepseek.com/v1
 * so we reuse the OpenAI SDK with a custom baseURL — no extra dependency needed.
 */

import OpenAI from 'openai';
import config  from '../../config';
import type { LLMProvider } from './index';

export function createDeepSeekProvider(): LLMProvider {
  const cfg    = config.ai.deepseek;
  const client = new OpenAI({
    apiKey:  cfg.apiKey,
    baseURL: 'https://api.deepseek.com/v1',
  });

  return {
    name:  'deepseek',
    model: cfg.model,

    async complete(systemPrompt, userMessage) {
      const response = await client.chat.completions.create({
        model:       cfg.model,
        max_tokens:  config.ai.maxTokens,
        temperature: config.ai.temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  },
        ],
      });

      const text = response.choices[0]?.message?.content?.trim();
      if (!text) throw new Error('DeepSeek returned an empty response');
      return text;
    },
  };
}
