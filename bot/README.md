# ⚡ Office Power Monitor — Discord Bot

Standalone Discord bot for the Office Power Monitor system.
Connects to the backend (`server/`) via REST API and Socket.IO —
no shared code, no shared process.

---

## How it works

```
Discord User
    │  !status / !room / !ask …
    ▼
Discord Bot (this project)
    │  REST API calls (fetch)
    ▼
Backend Server (server/)
    │  Socket.IO /monitor namespace
    ▼
Bot receives alert:new → pushes critical alerts to Discord channel
```

Every command fetches live data from the backend at request time.
Critical alerts are pushed automatically via Socket.IO without any polling.

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your values
cp .env.example .env

# 3. Run in development
npm run dev

# 4. Build + run in production
npm run build
npm start
```

> The backend (`server/`) must be running before starting the bot.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | ✅ | — | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | ✅ | — | Application ID (used for slash command registration) |
| `DISCORD_GUILD_ID` | ☐ | — | Guild ID for guild-specific slash commands (faster deployment) |
| `DISCORD_PREFIX` | ☐ | `!` | Text command prefix |
| `DISCORD_CHANNEL_ID` | ☐ | *(all)* | Restrict bot to one channel ID |
| `DISCORD_ALERT_REPEAT_INTERVAL_MS` | ☐ | `300000` | Repeat active alert reminders while alerts remain active (`0` disables) |
| `API_BASE_URL` | ✅ | `http://localhost:3001` | Backend server URL |
| `AI_PROVIDER` | ☐ | `deepseek` | `openai` / `gemini` / `deepseek` / `ollama` |
| `DEEPSEEK_API_KEY` | ☐ | — | Required if `AI_PROVIDER=deepseek` |
| `OPENAI_API_KEY` | ☐ | — | Required if `AI_PROVIDER=openai` |
| `GEMINI_API_KEY` | ☐ | — | Required if `AI_PROVIDER=gemini` |
| `OLLAMA_BASE_URL` | ☐ | `http://localhost:11434` | Required if `AI_PROVIDER=ollama` |
| `AI_MAX_TOKENS` | ☐ | `512` | Max LLM response length |
| `AI_TEMPERATURE` | ☐ | `0.4` | LLM creativity (0 = deterministic, 1 = creative) |

---

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `!status` | `!s !devices !all` | All 15 devices by room, live wattage, ON/OFF badges |
| `!room <name>` | `!r` | Detailed view of one room — fans, lights, load bar |
| `!usage` | `!u !power !watts` | Total draw + per-room breakdown |
| `!alerts` | `!a !warn !warnings` | All active alerts grouped by type |
| `!ask <question>` | `!ai !q !query` | AI assistant — answers questions about live office state |
| `!help` | `!h !? !commands` | Show this command list |

### !ask examples
```
!ask what rooms are consuming the most power?
!ask is anything unusual happening?
!ask summarize the office status
!ask which devices have been on the longest?
```

### !room fuzzy matching
```
!room work 1       → Work Room 1
!room wr2          → Work Room 2
!room drawing      → Drawing Room
```

---

## Getting Discord Credentials

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name
3. Go to **Bot** → click **Add Bot**
4. Under **Token** → click **Reset Token** → copy the token → paste as `DISCORD_TOKEN`
5. Under **Privileged Gateway Intents** → enable **Message Content Intent**
6. Go to **OAuth2** → copy the **Application ID** → paste as `DISCORD_CLIENT_ID`
7. Go to **OAuth2 → URL Generator** → tick `bot` → tick `Send Messages`, `Read Messages`, `Use Slash Commands`
8. Copy the generated URL → open in browser → invite bot to your server

To get your Guild ID: right-click your server in Discord → **Copy Server ID** (requires Developer Mode enabled in Discord settings).

---

## Alert Push Notifications

When a **CRITICAL** alert fires on the backend (e.g. all devices ON for 4+ hours),
the bot automatically sends a `@here` message to `DISCORD_CHANNEL_ID`.

The bot connects to the backend Socket.IO `/monitor` namespace and listens for
`alert:new` events. Connection is maintained with automatic reconnection.

---

## Project Structure

```
bot/
├── src/
│   ├── index.ts          Entry point — Discord client + Socket.IO alerts
│   ├── config.ts         All env var config
│   ├── commands/
│   │   ├── registry.ts   Command map (name + aliases → handler)
│   │   ├── status.ts     !status
│   │   ├── room.ts       !room
│   │   ├── usage.ts      !usage
│   │   ├── alerts.ts     !alerts
│   │   ├── ask.ts        !ask (calls POST /ai/ask on backend)
│   │   └── help.ts       !help
│   └── utils/
│       ├── api.ts        Typed HTTP client for all backend endpoints
│       └── embeds.ts     All Discord EmbedBuilder logic
├── .env.example
├── package.json
└── tsconfig.json
```
