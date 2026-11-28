import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCandleBodyWindowSummary,
  sanitizeCandleBodyConfig,
} from './candleBodyStats.ts';
import { DEFAULT_CANDLE_BODY_CONFIG, type Candle } from './types.ts';

function makeSeriesWithBodies(
  baselineCount: number,
  recentBodies: number[],
  liveBody: number
): Candle[] {
  const out: Candle[] = [];
  let p = 1.1;
  // Baseline closed candles with body = 0.001 (so medianBody = 0.001)
  for (let i = 0; i < baselineCount; i++) {
    const open = p;
    const close = open + (i % 2 === 0 ? 0.001 : -0.001);
    out.push({
      time: 1700000000 + i * 60,
      open,
      close,
      high: Math.max(open, close) + 0.0001,
      low: Math.min(open, close) - 0.0001,
    });
    p = close;
  }

  recentBodies.forEach((b, idx) => {
    const open = p;
    const close = open + b;
    out.push({
      time: 1700000000 + (baselineCount + idx) * 60,
      open,
      close,
      high: Math.max(open, close) + 0.00005,
      low: Math.min(open, close) - 0.00005,
    });
    p = close;
  });

  const liveOpen = p;
  const liveClose = liveOpen + liveBody;
  out.push({
    time: 1700000000 + (baselineCount + recentBodies.length) * 60,
    open: liveOpen,
    close: liveClose,
    high: Math.max(liveOpen, liveClose) + 0.00005,
    low: Math.min(liveOpen, liveClose) - 0.00005,
  });

  return out;
}

test('computes default 5-6 bar body lengths (matching user example 0.53x..0.39x) + real-time last bar + closed-bar average', () => {
  // 15 baseline bars with 0.001 body, then 5 closed bars matching 0.53x, 0.47x, 0.33x, 0.68x, 0.39x, plus live 0.25x
  const candles = makeSeriesWithBodies(
    15,
    [0.00053, 0.00047, 0.00033, 0.00068, 0.00039],
    0.00025
  );

  const summary = computeCandleBodyWindowSummary(candles, DEFAULT_CANDLE_BODY_CONFIG);
  assert.equal(summary.bars.length, 6);
  assert.equal(summary.bars[0].bodyToMedianRatio, 0.53);
  assert.equal(summary.bars[1].bodyToMedianRatio, 0.47);
  assert.equal(summary.bars[2].bodyToMedianRatio, 0.33);
  assert.equal(summary.bars[3].bodyToMedianRatio, 0.68);
  assert.equal(summary.bars[4].bodyToMedianRatio, 0.39);
  assert.equal(summary.bars[5].isLive, true);
  assert.equal(summary.bars[5].bodyToMedianRatio, 0.25);

  // Average over the 5 closed bars: (0.53 + 0.47 + 0.33 + 0.68 + 0.39) / 5 = 0.48
  assert.equal(summary.average.barCount, 5);
  assert.equal(summary.average.avgBodyToMedianRatio, 0.48);

  // When live forming bar spikes mid-minute to 1.40x, closed-bar average stays locked at 0.48x while live bar updates!
  const midCandleTick = makeSeriesWithBodies(
    15,
    [0.00053, 0.00047, 0.00033, 0.00068, 0.00039],
    0.0014
  );
  const midSummary = computeCandleBodyWindowSummary(midCandleTick, DEFAULT_CANDLE_BODY_CONFIG);
  assert.equal(midSummary.bars[5].bodyToMedianRatio, 1.4);
  assert.equal(midSummary.average.avgBodyToMedianRatio, 0.48);

  // After the candle closes and a new bar starts, the average updates cleanly!
  const afterClose = makeSeriesWithBodies(
    15,
    [0.00053, 0.00047, 0.00033, 0.00068, 0.00039, 0.0014],
    0.0002
  );
  const closedSummary = computeCandleBodyWindowSummary(afterClose, DEFAULT_CANDLE_BODY_CONFIG, 6);
  assert.equal(closedSummary.average.barCount, 6);
  // (0.53 + 0.47 + 0.33 + 0.68 + 0.39 + 1.40) / 6 = 0.6333 -> 0.63
  assert.equal(closedSummary.average.avgBodyToMedianRatio, 0.63);
});

test('supports user-configured ranges (2-4, 4-6, 5-6) and fixed counts (4, 5, 6, 7, 8) plus independent average count', () => {
  const candles = makeSeriesWithBodies(
    14,
    [0.0005, 0.0006, 0.0007, 0.0008, 0.0009, 0.001, 0.0011],
    0.0004
  );

  // Fixed 8 bars with independent fixed 4-bar closed average
  const fixed8Avg4 = computeCandleBodyWindowSummary(candles, {
    mode: 'FIXED',
    fixedBars: 8,
    avgMode: 'FIXED',
    avgFixedBars: 4,
  });
  assert.equal(fixed8Avg4.bars.length, 8);
  assert.equal(fixed8Avg4.bars[7].isLive, true);
  assert.equal(fixed8Avg4.bars[7].bodyToMedianRatio, 0.4);
  assert.equal(fixed8Avg4.average.barCount, 4);
  // Latest 4 closed bars: 0.8, 0.9, 1.0, 1.1 => mean 0.95
  assert.equal(fixed8Avg4.average.avgBodyToMedianRatio, 0.95);

  // Range 2-4
  const range2to4 = computeCandleBodyWindowSummary(candles, {
    mode: 'RANGE',
    minBars: 2,
    maxBars: 4,
    avgMode: 'SYNC',
  });
  assert.ok(range2to4.bars.length >= 3 && range2to4.bars.length <= 4);
  assert.equal(range2to4.average.barCount, 2);

  // Range 4-6 with fixed 7-bar average
  const range4to6Avg7 = computeCandleBodyWindowSummary(candles, {
    mode: 'RANGE',
    minBars: 4,
    maxBars: 6,
    avgMode: 'FIXED',
    avgFixedBars: 7,
  });
  assert.ok(range4to6Avg7.bars.length >= 5 && range4to6Avg7.bars.length <= 6);
  assert.equal(range4to6Avg7.average.barCount, 7);
});

test('sanitizeCandleBodyConfig clamps invalid bounds safely', () => {
  const sanitized = sanitizeCandleBodyConfig({
    mode: 'RANGE',
    minBars: 1,
    maxBars: 99,
    fixedBars: 25,
    avgMode: 'FIXED',
    avgMinBars: 7,
    avgMaxBars: 3,
    avgFixedBars: 0,
  });
  assert.equal(sanitized.minBars, 2);
  assert.equal(sanitized.maxBars, 10);
  assert.equal(sanitized.fixedBars, 10);
  assert.equal(sanitized.avgMinBars, 7);
  assert.equal(sanitized.avgMaxBars, 7);
  assert.equal(sanitized.avgFixedBars, 2);
});
