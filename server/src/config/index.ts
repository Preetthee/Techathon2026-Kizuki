import dotenv from 'dotenv';
dotenv.config();

const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  storage: {
    type:       (process.env.STORAGE_TYPE ?? 'sqlite') as 'sqlite' | 'json',
    sqlitePath: process.env.SQLITE_PATH ?? './data/office.db',
    jsonPath:   process.env.JSON_PATH   ?? './data/state.json',
  },
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/office_power_monitor',
  officeHours: {
    start: parseInt(process.env.OFFICE_HOURS_START ?? '9', 10),
    end:   parseInt(process.env.OFFICE_HOURS_END   ?? '17', 10),
  },
  simulatorIntervalMs: parseInt(process.env.SIMULATOR_INTERVAL_MS ?? '5000', 10),
  sustainedLoadThresholdMs: parseInt(process.env.SUSTAINED_LOAD_THRESHOLD_MS ?? '7200000', 10),
  usageLogIntervalMs: parseInt(process.env.USAGE_LOG_INTERVAL_MS ?? '300000', 10),
  isDev: (process.env.NODE_ENV ?? 'development') !== 'production',
  ai: {
    provider:      (process.env.AI_PROVIDER ?? 'openai') as 'openai' | 'gemini' | 'deepseek' | 'ollama',
    maxTokens:     parseInt(process.env.AI_MAX_TOKENS ?? '512', 10),
    temperature:   parseFloat(process.env.AI_TEMPERATURE ?? '0.4'),
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
