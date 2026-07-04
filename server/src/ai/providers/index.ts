/**
 * Provider Registry
 *
 * Factory that returns the correct LLMProvider based on AI_PROVIDER env var.
 * Adding a new provider = implement LLMProvider, register it here.
 */

import config from '../../config';
import { createOpenAIProvider }   from './openai';
import { createGeminiProvider }   from './gemini';
import { createDeepSeekProvider } from './deepseek';
import { createOllamaProvider }   from './ollama';

// ─── Interface every provider must implement ──────────────────────────────────

export interface LLMProvider {
  name:  string;
  model: string;
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _cachedProvider: LLMProvider | null = null;

export function getProvider(): LLMProvider {
  if (_cachedProvider) return _cachedProvider;

  switch (config.ai.provider) {
    case 'gemini':   _cachedProvider = createGeminiProvider();   break;
    case 'deepseek': _cachedProvider = createDeepSeekProvider(); break;
    case 'ollama':   _cachedProvider = createOllamaProvider();   break;
    case 'openai':
    default:         _cachedProvider = createOpenAIProvider();   break;
  }

  console.log(`[ai] Provider: ${_cachedProvider.name}  model: ${_cachedProvider.model}`);
  return _cachedProvider;
}

/** Override the provider at runtime (e.g. for tests or hot-swapping). */
export function setProvider(provider: LLMProvider): void {
  _cachedProvider = provider;
}
