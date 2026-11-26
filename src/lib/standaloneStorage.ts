import { deduplicateAlertsByAsset } from './performanceStats';
import {
  DEFAULT_SCANNER_CONFIG,
  DecisionRecord,
  MAX_AI_TRAINING_SAMPLES,
  PatternFeedbackSample,
  ScannerConfig,
  TrendAlert,
} from './types';

const STORAGE_CONFIG_KEY = 'flowtrend_iq_config_v4';
const STORAGE_ALERTS_KEY = 'flowtrend_iq_alerts_v2';
const STORAGE_DECISIONS_KEY = 'flowtrend_iq_decisions_v2';
const STORAGE_SSID_KEY = 'flowtrend_iq_saved_ssid_v1';
const STORAGE_AI_SAMPLES_KEY = 'flowtrend_iq_ai_samples_v1';

export function loadSavedConfig(): ScannerConfig {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_SCANNER_CONFIG };
    }
    const raw = window.localStorage.getItem(STORAGE_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_SCANNER_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ScannerConfig>;
    const rawWindow = Number(parsed.scanWindowBars);
    const scanWindowBars = Number.isFinite(rawWindow)
      ? Math.min(20, Math.max(15, Math.round(rawWindow)))
      : DEFAULT_SCANNER_CONFIG.scanWindowBars;
    return {
      ...DEFAULT_SCANNER_CONFIG,
      ...parsed,
      scanWindowBars,
    };
  } catch {
    return { ...DEFAULT_SCANNER_CONFIG };
  }
}

export function saveConfigLocally(config: ScannerConfig): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

export function loadSavedAlerts(): TrendAlert[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_ALERTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? deduplicateAlertsByAsset(parsed as TrendAlert[]) : [];
  } catch {
    return [];
  }
}

export function saveAlertsLocally(alerts: TrendAlert[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      STORAGE_ALERTS_KEY,
      JSON.stringify(deduplicateAlertsByAsset(alerts).slice(0, 80))
    );
  } catch {
    // ignore storage errors
  }
}

export function loadSavedDecisionRecords(): DecisionRecord[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_DECISIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DecisionRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveDecisionRecordsLocally(records: DecisionRecord[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      STORAGE_DECISIONS_KEY,
      JSON.stringify(records.slice(-200))
    );
  } catch {
    // ignore storage errors
  }
}

export function loadSavedAiSamples(): PatternFeedbackSample[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(STORAGE_AI_SAMPLES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as PatternFeedbackSample[])
      .filter(
        (item) =>
          item &&
          (item.direction === 'UP' || item.direction === 'DOWN') &&
          (item.verdict === 'PASS' || item.verdict === 'REJECT') &&
          Boolean(item.features)
      )
      .slice(-MAX_AI_TRAINING_SAMPLES);
  } catch {
    return [];
  }
}

export function saveAiSamplesLocally(samples: PatternFeedbackSample[]): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(
      STORAGE_AI_SAMPLES_KEY,
      JSON.stringify(samples.slice(-MAX_AI_TRAINING_SAMPLES))
    );
  } catch {
    // ignore storage errors
  }
}

export function loadSavedSsid(): string {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return '';
    return window.localStorage.getItem(STORAGE_SSID_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveSsidLocally(ssid: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const trimmed = ssid.trim();
    if (trimmed) {
      window.localStorage.setItem(STORAGE_SSID_KEY, trimmed);
    } else {
      window.localStorage.removeItem(STORAGE_SSID_KEY);
    }
  } catch {
    // ignore storage errors
  }
}
