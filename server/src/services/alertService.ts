/**
 * alertService — thin compatibility shim.
 *
 * All alert logic now lives in alertEngine.ts.
 * This file re-exports the engine's public API under the original names
 * so any existing callers continue to work without changes.
 */

export {
  getAlerts         as getAllAlerts,
  getAlertsByType   as getAfterHoursAlerts,
  getAlertsByType   as getSustainedLoadAlerts,
  getAlertSummaryForBot as getAlertsSummaryForDiscord,
  Alert,
  AlertType,
  AlertSeverity,
} from './alertEngine';
