/**
 * Persistence Types
 *
 * These are the serialisable shapes written to disk / SQLite.
 * They are intentionally flat and free of Mongoose / domain-class baggage
 * so they can be safely JSON.stringify'd and read back without hydration.
 */

// ─── Persisted device row ─────────────────────────────────────────────────────

export interface PersistedDevice {
  deviceId:    string;
  name:        string;
  room:        string;
  type:        'fan' | 'light';
  status:      boolean;
  powerDraw:   number;
  lastChanged: string;   // ISO string
}

// ─── Persisted alert row ──────────────────────────────────────────────────────

export interface PersistedAlert {
  alertId:     string;
  room:        string | null;
  type:        'AFTER_HOURS' | 'SUSTAINED_LOAD';
  message:     string;
  severity:    'WARNING' | 'CRITICAL';
  deviceId:    string | null;
  triggeredAt: string;   // ISO string
  resolvedAt:  string | null;
  meta:        string;   // JSON-encoded Record<string, unknown>
}

// ─── Persisted usage snapshot ────────────────────────────────────────────────

export interface PersistedUsageSnapshot {
  timestamp:        string;   // ISO string
  totalSystemPower: number;
  totalOnCount:     number;
  totalDevices:     number;
  roomsJson:        string;   // JSON-encoded room rollups
}

// ─── Full persisted state (what saveState / loadState exchange) ───────────────

export interface PersistedState {
  version:        number;          // schema version for future migrations
  savedAt:        string;          // ISO — when the snapshot was written
  devices:        PersistedDevice[];
  activeAlerts:   PersistedAlert[];
  recentUsage:    PersistedUsageSnapshot[];  // last N snapshots
}

// ─── Adapter interface ────────────────────────────────────────────────────────

export interface IStorageAdapter {
  /** One-time setup (create tables, ensure directories exist). */
  init(): void;

  /** Atomically write the full state. */
  saveState(state: PersistedState): void;

  /**
   * Read the last saved state.
   * Returns null if no state has been saved yet (first run).
   */
  loadState(): PersistedState | null;

  /** Upsert a single device (called on every toggle). */
  saveDevice(device: PersistedDevice): void;

  /** Upsert a single alert (called on every alert raise / escalation). */
  saveAlert(alert: PersistedAlert): void;

  /** Mark an alert as resolved. */
  resolveAlert(alertId: string, resolvedAt: string): void;

  /** Append one usage snapshot. Older rows beyond `keepLast` are pruned. */
  appendUsageSnapshot(snapshot: PersistedUsageSnapshot, keepLast?: number): void;

  /** Human-readable name for logs. */
  readonly name: string;
}
