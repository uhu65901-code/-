import { getClosedM15MedianBody } from './candleBodyStats.ts';
import {
  Candle,
  CandleDiffDisplayConfig,
  DEFAULT_CANDLE_DIFF_CONFIG,
  TrendDirection,
} from './types.ts';

export interface CandleDiffBarItem {
  index: number; // 1..N
  time: number;
  bodyRatio: number;
  wickRatio: number;
  bodyDiffFromLatest: number; // |bar.bodyRatio - latest.bodyRatio|
  wickDiffFromLatest: number; // |bar.wickRatio - latest.wickRatio|
  direction: TrendDirection | 'DOJI';
  isLive: boolean;
}

export interface CandleDiffWindowSummary {
  bars: CandleDiffBarItem[];
  comparedCount: number;
  displayLabel: string;
  bodyDiffVsLatest: number; // max |bar - latest| across compared bars (live inclusive)
  wickDiffVsLatest: number; // max |bar - latest| across compared bars (live inclusive)
  bodySpreadRatio: number; // max(bodyRatio) - min(bodyRatio) across compared bars
  wickSpreadRatio: number; // max(wickRatio) - min(wickRatio) across compared bars
  closedBodyDiffVsLatest: number; // settled comparison using closed bars only
  closedWickDiffVsLatest: number;
  closedBodySpreadRatio: number;
  closedWickSpreadRatio: number;
  closedCount: number;
  lastClosedTime: number | null;
  medianBody: number;
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function sanitizeCandleDiffConfig(
  raw?: Partial<CandleDiffDisplayConfig> | null
): CandleDiffDisplayConfig {
  if (!raw) return { ...DEFAULT_CANDLE_DIFF_CONFIG };
  const minBars = clampInt(raw.minBars, 2, 8, DEFAULT_CANDLE_DIFF_CONFIG.minBars);
  const maxBars = Math.max(
    minBars,
    clampInt(raw.maxBars, 2, 10, DEFAULT_CANDLE_DIFF_CONFIG.maxBars)
  );
  const fixedBars = clampInt(raw.fixedBars, 2, 10, DEFAULT_CANDLE_DIFF_CONFIG.fixedBars);

  return {
    mode:
      raw.mode === 'RANGE' || raw.mode === 'FIXED'
        ? raw.mode
        : DEFAULT_CANDLE_DIFF_CONFIG.mode,
    minBars,
    maxBars,
    fixedBars,
  };
}

function resolveRangeCount(
  minBars: number,
  maxBars: number,
  detectedRunLength?: number
): number {
  if (
    typeof detectedRunLength === 'number' &&
    Number.isFinite(detectedRunLength) &&
    detectedRunLength >= minBars &&
    detectedRunLength <= maxBars
  ) {
    return Math.round(detectedRunLength);
  }
  return maxBars;
}

function measureRatios(candles: Candle[], medianBody: number) {
  return candles.map((c, idx) => {
    const body = Math.abs(c.close - c.open);
    const upWick = Math.max(0, c.high - Math.max(c.open, c.close));
    const lowWick = Math.max(0, Math.min(c.open, c.close) - c.low);
    const wickLen = upWick + lowWick;
    const bodyRatio = medianBody > 0 ? Number((body / medianBody).toFixed(2)) : 0;
    const wickRatio = medianBody > 0 ? Number((wickLen / medianBody).toFixed(2)) : 0;
    const direction: TrendDirection | 'DOJI' =
      c.close > c.open ? 'UP' : c.close < c.open ? 'DOWN' : 'DOJI';
    return {
      index: idx + 1,
      time: c.time,
      bodyRatio,
      wickRatio,
      direction,
      isLive: idx === candles.length - 1,
    };
  });
}

function computeSpreadAndVsLatest(
  items: Array<{ bodyRatio: number; wickRatio: number }>
): {
  bodyDiffVsLatest: number;
  wickDiffVsLatest: number;
  bodySpreadRatio: number;
  wickSpreadRatio: number;
} {
  if (items.length <= 1) {
    return {
      bodyDiffVsLatest: 0,
      wickDiffVsLatest: 0,
      bodySpreadRatio: 0,
      wickSpreadRatio: 0,
    };
  }
  const latest = items[items.length - 1];
  let maxBodyDiff = 0;
  let maxWickDiff = 0;
  let minB = Infinity;
  let maxB = -Infinity;
  let minW = Infinity;
  let maxW = -Infinity;

  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    if (b.bodyRatio < minB) minB = b.bodyRatio;
    if (b.bodyRatio > maxB) maxB = b.bodyRatio;
    if (b.wickRatio < minW) minW = b.wickRatio;
    if (b.wickRatio > maxW) maxW = b.wickRatio;
    if (i < items.length - 1) {
      const bd = Math.abs(b.bodyRatio - latest.bodyRatio);
      const wd = Math.abs(b.wickRatio - latest.wickRatio);
      if (bd > maxBodyDiff) maxBodyDiff = bd;
      if (wd > maxWickDiff) maxWickDiff = wd;
    }
  }

  return {
    bodyDiffVsLatest: Number(maxBodyDiff.toFixed(2)),
    wickDiffVsLatest: Number(maxWickDiff.toFixed(2)),
    bodySpreadRatio: Number(Math.max(0, maxB - minB).toFixed(2)),
    wickSpreadRatio: Number(Math.max(0, maxW - minW).toFixed(2)),
  };
}

export function computeCandleDiffWindowSummary(
  candles: Candle[],
  rawConfig?: Partial<CandleDiffDisplayConfig> | null,
  detectedRunLength?: number
): CandleDiffWindowSummary {
  const cfg = sanitizeCandleDiffConfig(rawConfig);
  const medianBody = getClosedM15MedianBody(candles);

  let targetCount: number;
  let displayLabel: string;
  if (cfg.mode === 'FIXED') {
    targetCount = cfg.fixedBars;
    displayLabel = `${cfg.fixedBars} แท่งล่าสุด`;
  } else {
    targetCount = resolveRangeCount(cfg.minBars, cfg.maxBars, detectedRunLength);
    displayLabel =
      cfg.minBars === cfg.maxBars
        ? `${cfg.minBars} แท่งล่าสุด`
        : `${cfg.minBars}–${cfg.maxBars} แท่งล่าสุด`;
  }

  const liveSlice = candles.slice(-targetCount);
  const measuredLive = measureRatios(liveSlice, medianBody);
  const latestItem = measuredLive[measuredLive.length - 1];

  const bars: CandleDiffBarItem[] = measuredLive.map((item) => ({
    ...item,
    bodyDiffFromLatest: latestItem
      ? Number(Math.abs(item.bodyRatio - latestItem.bodyRatio).toFixed(2))
      : 0,
    wickDiffFromLatest: latestItem
      ? Number(Math.abs(item.wickRatio - latestItem.wickRatio).toFixed(2))
      : 0,
  }));

  const liveStats = computeSpreadAndVsLatest(measuredLive);

  const closedPool = candles.length >= 2 ? candles.slice(0, -1) : candles;
  const closedSlice = closedPool.slice(-targetCount);
  const measuredClosed = measureRatios(closedSlice, medianBody);
  const closedStats = computeSpreadAndVsLatest(measuredClosed);
  const lastClosedTime =
    closedSlice.length > 0 ? closedSlice[closedSlice.length - 1].time : null;

  return {
    bars,
    comparedCount: bars.length,
    displayLabel,
    bodyDiffVsLatest: liveStats.bodyDiffVsLatest,
    wickDiffVsLatest: liveStats.wickDiffVsLatest,
    bodySpreadRatio: liveStats.bodySpreadRatio,
    wickSpreadRatio: liveStats.wickSpreadRatio,
    closedBodyDiffVsLatest: closedStats.bodyDiffVsLatest,
    closedWickDiffVsLatest: closedStats.wickDiffVsLatest,
    closedBodySpreadRatio: closedStats.bodySpreadRatio,
    closedWickSpreadRatio: closedStats.wickSpreadRatio,
    closedCount: closedSlice.length,
    lastClosedTime,
    medianBody,
  };
}
