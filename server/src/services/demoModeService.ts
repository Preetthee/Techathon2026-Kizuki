/**
 * Demo Mode Service
 *
 * Enables presenters to simulate any time of day so office-hour alerts
 * can be demonstrated without waiting for 5 PM.
 *
 * Two guarantees while demo mode is active:
 *   1. getEffectiveHour() / getEffectiveDate() return the fake time.
 *      The alert engine uses these instead of new Date().
 *   2. isDemoActive() returns true, causing StorageService to skip all
 *      disk/DB writes — demo state is never persisted.
 *
 * On disableDemoMode():
 *   - Fake time is cleared → all time-checks revert to real system time.
 *   - StorageService.loadState() is called to restore the in-memory device
 *     store from the last real saved state (discarding any demo mutations).
 */

import * as StorageService from '../storage/StorageService';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemoStatus {
  active:     boolean;
  hour?:      number;
  minute?:    number;
  enabledAt?: string;   // ISO timestamp
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface DemoState {
  hour:      number;
  minute:    number;
  enabledAt: Date;
}

let _demo: DemoState | null = null;

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Activate demo mode with a specific fake hour and minute.
 * StorageService writes are blocked from this point.
 */
export function enableDemoMode(hour: number, minute: number): void {
  if (hour < 0 || hour > 23) throw new Error(`Invalid hour: ${hour}`);
  if (minute < 0 || minute > 59) throw new Error(`Invalid minute: ${minute}`);

  _demo = { hour, minute, enabledAt: new Date() };

  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  console.log(`[demo] Demo mode ENABLED — effective time set to ${timeStr}`);
}

/**
 * Deactivate demo mode.
 * Restores the last real saved state from disk into the in-memory store,
 * discarding any mutations that occurred during demo mode.
 */
export function disableDemoMode(): void {
  if (!_demo) return;

  _demo = null;
  console.log('[demo] Demo mode DISABLED — restoring real state from storage');

  // Reload real device state from the adapter (SQLite / JSON).
  // StorageService.loadState() is now unguarded because isDemoActive() = false.
  try {
    StorageService.loadState();
  } catch (err: any) {
    console.error('[demo] Failed to restore state after disabling demo mode:', err.message);
  }
}

/** Returns true while a fake time is active. Used by StorageService to block writes. */
export function isDemoActive(): boolean {
  return _demo !== null;
}

/**
 * Returns the hour to use for office-hours evaluation.
 * If demo mode is active, returns the fake hour.
 * Otherwise returns the real current hour.
 */
export function getEffectiveHour(): number {
  return _demo ? _demo.hour : new Date().getHours();
}

/**
 * Returns a Date object representing the effective time.
 * Minutes are set to the demo minutes when active.
 * Used by the frontend context builder and any service that needs a full Date.
 */
export function getEffectiveDate(): Date {
  if (!_demo) return new Date();
  const d = new Date();
  d.setHours(_demo.hour, _demo.minute, 0, 0);
  return d;
}

/** Returns a serialisable status object safe to send over HTTP / Socket.IO. */
export function getDemoStatus(): DemoStatus {
  if (!_demo) return { active: false };
  return {
    active:     true,
    hour:       _demo.hour,
    minute:     _demo.minute,
    enabledAt:  _demo.enabledAt.toISOString(),
  };
}
