import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCandleWickWindowSummary } from './candleWickStats.ts';
import { DEFAULT_CANDLE_BODY_CONFIG, type Candle } from './types.ts';

function makeSeriesWithWicks(
  baselineCount: number,
  recentBars: Array<{ body: number; wick: number }>,
  liveBar: { body: number; wick: number }
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

  recentBars.forEach((b, idx) => {
    const open = p;
    const close = open + b.body;
    out.push({
      time: 1700000000 + (baselineCount + idx) * 60,
      open,
      close,
      high: Math.max(open, close) + b.wick / 2,
      low: Math.min(open, close) - b.wick / 2,
    });
    p = close;
  });

  const liveOpen = p;
  const liveClose = liveOpen + liveBar.body;
  out.push({
    time: 1700000000 + (baselineCount + recentBars.length) * 60,
    open: liveOpen,
    close: liveClose,
    high: Math.max(liveOpen, liveClose) + liveBar.wick / 2,
    low: Math.min(liveOpen, liveClose) - liveBar.wick / 2,
  });

  return out;
}

test('computes default 5-6 bar wick lengths + real-time last bar + closed-bar average', () => {
  // 15 baseline bars with body=0.001, then 5 closed bars with wicks 0.12x, 0.24x, 0.10x, 0.30x, 0.14x + live 0.08x
  const candles = makeSeriesWithWicks(
    15,
    [
      { body: 0.0008, wick: 0.00012 },
      { body: 0.0008, wick: 0.00024 },
      { body: 0.0008, wick: 0.00010 },
      { body: 0.0008, wick: 0.00030 },
      { body: 0.0008, wick: 0.00014 },
    ],
    { body: 0.0008, wick: 0.00008 }
  );

  const summary = computeCandleWickWindowSummary(candles, DEFAULT_CANDLE_BODY_CONFIG);
  assert.equal(summary.bars.length, 6);
  assert.equal(summary.bars[0].wickToMedianRatio, 0.12);
  assert.equal(summary.bars[1].wickToMedianRatio, 0.24);
  assert.equal(summary.bars[2].wickToMedianRatio, 0.1);
  assert.equal(summary.bars[3].wickToMedianRatio, 0.3);
  assert.equal(summary.bars[4].wickToMedianRatio, 0.14);
  assert.equal(summary.bars[5].isLive, true);
  assert.equal(summary.bars[5].wickToMedianRatio, 0.08);

  // Average over the 5 closed bars: (0.12 + 0.24 + 0.10 + 0.30 + 0.14) / 5 = 0.18
  assert.equal(summary.average.barCount, 5);
  assert.equal(summary.average.avgWickToMedianRatio, 0.18);

  // When live forming bar wick spikes mid-minute to 0.90x, closed-bar average stays locked at 0.18x!
  const midTick = makeSeriesWithWicks(
    15,
    [
      { body: 0.0008, wick: 0.00012 },
      { body: 0.0008, wick: 0.00024 },
      { body: 0.0008, wick: 0.00010 },
      { body: 0.0008, wick: 0.00030 },
      { body: 0.0008, wick: 0.00014 },
    ],
    { body: 0.0008, wick: 0.00090 }
  );
  const midSummary = computeCandleWickWindowSummary(midTick, DEFAULT_CANDLE_BODY_CONFIG);
  assert.equal(midSummary.bars[5].wickToMedianRatio, 0.9);
  assert.equal(midSummary.average.avgWickToMedianRatio, 0.18);

  // Once the 6th candle closes and bar 7 starts, average updates to include 0.90x!
  const afterClose = makeSeriesWithWicks(
    15,
    [
      { body: 0.0008, wick: 0.00012 },
      { body: 0.0008, wick: 0.00024 },
      { body: 0.0008, wick: 0.00010 },
      { body: 0.0008, wick: 0.00030 },
      { body: 0.0008, wick: 0.00014 },
      { body: 0.0008, wick: 0.00090 },
    ],
    { body: 0.0008, wick: 0.00010 }
  );
  const closedSummary = computeCandleWickWindowSummary(afterClose, DEFAULT_CANDLE_BODY_CONFIG, 6);
  assert.equal(closedSummary.average.barCount, 6);
  // (0.12 + 0.24 + 0.10 + 0.30 + 0.14 + 0.90) / 6 = 0.30
  assert.equal(closedSummary.average.avgWickToMedianRatio, 0.3);
});

test('supports user-configured ranges and fixed counts plus independent wick average count', () => {
  const candles = makeSeriesWithWicks(
    14,
    [
      { body: 0.0008, wick: 0.0001 },
      { body: 0.0008, wick: 0.0002 },
      { body: 0.0008, wick: 0.0003 },
      { body: 0.0008, wick: 0.0004 },
      { body: 0.0008, wick: 0.0005 },
      { body: 0.0008, wick: 0.0006 },
      { body: 0.0008, wick: 0.0007 },
    ],
    { body: 0.0008, wick: 0.00025 }
  );

  const fixed8Avg4 = computeCandleWickWindowSummary(candles, {
    mode: 'FIXED',
    fixedBars: 8,
    avgMode: 'FIXED',
    avgFixedBars: 4,
  });
  assert.equal(fixed8Avg4.bars.length, 8);
  assert.equal(fixed8Avg4.bars[7].isLive, true);
  assert.equal(fixed8Avg4.bars[7].wickToMedianRatio, 0.25);
  assert.equal(fixed8Avg4.average.barCount, 4);
  // Latest 4 closed wicks: 0.4, 0.5, 0.6, 0.7 => 0.55
  assert.equal(fixed8Avg4.average.avgWickToMedianRatio, 0.55);

  const range2to4 = computeCandleWickWindowSummary(candles, {
    mode: 'RANGE',
    minBars: 2,
    maxBars: 4,
    avgMode: 'SYNC',
  });
  assert.ok(range2to4.bars.length >= 3 && range2to4.bars.length <= 4);
  assert.equal(range2to4.average.barCount, 2);
});
