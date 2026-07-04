import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { io, type Socket } from "socket.io-client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area,
} from "recharts";
import { Fan, Lightbulb, AlertTriangle, Zap, Activity, Clock, Wifi } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type DeviceType = "fan" | "light";

interface Device {
  id: string;
  name: string;
  room: string;
  type: DeviceType;
  status: boolean;
  powerDraw: number;
  lastChanged: string;
}

interface Alert {
  id: string;
  type: "AFTER_HOURS" | "SUSTAINED_LOAD";
  severity: "WARNING" | "CRITICAL";
  message: string;
  room: string | null;
  deviceId: string | null;
  timestamp: string;
  resolvedAt?: string | null;
  meta?: Record<string, unknown>;
  durationMs?: number;
}

interface DemoStatus {
  active: boolean;
  hour?: number;
  minute?: number;
}

interface DevicesSnapshotPayload {
  devices: Device[];
  timestamp: string;
}

interface DeviceUpdatePayload {
  device: Device;
  changedAt: string;
}

interface AlertsSnapshotPayload {
  alerts: Alert[];
  timestamp: string;
}

interface AlertNewPayload {
  alert: Alert;
  isNew: boolean;
}

interface AlertResolvedPayload {
  alertId: string;
  resolvedAt: string;
}

interface HistoryPoint {
  t: string;
  total: number;
  drawing: number;
  work1: number;
  work2: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROOMS = ["Drawing Room", "Work Room 1", "Work Room 2"] as const;
const POWER: Record<DeviceType, number> = { fan: 60, light: 15 };
const OFFICE_START = 9;
const OFFICE_END = 17;
const SOCKET_FALLBACK_REFRESH_MS = 30_000;
const API_BASE_URL =
  ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roomId(room: string) {
  return room.replace(/\s+/g, "_").toLowerCase();
}

function buildDevices(): Device[] {
  const devices: Device[] = [];
  ROOMS.forEach((room) => {
    for (let f = 1; f <= 2; f++) {
      devices.push({
        id: `${roomId(room)}_fan_${f}`,
        name: `Fan ${f}`,
        room,
        type: "fan",
        status: false,
        powerDraw: 0,
        lastChanged: new Date().toISOString(),
      });
    }
    for (let l = 1; l <= 3; l++) {
      devices.push({
        id: `${roomId(room)}_light_${l}`,
        name: `Light ${l}`,
        room,
        type: "light",
        status: false,
        powerDraw: 0,
        lastChanged: new Date().toISOString(),
      });
    }
  });
  return devices;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

function updateRoomAllOnSinceFromDevices(
  devices: Device[],
  previous: Map<string, Date | null>,
): Map<string, Date | null> {
  const next = new Map(previous);
  ROOMS.forEach((room) => {
    const roomDevices = devices.filter((d) => d.room === room);
    const allOn = roomDevices.length > 0 && roomDevices.every((d) => d.status);
    if (allOn && !next.get(room)) {
      const oldestChange = roomDevices
        .map((d) => new Date(d.lastChanged).getTime())
        .filter(Number.isFinite)
        .sort((a, b) => a - b)[0];
      next.set(room, new Date(oldestChange || Date.now()));
    } else if (!allOn) {
      next.set(room, null);
    }
  });
  return next;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatPill({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-sm tracking-[0.14em] uppercase text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold tabular-nums tracking-wide ${accent ? "text-primary" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

function DeviceButton({
  device,
  onToggle,
}: {
  device: Device;
  onToggle: (id: string) => void;
}) {
  const isFan = device.type === "fan";
  const on = device.status;

  return (
    <button
      onClick={() => onToggle(device.id)}
      className={`
        flex flex-col items-center gap-1.5 p-3 border transition-all duration-300 flex-1 min-w-0
        ${on && isFan ? "border-cyan-400/40 bg-cyan-400/8 text-cyan-300" : ""}
        ${on && !isFan ? "border-yellow-400/40 bg-yellow-400/8 text-yellow-300" : ""}
        ${!on ? "border-border/30 text-muted-foreground/40 hover:border-border/60 hover:text-muted-foreground/70" : ""}
      `}
      style={{ borderRadius: "2px" }}
    >
      {isFan ? (
        <Fan
          size={16}
          className={on ? "text-cyan-400" : ""}
          style={on ? { animation: "spin 2s linear infinite" } : {}}
        />
      ) : (
        <Lightbulb
          size={16}
          className={on ? "text-yellow-400" : ""}
          style={on ? { filter: "drop-shadow(0 0 4px #facc15)" } : {}}
        />
      )}
      <span className="text-sm tracking-widest uppercase">{device.name}</span>
      <span className={`text-xs tabular-nums font-bold ${on ? "" : "opacity-30"}`}>
        {device.powerDraw}W
      </span>
    </button>
  );
}

function RoomCard({
  room,
  devices,
  onToggle,
  allOnSince,
}: {
  room: string;
  devices: Device[];
  onToggle: (id: string) => void;
  allOnSince: Date | null;
}) {
  const fans = devices.filter((d) => d.type === "fan");
  const lights = devices.filter((d) => d.type === "light");
  const totalPower = devices.reduce((s, d) => s + d.powerDraw, 0);
  const onCount = devices.filter((d) => d.status).length;
  const maxPower = devices.reduce((s, d) => s + POWER[d.type], 0);
  const loadPct = maxPower > 0 ? (totalPower / maxPower) * 100 : 0;
  const allOn = onCount === devices.length;

  return (
    <div
      className={`bg-card border flex flex-col gap-4 p-4 transition-colors duration-500 ${
        allOn ? "border-cyan-400/30" : "border-border/50"
      }`}
      style={{ borderRadius: "2px" }}
    >
      {/* Room header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xs font-bold tracking-[0.12em] uppercase text-muted-foreground leading-none">
            {room}
          </h2>
          {allOnSince && (
            <div className="text-sm text-amber-400 tracking-wider mt-1">
              ALL ON · {Math.floor((Date.now() - allOnSince.getTime()) / 60000)}m
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-base font-bold tabular-nums text-primary leading-none">{totalPower}W</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {onCount}/{devices.length} active
          </div>
        </div>
      </div>

      {/* Load bar */}
      <div className="h-px bg-border/30 relative overflow-visible">
        <div
          className="absolute top-0 left-0 h-full transition-all duration-700"
          style={{
            width: `${loadPct}%`,
            background: loadPct > 80 ? "#f59e0b" : loadPct > 50 ? "#00d4ff" : "#22c55e",
          }}
        />
      </div>

      {/* Fans */}
      <div className="space-y-1">
        <div className="text-sm tracking-[0.14em] uppercase text-muted-foreground/50">Fans</div>
        <div className="flex gap-2">
          {fans.map((d) => (
            <DeviceButton key={d.id} device={d} onToggle={onToggle} />
          ))}
        </div>
      </div>

      {/* Lights */}
      <div className="space-y-1">
        <div className="text-sm tracking-[0.14em] uppercase text-muted-foreground/50">Lights</div>
        <div className="flex gap-2">
          {lights.map((d) => (
            <DeviceButton key={d.id} device={d} onToggle={onToggle} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [roomAllOnSince, setRoomAllOnSince] = useState<Map<string, Date | null>>(
    () => new Map(ROOMS.map((r) => [r, null]))
  );
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [now, setNow] = useState(new Date());
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [activeTab, setActiveTab] = useState<"overview" | "devices" | "alerts">("overview");
  const [lastToggled, setLastToggled] = useState<string | null>(null);
  const devicesRef = useRef(devices);
  devicesRef.current = devices;

  // ── Demo time ──────────────────────────────────────────────────────────────
  const [demoTime, setDemoTime] = useState<{ hour: number; minute: number } | null>(null);
  const [showDemoPicker, setShowDemoPicker] = useState(false);
  const [pickerHour, setPickerHour] = useState(22);
  const [pickerMinute, setPickerMinute] = useState(0);

  const effectiveDate = useMemo(() => {
    if (!demoTime) return now;
    const d = new Date(now);
    d.setHours(demoTime.hour, demoTime.minute, 0, 0);
    return d;
  }, [now, demoTime]);

  const isDemoMode = demoTime !== null;

  const loadLiveState = useCallback(async () => {
    try {
      const [nextDevices, nextAlerts, demoStatus] = await Promise.all([
        apiGet<Device[]>("/devices"),
        apiGet<Alert[]>("/alerts"),
        apiGet<DemoStatus>("/demo"),
      ]);

      setDevices(nextDevices);
      setAlerts(nextAlerts);
      setRoomAllOnSince((prev) => updateRoomAllOnSinceFromDevices(nextDevices, prev));
      setDemoTime(
        demoStatus.active && typeof demoStatus.hour === "number"
          ? { hour: demoStatus.hour, minute: demoStatus.minute ?? 0 }
          : null
      );
      setLiveError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Backend unavailable";
      setLiveError(message);
    }
  }, []);

  const applyDeviceList = useCallback((nextDevices: Device[]) => {
    setDevices(nextDevices);
    setRoomAllOnSince((prev) => updateRoomAllOnSinceFromDevices(nextDevices, prev));
  }, []);

  const applyDeviceUpdate = useCallback((updated: Device) => {
    setDevices((prev) => {
      const found = prev.some((d) => d.id === updated.id);
      const next = found
        ? prev.map((d) => (d.id === updated.id ? updated : d))
        : [...prev, updated];
      setRoomAllOnSince((old) => updateRoomAllOnSinceFromDevices(next, old));
      return next;
    });
  }, []);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Backend-backed live state. Socket.IO is primary; REST is a slow fallback.
  useEffect(() => {
    void loadLiveState();

    const socket: Socket = io(`${API_BASE_URL}/monitor`, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1500,
    });

    socket.on("connect", () => {
      setSocketConnected(true);
      setLiveError(null);
    });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", (err) => {
      setSocketConnected(false);
      setLiveError(`Socket.IO: ${err.message}`);
    });
    socket.on("devices:snapshot", (payload: DevicesSnapshotPayload) => {
      applyDeviceList(payload.devices);
      setLiveError(null);
    });
    socket.on("device:update", (payload: DeviceUpdatePayload) => {
      applyDeviceUpdate(payload.device);
      setLiveError(null);
    });
    socket.on("alerts:snapshot", (payload: AlertsSnapshotPayload) => {
      setAlerts(payload.alerts);
      setLiveError(null);
    });
    socket.on("alert:new", (payload: AlertNewPayload) => {
      setAlerts((prev) => {
        const withoutExisting = prev.filter((a) => a.id !== payload.alert.id);
        return [payload.alert, ...withoutExisting].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      });
      setLiveError(null);
    });
    socket.on("alert:resolved", (payload: AlertResolvedPayload) => {
      setAlerts((prev) => prev.filter((a) => a.id !== payload.alertId));
    });
    socket.on("demo:status", (status: DemoStatus) => {
      setDemoTime(status.active && typeof status.hour === "number" ? { hour: status.hour, minute: status.minute ?? 0 } : null);
    });

    const fallback = setInterval(() => void loadLiveState(), SOCKET_FALLBACK_REFRESH_MS);

    return () => {
      clearInterval(fallback);
      socket.disconnect();
    };
  }, [applyDeviceList, applyDeviceUpdate, loadLiveState]);

  // Alerts — recompute whenever devices, room tracking, or effective time changes
  // Power history (record every 5s)
  useEffect(() => {
    const record = () => {
      if (devicesRef.current.length === 0) return;
      const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const byRoom = (room: string) =>
        devicesRef.current.filter((d) => d.room === room).reduce((s, d) => s + d.powerDraw, 0);
      setHistory((prev) => [
        ...prev.slice(-29),
        {
          t,
          total: devicesRef.current.reduce((s, d) => s + d.powerDraw, 0),
          drawing: byRoom("Drawing Room"),
          work1: byRoom("Work Room 1"),
          work2: byRoom("Work Room 2"),
        },
      ]);
    };
    record();
    const t = setInterval(record, 2000);
    return () => clearInterval(t);
  }, []);

  const handleToggle = useCallback(
    async (id: string) => {
      try {
        const updated = await apiRequest<Device>(`/devices/${encodeURIComponent(id)}/toggle`, { method: "POST" });
        setDevices((prev) => {
          const next = prev.map((d) => (d.id === updated.id ? updated : d));
          setRoomAllOnSince((old) => updateRoomAllOnSinceFromDevices(next, old));
          return next;
        });
        setLastToggled(id);
        setLiveError(null);
        await loadLiveState();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not toggle device";
        setLiveError(message);
      } finally {
        setTimeout(() => setLastToggled(null), 600);
      }
    },
    [loadLiveState]
  );

  const totalPower = devices.reduce((s, d) => s + d.powerDraw, 0);
  const onCount = devices.filter((d) => d.status).length;
  const effectiveHour = effectiveDate.getHours();
  const isOfficeHours = effectiveHour >= OFFICE_START && effectiveHour < OFFICE_END;

  const roomSummaries = ROOMS.map((room) => ({
    room,
    devices: devices.filter((d) => d.room === room),
    totalPower: devices.filter((d) => d.room === room).reduce((s, d) => s + d.powerDraw, 0),
    allOnSince: roomAllOnSince.get(room) ?? null,
  }));

  const criticalCount = alerts.filter((a) => a.severity === "CRITICAL").length;

  // ── Demo mode handlers ──────────────────────────────────────────────────────
  const handleActivateDemoMode = useCallback(async () => {
    try {
      const response = await apiRequest<{ ok: boolean; status: DemoStatus }>("/demo/set", {
        method: "POST",
        body: JSON.stringify({ hour: pickerHour, minute: pickerMinute }),
      });
      const status = response.status;
      setDemoTime(status.active && typeof status.hour === "number" ? { hour: status.hour, minute: status.minute ?? 0 } : null);
      setShowDemoPicker(false);
      await loadLiveState();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not activate demo mode";
      setLiveError(message);
    }
  }, [loadLiveState, pickerHour, pickerMinute]);

  const handleExitDemoMode = useCallback(async () => {
    try {
      await apiRequest<{ ok: boolean; status: DemoStatus }>("/demo", { method: "DELETE" });
      setDemoTime(null);
      setShowDemoPicker(false);
      await loadLiveState();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not exit demo mode";
      setLiveError(message);
    }
  }, [loadLiveState]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" style={{ fontFamily: "'JetBrains Mono', monospace" }}>

      {/* ── Header ── */}
      <header className="border-b border-border/60 px-5 py-3 flex items-center justify-between shrink-0" style={{ background: "#080c10" }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <Zap size={14} className="text-primary" />
          </div>
          <span
            className="text-sm font-bold tracking-[0.16em] uppercase text-foreground"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "17px", letterSpacing: "0.14em" }}
          >
            Office Power Monitor
          </span>
          <span className="text-muted-foreground/30 text-xs tracking-widest hidden md:inline">v1.0</span>
        </div>

        <div className="flex items-center gap-5">
          <div className="hidden md:flex items-center gap-1.5">
            <Wifi size={10} className="text-primary opacity-70" />
            <span className="text-sm text-primary/60 tracking-widest uppercase">Live</span>
          </div>
          <div className={`text-xs tracking-widest font-bold uppercase ${isOfficeHours ? "text-green-400" : "text-amber-400"}`}>
            <span className="mr-1">{isOfficeHours ? "●" : "○"}</span>
            {isOfficeHours ? "Office Hrs" : "After Hrs"}
          </div>
          <button
            onClick={() => setShowDemoPicker(true)}
            title={isDemoMode ? "Demo Time Active — click to change" : "Click to simulate a different time"}
            className={`text-sm tabular-nums transition-colors cursor-pointer px-1.5 py-0.5 border ${
              isDemoMode
                ? "text-amber-400 font-bold border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20"
                : "text-muted-foreground border-transparent hover:border-border/40 hover:text-primary"
            }`}
            style={{ borderRadius: "2px" }}
          >
            {isDemoMode
              ? `⚑ ${effectiveDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : now.toLocaleTimeString()}
          </button>
          <StatPill label="Total Draw" value={`${totalPower}W`} accent />
          <StatPill label="Active" value={`${onCount}/15`} />
          {alerts.length > 0 && (
            <div className={`text-xs font-bold tabular-nums ${criticalCount > 0 ? "text-red-400" : "text-amber-400"}`}>
              ⚠ {alerts.length}
            </div>
          )}
        </div>
      </header>

      {liveError && (
        <div className="border-b border-red-500/40 px-5 py-2 text-xs tracking-wider text-red-300" style={{ background: "rgba(239,68,68,0.08)" }}>
          Backend connection issue: {liveError}. Start the backend at {API_BASE_URL}.
        </div>
      )}

      {/* ── Demo Mode Banner ── */}
      {isDemoMode && (
        <div className="border-b border-amber-500/40 px-5 py-2 flex items-center justify-between shrink-0" style={{ background: "rgba(245,158,11,0.08)" }}>
          <div className="flex items-center gap-2 text-xs text-amber-300 min-w-0">
            <AlertTriangle size={12} className="shrink-0 text-amber-400" />
            <span className="font-bold tracking-widest uppercase text-xs text-amber-400 shrink-0">⚠ Demo Mode Active</span>
            <span className="text-amber-300/50 hidden md:inline">·</span>
            <span className="text-amber-300/70 hidden md:inline text-xs truncate">
              Simulated time: <strong>{effectiveDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong>
              {" "}— Changes made while using a custom time are temporary. No data is being saved.
              Exiting Demo Mode restores the last real saved state.
            </span>
          </div>
          <button
            onClick={handleExitDemoMode}
            className="shrink-0 ml-4 text-sm font-bold tracking-widest uppercase text-amber-400 border border-amber-500/40 px-2.5 py-1 hover:bg-amber-500/20 transition-colors"
            style={{ borderRadius: "2px" }}
          >
            Return to Real Time
          </button>
        </div>
      )}

      {/* ── Demo Time Picker Modal ── */}
      {showDemoPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowDemoPicker(false); }}
        >
          <div
            className="bg-card border border-border/80 p-6 w-80 space-y-4 shadow-2xl"
            style={{ borderRadius: "2px", fontFamily: "'JetBrains Mono', monospace" }}
          >
            {/* Title */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-primary" />
                <h3 className="text-sm font-bold tracking-widest uppercase text-primary"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.18em" }}>
                  Demo Time Override
                </h3>
              </div>
              <button
                onClick={() => setShowDemoPicker(false)}
                className="text-muted-foreground/40 hover:text-muted-foreground text-xs transition-colors"
              >✕</button>
            </div>

            {/* Warning note */}
            <div className="text-xs text-amber-300/80 border border-amber-500/20 bg-amber-500/5 p-3 leading-relaxed"
              style={{ borderRadius: "2px" }}>
              <div className="font-bold text-amber-400 mb-1">⚠ Demo time is for testing only.</div>
              While demo time is active, simulated events, alerts, and state changes
              are <strong>NOT permanently saved</strong>.
            </div>

            {/* Hour selector */}
            <div className="space-y-1">
              <label className="text-sm tracking-[0.14em] uppercase text-muted-foreground/60">Hour</label>
              <div className="grid grid-cols-6 gap-1">
                {Array.from({ length: 24 }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setPickerHour(i)}
                    className={`text-sm py-1.5 border transition-colors tabular-nums ${
                      pickerHour === i
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-300 font-bold"
                        : "border-border/30 text-muted-foreground/50 hover:border-border hover:text-muted-foreground"
                    }`}
                    style={{ borderRadius: "1px" }}
                  >
                    {String(i).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            {/* Minute selector */}
            <div className="space-y-1">
              <label className="text-sm tracking-[0.14em] uppercase text-muted-foreground/60">Minute</label>
              <div className="grid grid-cols-4 gap-1">
                {[0, 15, 30, 45].map((m) => (
                  <button
                    key={m}
                    onClick={() => setPickerMinute(m)}
                    className={`text-xs py-2 border transition-colors tabular-nums ${
                      pickerMinute === m
                        ? "border-amber-500/60 bg-amber-500/15 text-amber-300 font-bold"
                        : "border-border/30 text-muted-foreground/50 hover:border-border hover:text-muted-foreground"
                    }`}
                    style={{ borderRadius: "1px" }}
                  >
                    :{String(m).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview */}
            <div className="text-center text-amber-400 font-bold tabular-nums text-sm border border-amber-500/20 py-2"
              style={{ borderRadius: "2px", background: "rgba(245,158,11,0.05)" }}>
              {String(pickerHour).padStart(2, "0")}:{String(pickerMinute).padStart(2, "0")}
              {" "}— {pickerHour < OFFICE_START || pickerHour >= OFFICE_END ? "⚠ After Hours" : "✓ Office Hours"}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={handleActivateDemoMode}
                className="flex-1 text-xs font-bold tracking-widest uppercase py-2.5 border border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors"
                style={{ borderRadius: "2px" }}
              >
                Activate Demo Time
              </button>
              <button
                onClick={() => setShowDemoPicker(false)}
                className="text-xs tracking-widest uppercase px-4 py-2.5 border border-border/40 text-muted-foreground/60 hover:border-border hover:text-muted-foreground transition-colors"
                style={{ borderRadius: "2px" }}
              >
                Cancel
              </button>
            </div>

            {/* Exit demo if already active */}
            {isDemoMode && (
              <button
                onClick={handleExitDemoMode}
                className="w-full text-xs tracking-widest uppercase py-2 border border-border/30 text-muted-foreground/40 hover:text-muted-foreground hover:border-border/60 transition-colors"
                style={{ borderRadius: "2px" }}
              >
                Return to Real Time
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Tab Bar ── */}
      <nav className="border-b border-border/40 px-5 flex gap-0 shrink-0" style={{ background: "#080c10" }}>
        {(["overview", "devices", "alerts"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-xs tracking-[0.12em] uppercase transition-colors relative ${
              activeTab === tab
                ? "text-primary"
                : "text-muted-foreground/50 hover:text-muted-foreground"
            }`}
          >
            {tab}
            {tab === "alerts" && alerts.length > 0 && (
              <span className={`ml-1.5 px-1 py-px text-[10px] rounded ${criticalCount > 0 ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>
                {alerts.length}
              </span>
            )}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-primary" />
            )}
          </button>
        ))}
      </nav>

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <>
            {/* Room Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {roomSummaries.map(({ room, devices: rd, totalPower: rp, allOnSince }) => (
                <RoomCard
                  key={room}
                  room={room}
                  devices={rd}
                  onToggle={handleToggle}
                  allOnSince={allOnSince}
                />
              ))}
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Area Chart */}
              <div className="md:col-span-2 bg-card border border-border/50 p-4" style={{ borderRadius: "2px" }}>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Activity size={11} className="text-primary" />
                    <span className="text-sm tracking-[0.14em] uppercase text-muted-foreground">Power History (30 ticks)</span>
                  </div>
                  <span className="text-sm text-muted-foreground/40 tabular-nums">Live samples</span>
                </div>
                {history.length < 2 ? (
                  <div className="h-32 flex items-center justify-center text-xs text-muted-foreground/30 tracking-widest">
                    Collecting data...
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                      <defs>
                        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid key="grid" strokeDasharray="2 6" stroke="rgba(255,255,255,0.04)" />
                      <XAxis key="xaxis" dataKey="t" tick={{ fontSize: 11, fill: "#8b949e", fontFamily: "JetBrains Mono" }} interval="preserveStartEnd" />
                      <YAxis key="yaxis" tick={{ fontSize: 11, fill: "#8b949e", fontFamily: "JetBrains Mono" }} />
                      <Tooltip
                        key="tooltip"
                        contentStyle={{ background: "#0d1117", border: "1px solid rgba(0,212,255,0.15)", fontSize: 12, fontFamily: "JetBrains Mono", borderRadius: "2px", padding: "6px 10px" }}
                        labelStyle={{ color: "#8b949e", marginBottom: 4 }}
                        formatter={(v: number) => [`${v}W`, "Power"]}
                      />
                      <Area key="area-total" name="Power" type="monotone" dataKey="total" stroke="#00d4ff" strokeWidth={1.5} fill="url(#cg)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Room Breakdown */}
              <div className="bg-card border border-border/50 p-4" style={{ borderRadius: "2px" }}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm tracking-[0.14em] uppercase text-muted-foreground">Room Breakdown</span>
                </div>
                <div className="space-y-4">
                  {roomSummaries.map(({ room, totalPower: rp }) => {
                    const maxPossible = 5 * 30; // rough max per room
                    const pct = totalPower > 0 ? Math.min((rp / Math.max(totalPower, 1)) * 100, 100) : 0;
                    return (
                      <div key={room}>
                        <div className="flex justify-between items-baseline mb-1.5">
                          <span className="text-xs text-muted-foreground truncate">{room}</span>
                          <span className="text-sm font-bold text-primary tabular-nums ml-2">{rp}W</span>
                        </div>
                        <div className="h-px bg-border/30 relative">
                          <div
                            className="absolute top-0 left-0 h-full transition-all duration-700"
                            style={{ width: `${pct}%`, background: "#00d4ff" }}
                          />
                        </div>
                        <div className="text-sm text-muted-foreground/40 mt-1">
                          {pct.toFixed(0)}% of total
                        </div>
                      </div>
                    );
                  })}
                  <div className="border-t border-border/30 pt-3 flex justify-between items-baseline">
                    <span className="text-xs text-muted-foreground tracking-widest">TOTAL</span>
                    <span className="text-base font-bold text-primary tabular-nums">{totalPower}W</span>
                  </div>
                  <div className="space-y-1 pt-1 border-t border-border/20">
                    {[
                      { label: "Fans ON", value: devices.filter((d) => d.type === "fan" && d.status).length + "/" + devices.filter((d) => d.type === "fan").length },
                      { label: "Lights ON", value: devices.filter((d) => d.type === "light" && d.status).length + "/" + devices.filter((d) => d.type === "light").length },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between">
                        <span className="text-sm text-muted-foreground/50 tracking-wider uppercase">{label}</span>
                        <span className="text-xs tabular-nums text-foreground/70">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Alerts Panel (compact) */}
            {alerts.length > 0 && (
              <div className="bg-card border border-border/50 p-4" style={{ borderRadius: "2px" }}>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={11} className={criticalCount > 0 ? "text-red-400" : "text-amber-400"} />
                  <span className="text-sm tracking-[0.14em] uppercase text-muted-foreground">
                    {alerts.length} Active Alert{alerts.length !== 1 ? "s" : ""}
                  </span>
                  <button onClick={() => setActiveTab("alerts")} className="ml-auto text-sm text-primary/60 hover:text-primary tracking-widest uppercase transition-colors">
                    View All →
                  </button>
                </div>
                <div className="space-y-1.5">
                  {alerts.slice(0, 3).map((a) => (
                    <div
                      key={a.id}
                      className={`flex items-start gap-3 px-3 py-2 border text-xs ${
                        a.severity === "CRITICAL"
                          ? "border-red-500/25 bg-red-500/5 text-red-300"
                          : "border-amber-500/25 bg-amber-500/5 text-amber-300"
                      }`}
                      style={{ borderRadius: "2px" }}
                    >
                      <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                      <span className="flex-1">{a.message}</span>
                      <span className="text-sm text-muted-foreground/40 tabular-nums shrink-0">
                        {new Date(a.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* DEVICES TAB */}
        {activeTab === "devices" && (
          <div className="bg-card border border-border/50" style={{ borderRadius: "2px" }}>
            <div className="px-4 py-3 border-b border-border/30">
              <span className="text-sm tracking-[0.14em] uppercase text-muted-foreground">
                All Devices — {onCount} of {devices.length} ON · {totalPower}W live
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/20">
                    {["ID", "Name", "Room", "Type", "Status", "Draw", "Last Changed"].map((h) => (
                      <th key={h} className="text-left text-sm tracking-[0.1em] uppercase text-muted-foreground/50 font-normal px-4 py-2.5 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr
                      key={d.id}
                      className={`border-b border-border/10 transition-colors cursor-pointer ${
                        lastToggled === d.id ? "bg-primary/5" : "hover:bg-muted/20"
                      }`}
                      onClick={() => handleToggle(d.id)}
                    >
                      <td className="px-4 py-2.5 text-muted-foreground/40 font-mono text-sm whitespace-nowrap">{d.id}</td>
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">{d.name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{d.room}</td>
                      <td className="px-4 py-2.5 text-muted-foreground capitalize whitespace-nowrap">
                        {d.type === "fan" ? (
                          <span className="flex items-center gap-1"><Fan size={10} />{d.type}</span>
                        ) : (
                          <span className="flex items-center gap-1"><Lightbulb size={10} />{d.type}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-bold tracking-widest ${d.status ? "text-green-400" : "text-muted-foreground/30"}`}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${d.status ? "bg-green-400" : "bg-muted-foreground/20"}`} />
                          {d.status ? "ON" : "OFF"}
                        </span>
                      </td>
                      <td className={`px-4 py-2.5 tabular-nums font-bold whitespace-nowrap ${d.status ? "text-primary" : "text-muted-foreground/30"}`}>
                        {d.powerDraw}W
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground/40 tabular-nums text-sm whitespace-nowrap">
                        {new Date(d.lastChanged).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-border/20">
              <span className="text-sm text-muted-foreground/30 tracking-wider">Click any row to toggle device</span>
            </div>
          </div>
        )}

        {/* ALERTS TAB */}
        {activeTab === "alerts" && (
          <div className="space-y-4">
            {/* Bar chart by room */}
            <div className="bg-card border border-border/50 p-4" style={{ borderRadius: "2px" }}>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm tracking-[0.14em] uppercase text-muted-foreground">Room Power Comparison</span>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart
                  data={roomSummaries.map(({ room, totalPower: rp }) => ({ room: room.replace("Work Room", "WR"), power: rp }))}
                  margin={{ top: 4, right: 4, bottom: 0, left: -28 }}
                >
                  <CartesianGrid key="grid" strokeDasharray="2 6" stroke="rgba(255,255,255,0.04)" />
                  <XAxis key="xaxis" dataKey="room" tick={{ fontSize: 11, fill: "#8b949e", fontFamily: "JetBrains Mono" }} />
                  <YAxis key="yaxis" tick={{ fontSize: 11, fill: "#8b949e", fontFamily: "JetBrains Mono" }} />
                  <Tooltip
                    key="tooltip"
                    contentStyle={{ background: "#0d1117", border: "1px solid rgba(0,212,255,0.15)", fontSize: 12, fontFamily: "JetBrains Mono", borderRadius: "2px" }}
                    formatter={(v: number) => [`${v}W`, "Power"]}
                  />
                  <Bar key="bar-power" name="Power" dataKey="power" fill="#00d4ff" opacity={0.75} radius={[1, 1, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Alerts list */}
            <div className="bg-card border border-border/50 p-4" style={{ borderRadius: "2px" }}>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle size={11} className={criticalCount > 0 ? "text-red-400" : "text-muted-foreground"} />
                <span className="text-sm tracking-[0.14em] uppercase text-muted-foreground">
                  Active Alerts · {alerts.length} total
                </span>
              </div>

              {alerts.length === 0 ? (
                <div className="py-10 flex flex-col items-center gap-2 text-muted-foreground/30">
                  <div className="text-2xl">✓</div>
                  <div className="text-xs tracking-widest uppercase">System Nominal</div>
                  <div className="text-sm">No alerts active</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {alerts.map((a) => (
                    <div
                      key={a.id}
                      className={`p-4 border ${
                        a.severity === "CRITICAL"
                          ? "border-red-500/30 bg-red-500/5"
                          : "border-amber-500/30 bg-amber-500/5"
                      }`}
                      style={{ borderRadius: "2px" }}
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle size={12} className={`mt-0.5 shrink-0 ${a.severity === "CRITICAL" ? "text-red-400" : "text-amber-400"}`} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-bold uppercase tracking-[0.14em] mb-1 ${a.severity === "CRITICAL" ? "text-red-400" : "text-amber-400"}`}>
                            {a.severity} · {a.type === "AFTER_HOURS" ? "After Hours" : "Sustained Load"}
                          </div>
                          <div className={`text-sm ${a.severity === "CRITICAL" ? "text-red-200" : "text-amber-200"}`}>
                            {a.message}
                          </div>
                          {a.room && (
                            <div className="text-sm text-muted-foreground/50 mt-1 tracking-wider">Room: {a.room}</div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm text-muted-foreground/40 tabular-nums">
                            {new Date(a.timestamp).toLocaleTimeString()}
                          </div>
                          {a.durationMs && (
                            <div className="text-sm text-muted-foreground/40 tabular-nums mt-0.5">
                              {(a.durationMs / 3_600_000).toFixed(2)}h
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Office Hours Info */}
            <div className="bg-card border border-border/50 p-4" style={{ borderRadius: "2px" }}>
              <div className="flex items-center gap-2 mb-3">
                <Clock size={11} className="text-muted-foreground/60" />
                <span className="text-sm tracking-[0.14em] uppercase text-muted-foreground">Alert Configuration</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Office Hours", value: `${OFFICE_START}:00 – ${OFFICE_END}:00` },
                  {
                    label: isDemoMode ? "Demo Time" : "Current Time",
                    value: effectiveDate.toLocaleTimeString(),
                    highlight: isDemoMode,
                  },
                  { label: "Status", value: isOfficeHours ? "In Hours" : "After Hours" },
                  { label: "Sustained Threshold", value: "2 hours" },
                ].map(({ label, value, highlight }) => (
                  <div key={label}>
                    <div className="text-sm tracking-[0.1em] uppercase text-muted-foreground/50 mb-1">{label}</div>
                    <div className={`text-sm font-bold ${
                      highlight ? "text-amber-400" :
                      label === "Status" && !isOfficeHours ? "text-amber-400" : "text-foreground"
                    }`}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
              {isDemoMode && (
                <div className="mt-3 pt-3 border-t border-border/20 text-sm text-amber-300/70">
                  ⚠ Demo Mode Active — Alert engine is using simulated time{" "}
                  <strong>{String(demoTime!.hour).padStart(2, "0")}:{String(demoTime!.minute).padStart(2, "0")}</strong>.
                  No changes are being saved. Click the clock in the header to change or exit demo mode.
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border/30 px-5 py-2 flex items-center justify-between shrink-0" style={{ background: "#080c10" }}>
        <div className="flex items-center gap-4 text-sm text-muted-foreground/30 tracking-widest uppercase">
          <span>{socketConnected ? "Socket.IO live" : `REST fallback: ${SOCKET_FALLBACK_REFRESH_MS / 1000}s`}</span>
          <span className="hidden md:inline">15 devices · 3 rooms</span>
          <span className="hidden md:inline">Backend source of truth</span>
        </div>
        <div className="text-sm text-muted-foreground/20 tabular-nums tracking-widest">
          {now.toLocaleDateString()} · {totalPower}W
        </div>
      </footer>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(0,212,255,0.15); border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(0,212,255,0.3); }
      `}</style>
    </div>
  );
}

