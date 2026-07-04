/**
 * MongoDB connection manager
 *
 * Single connection, shared across the app via Mongoose's global state.
 * Handles reconnection automatically via Mongoose's built-in retry logic.
 *
 * Usage:
 *   await connectDB();   // call once at startup, before any route is served
 *   await disconnectDB();// call on SIGTERM
 */

import mongoose from 'mongoose';
import config from '../config';

const CONNECT_OPTIONS: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 5_000,  // fail fast if MongoDB is unreachable
  socketTimeoutMS:          45_000,
  maxPoolSize:              10,      // keep 10 connections in the pool
  retryWrites:              true,
};

// ─── Event listeners (logged once) ───────────────────────────────────────────

mongoose.connection.on('connected', () =>
  console.log(`[mongodb] Connected → ${sanitiseUri(config.mongoUri)}`)
);
mongoose.connection.on('disconnected', () =>
  console.warn('[mongodb] Disconnected')
);
mongoose.connection.on('error', (err) =>
  console.error('[mongodb] Error:', err.message)
);

function sanitiseUri(uri: string): string {
  // Remove credentials from log output
  try {
    const u = new URL(uri);
    u.password = u.password ? '***' : '';
    u.username = u.username ? u.username : '';
    return u.toString();
  } catch {
    return uri.replace(/:\/\/.*@/, '://<credentials>@');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return; // already connected

  try {
    await mongoose.connect(config.mongoUri, CONNECT_OPTIONS);
  } catch (err: any) {
    console.error('[mongodb] Initial connection failed:', err.message);
    // Let the process crash — without DB the server cannot persist anything
    throw err;
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.connection.close();
  console.log('[mongodb] Connection closed');
}

export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
