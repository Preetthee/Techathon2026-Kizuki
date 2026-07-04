/**
 * Ollama provider  (local, no API key)
 *
 * Ollama exposes an OpenAI-compatible /v1/chat/completions endpoint
 * at http://localhost:11434 by default.
 *
 * Run:  ollama serve  (then)  ollama pull llama3
 */

import OpenAI from 'openai';
import config  from '../../config';
import type { LLMProvider } from './index';

export function createOllamaProvider(): LLMProvider {
  const cfg    = config.ai.ollama;
  const client = new OpenAI({
    apiKey:  'ollama',            // Ollama ignores the key but the SDK requires a non-empty string
    baseURL: `${cfg.baseUrl}/v1`,
  });

  return {
    name:  'ollama',
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
      if (!text) throw new Error('Ollama returned an empty response');
      return text;
    },
  };
}
