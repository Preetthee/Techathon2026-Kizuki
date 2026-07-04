import dotenv from 'dotenv';
dotenv.config();

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

const config = {
  // Discord
  token:     require_env('DISCORD_TOKEN'),
  clientId:  require_env('DISCORD_CLIENT_ID'),
  guildId:   process.env.DISCORD_GUILD_ID    ?? '',
  prefix:    process.env.DISCORD_PREFIX      ?? '!',
  channelId: process.env.DISCORD_CHANNEL_ID  ?? '',

  // Backend
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3001',

  // AI
  ai: {
    provider:    (process.env.AI_PROVIDER ?? 'deepseek') as 'openai' | 'gemini' | 'deepseek' | 'ollama',
    maxTokens:   parseInt(process.env.AI_MAX_TOKENS  ?? '512', 10),
    temperature: parseFloat(process.env.AI_TEMPERATURE ?? '0.4'),
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? '',
      model:  process.env.OPENAI_MODEL  ?? 'gpt-4o',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ?? '',
      model:  process.env.GEMINI_MODEL  ?? 'gemini-1.5-flash',
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY ?? '',
      model:  process.env.DEEPSEEK_MODEL  ?? 'deepseek-chat',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      model:   process.env.OLLAMA_MODEL   ?? 'llama3',
    },
  },
};

export default config;
