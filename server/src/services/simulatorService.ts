import * as store from '../store/deviceStore';
import config from '../config';
import { Device } from '../store/deviceStore';
import { UsageSummary } from './deviceService';
import { Alert } from './alertService';

export interface SimulatorUpdatePayload {
  device: Device;
  usage: UsageSummary;
  alerts: Alert[];
}

type OnUpdateFn = (payload: SimulatorUpdatePayload) => void;

interface StartOptions {
  getUsage: () => UsageSummary;
  getAlerts: () => Alert[];
  onUpdate: OnUpdateFn;
}

let _intervalHandle: ReturnType<typeof setInterval> | null = null;
let _onUpdate: OnUpdateFn | null = null;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function runTick(getUsage: () => UsageSummary, getAlerts: () => Alert[]): void {
  const devices = store.getAllDevices();
  const target = pickRandom(devices);
  const updated = store.toggleDevice(target.id);
  if (!updated || !_onUpdate) return;

  _onUpdate({ device: updated, usage: getUsage(), alerts: getAlerts() });
}

export function start(options: StartOptions): void {
  if (_intervalHandle) return; // idempotent
  _onUpdate = options.onUpdate;
  _intervalHandle = setInterval(
    () => runTick(options.getUsage, options.getAlerts),
    config.simulatorIntervalMs
  );
  console.log(`[simulator] Started — toggling a random device every ${config.simulatorIntervalMs}ms`);
}

export function stop(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    console.log('[simulator] Stopped');
  }
}

export function isRunning(): boolean {
  return _intervalHandle !== null;
}
