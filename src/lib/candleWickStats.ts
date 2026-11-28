import {
  getClosedM15MedianBody,
  sanitizeCandleBodyConfig,
} from './candleBodyStats.ts';
import {
  Candle,
  CandleBodyDisplayConfig,
  TrendDirection,
} from './types.ts';

export interface CandleWickBarStat {
  index: number; // 1-based display slot (แท่งที่ 1 .. N)
  time: number;
  wickLength: number;
  wickToMedianRatio: number; // total (up+low) wick relative to M15 closed median body (e.g., 0.18×)
  wickRangePct: number; // 0..100 (% of total candle high-low range)
  direction: TrendDirection | 'DOJI';
  isLive: boolean;
}

export interface CandleWickWindowSummary {
  bars: CandleWickBarStat[];
  displayCount: number;
  displayLabel: string;
  average: {
    barCount: number;
    label: string;
    avgWickToMedianRatio: number;
    avgWickRangePct: number;
    lastClosedTime: number | null;
    usesRange: boolean;
    rangeText: string;
  };
  medianBody: number;
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

export function computeCandleWickWindowSummary(
  candles: Candle[],
  rawConfig?: Partial<CandleBodyDisplayConfig> | null,
  detectedRunLength?: number
): CandleWickWindowSummary {
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
    targetDisplayCount = Math.min(cfg.maxBars, Math.max(cfg.minBars, activeClosedCount + 1));
    displayLabel =
      cfg.minBars === cfg.maxBars
        ? `${cfg.minBars} แท่งล่าสุด`
        : `${cfg.minBars}–${cfg.maxBars} แท่งล่าสุด`;
  }

  const displaySlice = candles.slice(-targetDisplayCount);
  const bars: CandleWickBarStat[] = displaySlice.map((c, idx) => {
    const body = Math.abs(c.close - c.open);
    const totalRange = Math.max(c.high - c.low, body);
    const upWick = Math.max(0, c.high - Math.max(c.open, c.close));
    const lowWick = Math.max(0, Math.min(c.open, c.close) - c.low);
    const wickLength = upWick + lowWick;
    const wickRangePct =
      totalRange > 0
        ? Math.min(100, Math.max(0, Math.round((wickLength / totalRange) * 100)))
        : 0;
    const wickToMedianRatio =
      medianBody > 0 ? Number((wickLength / medianBody).toFixed(2)) : 0;
    const direction: TrendDirection | 'DOJI' =
      c.close > c.open ? 'UP' : c.close < c.open ? 'DOWN' : 'DOJI';

    return {
      index: idx + 1,
      time: c.time,
      wickLength,
      wickToMedianRatio,
      wickRangePct,
      direction,
      isLive: idx === displaySlice.length - 1,
    };
  });

  // Closed-bar average: strictly excludes the live forming bar (candles[candles.length - 1])
  // so the average updates only after candle close.
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
    const upWick = Math.max(0, c.high - Math.max(c.open, c.close));
    const lowWick = Math.max(0, Math.min(c.open, c.close) - c.low);
    const wickLength = upWick + lowWick;
    ratioSum += medianBody > 0 ? wickLength / medianBody : 0;
    pctSum +=
      totalRange > 0 ? Math.min(100, Math.max(0, (wickLength / totalRange) * 100)) : 0;
  }

  const avgCount = avgSlice.length;
  const avgWickToMedianRatio =
    avgCount > 0 ? Number((ratioSum / avgCount).toFixed(2)) : 0;
  const avgWickRangePct = avgCount > 0 ? Math.round(pctSum / avgCount) : 0;
  const lastClosedTime = avgCount > 0 ? avgSlice[avgCount - 1].time : null;

  return {
    bars,
    displayCount: bars.length,
    displayLabel,
    average: {
      barCount: avgCount,
      label: `เฉลี่ย ${avgCount} แท่งจบล่าสุด`,
      avgWickToMedianRatio,
      avgWickRangePct,
      lastClosedTime,
      usesRange,
      rangeText,
    },
    medianBody,
  };
}
