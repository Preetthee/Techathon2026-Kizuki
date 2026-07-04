/**
 * Socket.IO Server
 *
 * Bootstraps the Socket.IO server and wires all services together.
 *
 * Namespace layout
 * ────────────────
 *   /monitor   primary namespace — dashboards, Discord bot, frontend
 *   (future)   /admin — simulator control, internal metrics
 *
 * Service integration
 * ───────────────────
 *   deviceSimulator → broadcaster.broadcastDeviceUpdate / broadcastUsageUpdate
 *   alertEngine     → broadcaster.broadcastAlertNew / broadcastAlertResolved
 *
 * Both services receive the broadcaster callback rather than a direct io
 * reference. This keeps them transport-agnostic and independently testable.
 */

import { Server as HttpServer }   from 'http';
import { Server, ServerOptions }   from 'socket.io';
import config                      from '../config';
import { createMonitorNamespace }  from './namespaces/monitor';
import { startSimulator }          from '../services/deviceSimulator';
import {
  startAlertEngine,
  stopAlertEngine,
  onAlert,
}                                  from '../services/alertEngine';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
}                                  from './events';

// ─── Socket.IO server options ─────────────────────────────────────────────────

const IO_OPTIONS: Partial<ServerOptions> = {
  cors: {
    origin:  config.clientOrigin,
    methods: ['GET', 'POST'],
  },
  // Ping/pong — detect dead connections within 45 s
  pingTimeout:  20_000,
  pingInterval: 25_000,

  // Prevent clients from hammering reconnect on transient errors
  connectTimeout: 10_000,

  // Allow both WebSocket and long-poll for environments that block WS
  transports: ['websocket', 'polling'],
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export function initSocket(httpServer: HttpServer): Server {
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, IO_OPTIONS);

  // ── /monitor namespace ───────────────────────────────────────────────────
  const { broadcaster } = createMonitorNamespace(io);

  // ── Wire device simulator → broadcaster ─────────────────────────────────
  startSimulator(io, {
    onDeviceUpdate(device) {
      broadcaster.broadcastDeviceUpdate(device);
      broadcaster.broadcastUsageUpdate();
    },
  });

  // ── Wire alert engine → broadcaster ─────────────────────────────────────
  startAlertEngine(io);

  onAlert((alert) => {
    broadcaster.broadcastAlertNew(alert, true);
  });

  // ─── Middleware: log every namespace connection attempt ─────────────────
  io.use((socket, next) => {
    const ns   = socket.nsp.name;
    const addr = socket.handshake.address;
    console.log(`[socket] handshake  ns=${ns}  from=${addr}`);
    next();
  });

  console.log('[socket] Server ready');
  console.log(`[socket] CORS origin: ${config.clientOrigin}`);
  console.log('[socket] Namespaces: /monitor');

  return io;
}

// ─── Graceful teardown (called from process.on SIGTERM) ──────────────────────

export function teardownSocket(io: Server): Promise<void> {
  return new Promise((resolve) => {
    stopAlertEngine();
    io.close(() => {
      console.log('[socket] All connections closed');
      resolve();
    });
  });
}
