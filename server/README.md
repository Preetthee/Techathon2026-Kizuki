# ⚡ Office Power Monitor — Backend Server

Express + Socket.IO backend for the Office Power Monitor system.
Manages 15 simulated devices, a real-time alert engine, AI assistant,
persistent storage, and a Discord bot (in-process mode).

---

## Setup

```bash
cd server
npm install
cp .env.example .env    # fill in your values
npm run dev             # starts on http://localhost:3001
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | ☐ | `3001` | HTTP port |
| `CLIENT_ORIGIN` | ☐ | `http://localhost:5173` | CORS allowed origin (frontend URL) |
| `NODE_ENV` | ☐ | `development` | `development` or `production` |
| **Storage** | | | |
| `STORAGE_TYPE` | ☐ | `sqlite` | `sqlite` or `json` fallback |
| `SQLITE_PATH` | ☐ | `./data/office.db` | SQLite database file path |
| `JSON_PATH` | ☐ | `./data/state.json` | JSON fallback file path |
| **MongoDB** | | | |
| `MONGODB_URI` | ☐ | `mongodb://localhost:27017/office_power_monitor` | MongoDB connection string |
| **Office Rules** | | | |
| `OFFICE_HOURS_START` | ☐ | `9` | Office open hour (0–23) |
| `OFFICE_HOURS_END` | ☐ | `17` | Office close hour (0–23) |
| **Simulator** | | | |
| `SIMULATOR_INTERVAL_MS` | ☐ | `5000` | Device toggle interval (ms) — **not the 15-60s random; this is the base tick** |
| `SUSTAINED_LOAD_THRESHOLD_MS` | ☐ | `7200000` | Alert threshold for all-ON room (ms, default 2h) |
| `USAGE_LOG_INTERVAL_MS` | ☐ | `300000` | How often to snapshot power usage to DB (ms) |
| **Discord** | | | |
| `DISCORD_TOKEN` | ☐ | — | Bot token (for in-process bot mode via `npm run bot`) |
| `DISCORD_CLIENT_ID` | ☐ | — | Application client ID |
| `DISCORD_GUILD_ID` | ☐ | — | Guild ID for slash command registration |
| `DISCORD_PREFIX` | ☐ | `!` | Command prefix |
| `DISCORD_CHANNEL_ID` | ☐ | — | Alert push channel ID |
| **AI** | | | |
| `AI_PROVIDER` | ☐ | `openai` | `openai` / `gemini` / `deepseek` / `ollama` |
| `OPENAI_API_KEY` | ☐ | — | Required if `AI_PROVIDER=openai` |
| `GEMINI_API_KEY` | ☐ | — | Required if `AI_PROVIDER=gemini` |
| `DEEPSEEK_API_KEY` | ☐ | — | Required if `AI_PROVIDER=deepseek` |
| `OLLAMA_BASE_URL` | ☐ | `http://localhost:11434` | Required if `AI_PROVIDER=ollama` |
| `AI_MAX_TOKENS` | ☐ | `512` | Max LLM response tokens |
| `AI_TEMPERATURE` | ☐ | `0.4` | LLM temperature |

---

## REST API

### Devices
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/devices` | All 15 devices |
| `GET` | `/devices/:id` | Single device |
| `GET` | `/devices/:id/history?days=7` | Device state history (from MongoDB) |
| `PATCH` | `/devices/:id` | Set status `{ status: bool }` |
| `POST` | `/devices/:id/toggle` | Quick toggle |

### Rooms
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/rooms` | All rooms with device summaries |
| `GET` | `/rooms/:name` | Single room (URL-encoded) |

### Usage / Power
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/usage` | Live snapshot (in-memory) |
| `GET` | `/usage/total?days=7` | Aggregated total kWh |
| `GET` | `/usage/rooms?days=7` | Per-room kWh |
| `GET` | `/usage/daily?days=30` | Daily kWh (chart data) |
| `GET` | `/usage/devices?days=7` | Per-device kWh |

### Alerts
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/alerts` | All active alerts |
| `GET` | `/alerts/after-hours` | After-hours alerts only |
| `GET` | `/alerts/sustained-load` | Sustained load alerts only |
| `GET` | `/alerts/history` | Historical alerts (MongoDB) |
| `GET` | `/alerts/stats?days=30` | Alert statistics |
| `DELETE` | `/alerts/:id` | Dismiss an alert |

### AI
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ai/ask` | `{ question: string }` — AI answer with grounded context |
| `GET` | `/ai/context` | Raw office context (debug) |

### Demo Mode
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/demo` | Current demo mode status |
| `POST` | `/demo/set` | `{ hour, minute }` — activate demo time |
| `DELETE` | `/demo` | Disable demo mode, restore real state |

### Meta
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server health + storage info |
| `GET` | `/simulator` | Simulator stats + active alert count |

---

## Socket.IO

**Namespace:** `/monitor`

### Server → Client Events
| Event | Payload | When |
|-------|---------|------|
| `device:update` | `{ device, changedAt }` | Every device state change |
| `devices:snapshot` | `{ devices[], timestamp }` | On first connect |
| `usage:update` | Power summary object | After every device toggle |
| `alert:new` | `{ alert, isNew }` | Alert raised or escalated |
| `alert:resolved` | `{ alertId, resolvedAt }` | Alert dismissed |
| `alerts:snapshot` | `{ alerts[], timestamp }` | On first connect |
| `demo:status` | `{ active, hour?, minute? }` | Demo mode change |
| `connected` | `{ socketId, rooms, serverTime }` | Welcome on connect |
| `server:stats` | Connection counts + uptime | Every 30 s |

### Client → Server Events
| Event | Payload | Description |
|-------|---------|-------------|
| `device:toggle` | `{ deviceId }` | Toggle a device (ack) |
| `alert:resolve` | `{ alertId }` | Dismiss an alert (ack) |
| `subscribe:room` | `{ room }` | Join a room feed |
| `demo:set` | `{ hour, minute }` | Activate demo time |
| `demo:clear` | — | Exit demo mode |

---

## Scripts

```bash
npm run dev        # Start with ts-node (development)
npm start          # Start compiled dist/ (production)
npm run build      # Compile TypeScript
npm run bot        # Run Discord bot in-process (ts-node)
npm run bot:start  # Run Discord bot from compiled dist/
```

---

## Project Structure

```
server/src/
├── index.ts              Entry point + boot sequence
├── config/               Environment configuration
├── ai/                   AI service, context/prompt builders, providers
├── bot/                  In-process Discord bot (alternative to standalone bot/)
├── controllers/          Express request handlers
├── db/                   MongoDB connection
├── middleware/           Logger, error handler
├── models/               Mongoose schemas (Device, Alert, UsageLog)
├── routes/               Express routers
├── services/             Business logic (alert engine, simulator, demo mode, AI)
├── socket/               Socket.IO namespaces, rooms, event catalogue
└── storage/              SQLite/JSON persistence (StorageService + adapters)
```
