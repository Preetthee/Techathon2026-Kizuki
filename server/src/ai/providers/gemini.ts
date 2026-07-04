import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import config from '../../config';
import type { LLMProvider } from './index';

export function createGeminiProvider(): LLMProvider {
  const cfg    = config.ai.gemini;
  const genAI  = new GoogleGenerativeAI(cfg.apiKey);

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  ];

  return {
    name:  'gemini',
    model: cfg.model,

    async complete(systemPrompt, userMessage) {
      const model = genAI.getGenerativeModel({
        model: cfg.model,
        safetySettings,
        generationConfig: {
          maxOutputTokens: config.ai.maxTokens,
          temperature:     config.ai.temperature,
        },
        // Gemini supports a systemInstruction field
        systemInstruction: systemPrompt,
      });

      const result = await model.generateContent(userMessage);
      const text   = result.response.text().trim();
      if (!text) throw new Error('Gemini returned an empty response');
      return text;
    },
  };
}
