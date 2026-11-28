import { getConsensusBarEpoch } from './assetRanking.ts';
import { getClosedM15MedianBody } from './candleBodyStats.ts';
import {
  Candle,
  DEFAULT_SIDEWAYS_CONFIG,
  ScannedAssetState,
  SidewaysFilterConfig,
} from './types.ts';

export const FIXED_SIDEWAYS_MIN_BODY_RATIO = 2.5;

export interface SidewaysEvalResult {
  qualified: boolean;
  matchedBars: number;
  minBodyRatio: number;
  maxBodyRatio: number;
  avgBodyRatio: number;
  upCount: number;
  downCount: number;
  colorAlternations: number;
}

export interface SidewaysRankSnapshot {
  barEpoch: number;
  orderedIds: string[];
  evalById: Map<string, SidewaysEvalResult>;
  configSignature: string;
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function sanitizeSidewaysConfig(
  raw?: Partial<SidewaysFilterConfig> | null
): SidewaysFilterConfig {
  if (!raw) {
    return {
      ...DEFAULT_SIDEWAYS_CONFIG,
      minBodyLengthRatio: FIXED_SIDEWAYS_MIN_BODY_RATIO,
    };
  }
  const minBars = clampInt(raw.minBars, 4, 18, DEFAULT_SIDEWAYS_CONFIG.minBars);
  const maxBars = Math.max(
    minBars,
    clampInt(raw.maxBars, 4, 20, DEFAULT_SIDEWAYS_CONFIG.maxBars)
  );
  const fixedBars = clampInt(
    raw.fixedBars,
    4,
    20,
    DEFAULT_SIDEWAYS_CONFIG.fixedBars
  );

  return {
    barMode:
      raw.barMode === 'FIXED' || raw.barMode === 'RANGE'
        ? raw.barMode
        : DEFAULT_SIDEWAYS_CONFIG.barMode,
    fixedBars,
    minBars,
    maxBars,
    minBodyLengthRatio: FIXED_SIDEWAYS_MIN_BODY_RATIO,
  };
}

export function getSidewaysConfigSignature(cfg: SidewaysFilterConfig): string {
  return [
    cfg.barMode,
    cfg.fixedBars,
    cfg.minBars,
    cfg.maxBars,
    FIXED_SIDEWAYS_MIN_BODY_RATIO.toFixed(2),
  ].join('|');
}

function resolveBaselineMedian(
  candles: Candle[],
  closedCandles: Candle[],
  windowLen: number
): number {
  const m15Med = getClosedM15MedianBody(candles);
  if (windowLen < 8) return m15Med;
  const prior = closedCandles.slice(0, Math.max(0, closedCandles.length - windowLen));
  if (prior.length >= 5) {
    const priorBodies = prior
      .map((c) => Math.abs(c.close - c.open))
      .filter((b) => b > 0);
    if (priorBodies.length >= 4) {
      const priorMed = median(priorBodies);
      if (priorMed > 0) return priorMed;
    }
  }
  return m15Med;
}

function evaluateWindow(
  closedCandles: Candle[],
  windowLen: number,
  refMedian: number
): SidewaysEvalResult | null {
  if (refMedian <= 0 || closedCandles.length < windowLen) return null;
  const slice = closedCandles.slice(-windowLen);
  const eps = 1e-6;

  let minBody = Infinity;
  let maxBody = -Infinity;
  let bodySum = 0;
  let upCount = 0;
  let downCount = 0;
  let colorAlternations = 0;
  let prevDir: 'UP' | 'DOWN' | null = null;

  for (const c of slice) {
    const body = Math.abs(c.close - c.open);
    const bodyRatio = Number((body / refMedian).toFixed(2));
    // Wick-agnostic & color-agnostic: only require body >= 2.50x
    if (bodyRatio + eps < FIXED_SIDEWAYS_MIN_BODY_RATIO) {
      return null;
    }

    if (bodyRatio < minBody) minBody = bodyRatio;
    if (bodyRatio > maxBody) maxBody = bodyRatio;
    bodySum += bodyRatio;

    const dir: 'UP' | 'DOWN' | null =
      c.close > c.open ? 'UP' : c.close < c.open ? 'DOWN' : null;
    if (dir === 'UP') upCount++;
    else if (dir === 'DOWN') downCount++;
    if (dir && prevDir && dir !== prevDir) {
      colorAlternations++;
    }
    if (dir) prevDir = dir;
  }

  return {
    qualified: true,
    matchedBars: windowLen,
    minBodyRatio: Number(minBody.toFixed(2)),
    maxBodyRatio: Number(maxBody.toFixed(2)),
    avgBodyRatio: Number((bodySum / windowLen).toFixed(2)),
    upCount,
    downCount,
    colorAlternations,
  };
}

/**
 * Evaluates whether an asset qualifies for the Sideways Table (ตารางไซด์เวย์):
 * - Counts the latest N closed candles (user-configured e.g. 8..15 bars)
 * - Ignores candle color / alternation completely (same-color or alternating both accepted)
 * - Ignores candle wicks completely
 * - Requires every candle in the N-bar window to have body >= 2.50x baseline
 */
export function evaluateAssetForSideways(
  item: ScannedAssetState,
  rawConfig?: Partial<SidewaysFilterConfig> | null
): SidewaysEvalResult {
  const cfg = sanitizeSidewaysConfig(rawConfig);
  const empty: SidewaysEvalResult = {
    qualified: false,
    matchedBars: 0,
    minBodyRatio: 0,
    maxBodyRatio: 0,
    avgBodyRatio: 0,
    upCount: 0,
    downCount: 0,
    colorAlternations: 0,
  };

  if (item.candles.length < 4) return empty;
  const closedCandles =
    item.candles.length >= 2 ? item.candles.slice(0, -1) : item.candles;

  const candidateLengths: number[] = [];
  if (cfg.barMode === 'FIXED') {
    if (closedCandles.length >= cfg.fixedBars) {
      candidateLengths.push(cfg.fixedBars);
    }
  } else {
    const maxLen = Math.min(cfg.maxBars, closedCandles.length);
    for (let k = maxLen; k >= cfg.minBars; k--) {
      candidateLengths.push(k);
    }
  }

  for (const len of candidateLengths) {
    const refMed = resolveBaselineMedian(item.candles, closedCandles, len);
    const res = evaluateWindow(closedCandles, len, refMed);
    if (res) return res;
  }

  return empty;
}

/**
 * Builds a candle-close frozen ranking snapshot for the Sideways Table (ตารางไซด์เวย์):
 * - Sorted descending by matched bar count, then highest avgBodyRatio, minBodyRatio, A-Z
 */
export function buildSidewaysRankSnapshot(
  assets: ScannedAssetState[],
  rawConfig?: Partial<SidewaysFilterConfig> | null,
  explicitEpoch?: number
): SidewaysRankSnapshot {
  const cfg = sanitizeSidewaysConfig(rawConfig);
  const evalById = new Map<string, SidewaysEvalResult>();
  const qualifying: Array<{ item: ScannedAssetState; evalResult: SidewaysEvalResult }> = [];

  for (const item of assets) {
    const res = evaluateAssetForSideways(item, cfg);
    evalById.set(item.asset.id, res);
    if (res.qualified) {
      qualifying.push({ item, evalResult: res });
    }
  }

  qualifying.sort((a, b) => {
    if (a.evalResult.matchedBars !== b.evalResult.matchedBars) {
      return b.evalResult.matchedBars - a.evalResult.matchedBars;
    }
    if (Math.abs(a.evalResult.avgBodyRatio - b.evalResult.avgBodyRatio) > 1e-6) {
      return b.evalResult.avgBodyRatio - a.evalResult.avgBodyRatio;
    }
    if (Math.abs(a.evalResult.minBodyRatio - b.evalResult.minBodyRatio) > 1e-6) {
      return b.evalResult.minBodyRatio - a.evalResult.minBodyRatio;
    }
    const nameCmp = a.item.asset.name.localeCompare(b.item.asset.name, 'en', {
      sensitivity: 'base',
    });
    if (nameCmp !== 0) return nameCmp;
    return a.item.asset.id.localeCompare(b.item.asset.id, 'en', { sensitivity: 'base' });
  });

  const barEpoch =
    typeof explicitEpoch === 'number' && explicitEpoch > 0
      ? explicitEpoch
      : getConsensusBarEpoch(assets);

  return {
    barEpoch,
    orderedIds: qualifying.map((q) => q.item.asset.id),
    evalById,
    configSignature: getSidewaysConfigSignature(cfg),
  };
}
