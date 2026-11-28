import {
  Candle,
  CandleBodyDisplayConfig,
  DEFAULT_CANDLE_BODY_CONFIG,
  TrendDirection,
} from './types.ts';

export interface CandleBodyBarStat {
  index: number; // 1-based display slot (แท่งที่ 1 .. N)
  time: number;
  body: number;
  bodyToMedianRatio: number; // e.g., 0.53 (formatted as 0.53×)
  bodyRangePct: number; // 0..100
  wickRatioPct: number; // 0..100
  direction: TrendDirection | 'DOJI';
  isLive: boolean;
}

export interface CandleBodyWindowSummary {
  bars: CandleBodyBarStat[];
  displayCount: number;
  displayLabel: string;
  average: {
    barCount: number;
    label: string;
    avgBodyToMedianRatio: number;
    avgBodyRangePct: number;
    lastClosedTime: number | null;
    usesRange: boolean;
    rangeText: string;
  };
  medianBody: number;
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

export function sanitizeCandleBodyConfig(
  raw?: Partial<CandleBodyDisplayConfig> | null
): CandleBodyDisplayConfig {
  if (!raw) return { ...DEFAULT_CANDLE_BODY_CONFIG };
  const minBars = clampInt(raw.minBars, 2, 8, DEFAULT_CANDLE_BODY_CONFIG.minBars);
  const maxBars = Math.max(
    minBars,
    clampInt(raw.maxBars, 2, 10, DEFAULT_CANDLE_BODY_CONFIG.maxBars)
  );
  const fixedBars = clampInt(
    raw.fixedBars,
    2,
    10,
    DEFAULT_CANDLE_BODY_CONFIG.fixedBars
  );
  const avgMinBars = clampInt(
    raw.avgMinBars,
    2,
    8,
    DEFAULT_CANDLE_BODY_CONFIG.avgMinBars
  );
  const avgMaxBars = Math.max(
    avgMinBars,
    clampInt(raw.avgMaxBars, 2, 10, DEFAULT_CANDLE_BODY_CONFIG.avgMaxBars)
  );
  const avgFixedBars = clampInt(
    raw.avgFixedBars,
    2,
    10,
    DEFAULT_CANDLE_BODY_CONFIG.avgFixedBars
  );

  return {
    mode: raw.mode === 'FIXED' || raw.mode === 'RANGE' ? raw.mode : DEFAULT_CANDLE_BODY_CONFIG.mode,
    minBars,
    maxBars,
    fixedBars,
    avgMode:
      raw.avgMode === 'SYNC' || raw.avgMode === 'RANGE' || raw.avgMode === 'FIXED'
        ? raw.avgMode
        : DEFAULT_CANDLE_BODY_CONFIG.avgMode,
    avgMinBars,
    avgMaxBars,
    avgFixedBars,
  };
}

export function getClosedM15MedianBody(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  const closedPool = candles.length >= 2 ? candles.slice(-21, -1) : candles;
  const nonZeroClosed = closedPool
    .map((c) => Math.abs(c.close - c.open))
    .filter((b) => b > 0);
  if (nonZeroClosed.length > 0) return median(nonZeroClosed);

  const fallback = candles
    .map((c) => Math.abs(c.close - c.open))
    .filter((b) => b > 0);
  return median(fallback);
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
  return minBars;
}

export function computeCandleBodyWindowSummary(
  candles: Candle[],
  rawConfig?: Partial<CandleBodyDisplayConfig> | null,
  detectedRunLength?: number
): CandleBodyWindowSummary {
  const cfg = sanitizeCandleBodyConfig(rawConfig);
  const medianBody = getClosedM15MedianBody(candles);

  // Determine how many total bars (closed + 1 real-time forming bar) to display
  let targetDisplayCount: number;
  let displayLabel: string;
  if (cfg.mode === 'FIXED') {
    targetDisplayCount = cfg.fixedBars;
    displayLabel = `${cfg.fixedBars} แท่งล่าสุด`;
  } else {
    const activeClosedCount = resolveRangeCount(cfg.minBars, cfg.maxBars, detectedRunLength);
    // Range mode shows active closed bars + 1 live forming bar, capped at maxBars
    // e.g. 5-6 => 5 closed bars + 1 live forming bar = 6 bars total
    targetDisplayCount = Math.min(cfg.maxBars, Math.max(cfg.minBars, activeClosedCount + 1));
    displayLabel =
      cfg.minBars === cfg.maxBars
        ? `${cfg.minBars} แท่งล่าสุด`
        : `${cfg.minBars}–${cfg.maxBars} แท่งล่าสุด`;
  }

  const displaySlice = candles.slice(-targetDisplayCount);
  const bars: CandleBodyBarStat[] = displaySlice.map((c, idx) => {
    const body = Math.abs(c.close - c.open);
    const totalRange = Math.max(c.high - c.low, body);
    const upWick = Math.max(0, c.high - Math.max(c.open, c.close));
    const lowWick = Math.max(0, Math.min(c.open, c.close) - c.low);
    const wickRatioPct =
      totalRange > 0 ? Math.min(100, Math.max(0, Math.round(((upWick + lowWick) / totalRange) * 100))) : 0;
    const bodyRangePct =
      totalRange > 0 ? Math.min(100, Math.max(0, Math.round((body / totalRange) * 100))) : 0;
    const bodyToMedianRatio =
      medianBody > 0 ? Number((body / medianBody).toFixed(2)) : 0;
    const direction: TrendDirection | 'DOJI' =
      c.close > c.open ? 'UP' : c.close < c.open ? 'DOWN' : 'DOJI';

    return {
      index: idx + 1,
      time: c.time,
      body,
      bodyToMedianRatio,
      bodyRangePct,
      wickRatioPct,
      direction,
      isLive: idx === displaySlice.length - 1,
    };
  });

  // Closed-bar average: strictly excludes the live forming bar (candles[candles.length - 1])
  // so it stays steady mid-minute and updates only after candle close!
  const closedCandles = candles.length >= 2 ? candles.slice(0, -1) : candles;

  let avgTargetCount: number;
  let usesRange = false;
  let rangeText: string;

  if (cfg.avgMode === 'SYNC') {
    if (cfg.mode === 'FIXED') {
      avgTargetCount = cfg.fixedBars;
      rangeText = `${cfg.fixedBars} แท่ง`;
    } else {
      avgTargetCount = resolveRangeCount(cfg.minBars, cfg.maxBars, detectedRunLength);
      usesRange = cfg.minBars !== cfg.maxBars;
      rangeText =
        cfg.minBars === cfg.maxBars
          ? `${cfg.minBars} แท่ง`
          : `${cfg.minBars}–${cfg.maxBars} แท่ง`;
    }
  } else if (cfg.avgMode === 'FIXED') {
    avgTargetCount = cfg.avgFixedBars;
    rangeText = `${cfg.avgFixedBars} แท่ง`;
  } else {
    avgTargetCount = resolveRangeCount(cfg.avgMinBars, cfg.avgMaxBars, detectedRunLength);
    usesRange = cfg.avgMinBars !== cfg.avgMaxBars;
    rangeText =
      cfg.avgMinBars === cfg.avgMaxBars
        ? `${cfg.avgMinBars} แท่ง`
        : `${cfg.avgMinBars}–${cfg.avgMaxBars} แท่ง`;
  }

  const avgSlice = closedCandles.slice(-avgTargetCount);
  let ratioSum = 0;
  let pctSum = 0;
  for (const c of avgSlice) {
    const body = Math.abs(c.close - c.open);
    const totalRange = Math.max(c.high - c.low, body);
    ratioSum += medianBody > 0 ? body / medianBody : 0;
    pctSum += totalRange > 0 ? Math.min(100, Math.max(0, (body / totalRange) * 100)) : 0;
  }

  const avgCount = avgSlice.length;
  const avgBodyToMedianRatio =
    avgCount > 0 ? Number((ratioSum / avgCount).toFixed(2)) : 0;
  const avgBodyRangePct = avgCount > 0 ? Math.round(pctSum / avgCount) : 0;
  const lastClosedTime = avgCount > 0 ? avgSlice[avgCount - 1].time : null;

  return {
    bars,
    displayCount: bars.length,
    displayLabel,
    average: {
      barCount: avgCount,
      label: `เฉลี่ย ${avgCount} แท่งจบล่าสุด`,
      avgBodyToMedianRatio,
      avgBodyRangePct,
      lastClosedTime,
      usesRange,
      rangeText,
    },
    medianBody,
  };
}
