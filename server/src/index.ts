/**
 * Server Entry Point
 *
 * Boot sequence
 * ─────────────
 *  1. init StorageService   — create SQLite tables / JSON directory
 *  2. loadState()           — restore devices + alerts from disk
 *  3. connect MongoDB       — analytics/aggregation layer (non-blocking on failure)
 *  4. wire write-throughs   — every state change → disk + MongoDB
 *  5. start usage logger    — periodic snapshots to disk + MongoDB
 *  6. start Socket.IO       — simulator + alert engine
 *  7. listen
 *  8. SIGTERM: saveState() → close sockets → close DB → exit
 */

import http from 'http';
import express from 'express';
import cors from 'cors';

import config from './config';
import { logger }         from './middleware/logger';
import { errorHandler }   from './middleware/errorHandler';

// ── Storage (primary persistence) ─────────────────────────────────────────────
import * as StorageService from './storage/StorageService';

// ── MongoDB (analytics — optional, non-fatal) ──────────────────────────────────
import { connectDB, disconnectDB } from './db/connection';
import { syncDevicesOnStartup }    from './services/deviceDbService';
import { persistAlert as persistAlertMongo, persistAlertResolution } from './services/alertDbService';

// ── Services ───────────────────────────────────────────────────────────────────
import { onAlert, resolveAlert } from './services/alertEngine';
import { startUsageLogger, stopUsageLogger } from './services/usageLogService';
import { initSocket, teardownSocket } from './socket';

// ── Routes ─────────────────────────────────────────────────────────────────────
import devicesRouter from './routes/devices';
import roomsRouter   from './routes/rooms';
import usageRouter   from './routes/usage';
import alertsRouter  from './routes/alerts';
import aiRouter      from './routes/ai';
import demoRouter    from './routes/demo';

const app        = express();
const httpServer = http.createServer(app);

app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());
app.use(logger);

app.get('/health', (_req, res) => {
  const storage = StorageService.getStorageInfo();
  res.json({ status: 'ok', ts: new Date().toISOString(), storage });
});
app.get('/simulator', (_req, res) => {
  const { getSimulatorStats } = require('./services/deviceSimulator');
  const { getAlerts }         = require('./services/alertEngine');
  res.json({ simulator: getSimulatorStats(), activeAlerts: getAlerts().length });
});

app.use('/devices', devicesRouter);
app.use('/rooms',   roomsRouter);
app.use('/usage',   usageRouter);
app.use('/alerts',  alertsRouter);
app.use('/ai',      aiRouter);
app.use('/demo',    demoRouter);

app.use((_req, res) =>
  res.status(404).json({ error: { message: 'Route not found', status: 404 } })
);
app.use(errorHandler);

// ─── Boot ──────────────────────────────────────────────────────────────────────

async function start() {
  // ── 1. Storage (synchronous, must succeed) ──────────────────────────────────
  StorageService.init();

  // ── 2. Restore state from disk ─────────────────────────────────────────────
  const startupMode = StorageService.loadState();
  console.log(`[server] Startup mode: ${startupMode}`);

  // ── 3. MongoDB — non-blocking; analytics work even if Mongo is down ─────────
  try {
    await connectDB();
    await syncDevicesOnStartup();   // sync Mongo with current in-memory state
  } catch (err: any) {
    console.warn(`[server] MongoDB unavailable — running without analytics: ${err.message}`);
  }

  // ── 4. Write-throughs: alert engine → disk + MongoDB ───────────────────────
  onAlert((alert) => {
    StorageService.saveAlert(alert);      // synchronous, to disk immediately
    persistAlertMongo(alert);             // async, best-effort
  });

  // ── 5. Usage logger ─────────────────────────────────────────────────────────
  startUsageLogger();

  // ── 6. Socket.IO + simulator + alert engine ─────────────────────────────────
  const io = initSocket(httpServer);

  // ── 7. Listen ───────────────────────────────────────────────────────────────
  httpServer.listen(config.port, () => {
    const storage = StorageService.getStorageInfo();
    console.log(`[server] Office Power Monitor on http://localhost:${config.port}`);
    console.log(`[server] Storage: ${storage.adapter.toUpperCase()} → ${storage.path}`);
    console.log(`[server] CORS origin: ${config.clientOrigin}`);
    console.log(`[server] Office hours: ${config.officeHours.start}:00 – ${config.officeHours.end}:00`);
  });

  // ── 8. Graceful shutdown ────────────────────────────────────────────────────
  async function shutdown(signal: string) {
    console.log(`\n[server] ${signal} — saving state and shutting down`);
    StorageService.saveState();    // full atomic snapshot before exit
    stopUsageLogger();
    await teardownSocket(io);
    httpServer.close(async () => {
      await disconnectDB();
      console.log('[server] Clean exit');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[server] Startup failed:', err.message);
  process.exit(1);
});
