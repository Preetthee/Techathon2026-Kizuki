import dotenv from 'dotenv';
dotenv.config();

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

const botConfig = {
  token:      require_env('DISCORD_TOKEN'),
  prefix:     process.env.DISCORD_PREFIX    ?? '!',
  channelId:  process.env.DISCORD_CHANNEL_ID ?? '',   // '' = respond everywhere
  apiBaseUrl: process.env.API_BASE_URL       ?? 'http://localhost:3001',
  alertRepeatIntervalMs: parseInt(process.env.DISCORD_ALERT_REPEAT_INTERVAL_MS ?? '300000', 10),
};

export default botConfig;
