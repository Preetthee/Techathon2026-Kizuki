import OpenAI from 'openai';
import config  from '../../config';
import type { LLMProvider } from './index';

export function createOpenAIProvider(): LLMProvider {
  const cfg    = config.ai.openai;
  const client = new OpenAI({ apiKey: cfg.apiKey });

  return {
    name: 'openai',
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
      if (!text) throw new Error('OpenAI returned an empty response');
      return text;
    },
  };
}
