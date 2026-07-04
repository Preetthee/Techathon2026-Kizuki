# ⚡ Office Power Monitor

Real-time office power monitoring system with a live dashboard, AI assistant, Discord bot,
alert engine, and persistent storage.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TWO PROJECTS                                  │
│                                                                      │
│  ┌─────────────────────────────┐   ┌──────────────────────────────┐ │
│  │       server/               │   │         bot/                 │ │
│  │   Node.js + Express         │   │   Discord.js standalone      │ │
│  │   Socket.IO                 │◄──│   Connects via REST API      │ │
│  │   MongoDB + SQLite          │   │   + Socket.IO client         │ │
│  │   Alert Engine              │   │   Commands: !status !room    │ │
│  │   AI Service (DeepSeek etc) │   │   !usage !alerts !ask        │ │
│  │   Demo Mode                 │   └──────────────────────────────┘ │
│  └──────────────┬──────────────┘                                     │
│                 │ REST + WebSocket                                    │
│  ┌──────────────▼──────────────┐                                     │
│  │       src/ (frontend)       │                                     │
│  │   React + Vite + Tailwind   │                                     │
│  │   Real-time dashboard       │                                     │
│  │   Demo Time Override        │                                     │
│  └─────────────────────────────┘                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Projects

### [`server/`](./server/README.md) — Backend API + Frontend Serve
Express REST API, Socket.IO real-time events, MongoDB analytics,
SQLite/JSON state persistence, AI assistant, alert engine, and demo mode.

### [`bot/`](./bot/README.md) — Discord Bot
Standalone Discord bot that connects to `server/` via REST API and Socket.IO.
Receives live data for commands and critical alert push notifications.

---

## Quick Start

### 1. Backend server

```bash
cd server
npm install
cp .env.example .env        # fill in your values
npm run dev                 # starts on http://localhost:3001
```

### 2. Discord bot (separate terminal)

```bash
cd bot
npm install
cp .env.example .env        # fill in your Discord token + API_BASE_URL
npm run dev
```

### 3. Frontend

The frontend is a Figma Make project and runs via the Figma Make canvas.
To build standalone: `pnpm build` in the root directory.

---

## Environment Variables

| Project | File | Docs |
|---------|------|------|
| Backend | `server/.env.example` | [server/README.md](./server/README.md) |
| Bot     | `bot/.env.example`    | [bot/README.md](./bot/README.md) |

> ⚠️ Never commit `.env` files. They are listed in `.gitignore`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS v4, Recharts |
| Backend | Node.js, Express, TypeScript, Socket.IO |
| Database | MongoDB (analytics), SQLite / JSON (state) |
| Real-time | Socket.IO namespaces + rooms |
| AI | OpenAI / DeepSeek / Gemini / Ollama |
| Bot | Discord.js v14 |
| Storage | better-sqlite3 (WAL mode), JSON fallback |

---

## Features

- **15 simulated devices** across 3 rooms (fans + lights), randomly toggled every 15–60 s
- **Real-time Socket.IO** broadcasts: device updates, power usage, alerts
- **Alert engine**: after-hours devices (after 5 PM), sustained load (all ON > 2 h)
- **Demo Time Override**: click the clock in the dashboard to simulate any hour — alerts fire instantly, no data is saved
- **AI assistant** (`!ask` in Discord or `POST /ai/ask`): answers questions about live device state using grounded context — no hallucination
- **Persistent state**: SQLite or JSON fallback, auto-restored on restart
- **Discord commands**: `!status`, `!room`, `!usage`, `!alerts`, `!ask`, `!help`
