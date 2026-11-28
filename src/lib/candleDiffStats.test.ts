import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCandleDiffWindowSummary,
  sanitizeCandleDiffConfig,
} from './candleDiffStats.ts';
import type { Candle } from './types.ts';

function buildCandles(
  recentBars: Array<{ body: number; wick: number; dir?: 'UP' | 'DOWN' }>
): Candle[] {
  const candles: Candle[] = [];
  let p = 1.1;
  // 14 closed baseline candles with body = 0.001 so M15 closed medianBody = 0.001
  for (let i = 0; i < 14; i++) {
    const open = p;
    const close = open + (i % 2 === 0 ? 0.001 : -0.001);
    candles.push({
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
    const close = open + (b.dir === 'DOWN' ? -b.body : b.body);
    candles.push({
      time: 1700000000 + (14 + idx) * 60,
      open,
      close,
      high: Math.max(open, close) + b.wick / 2,
      low: Math.min(open, close) - b.wick / 2,
    });
    p = close;
  });

  return candles;
}

test('computes body and wick differences comparing against the latest candle across default 6 bars', () => {
  const candles = buildCandles([
    { body: 0.00040, wick: 0.00010 }, // 0.40x, 0.10x
    { body: 0.00048, wick: 0.00012 }, // 0.48x, 0.12x
    { body: 0.00052, wick: 0.00015 }, // 0.52x, 0.15x
    { body: 0.00046, wick: 0.00011 }, // 0.46x, 0.11x
    { body: 0.00050, wick: 0.00014 }, // 0.50x, 0.14x
    { body: 0.00055, wick: 0.00020 }, // latest: 0.55x, 0.20x
  ]);

  const summary = computeCandleDiffWindowSummary(candles);
  assert.equal(summary.comparedCount, 6);
  assert.equal(summary.displayLabel, '6 แท่งล่าสุด');
  // Max |bar - latest|: |0.40 - 0.55| = 0.15; |0.10 - 0.20| = 0.10
  assert.equal(summary.bodyDiffVsLatest, 0.15);
  assert.equal(summary.wickDiffVsLatest, 0.1);
  assert.equal(summary.bodySpreadRatio, 0.15);
  assert.equal(summary.wickSpreadRatio, 0.1);
  assert.equal(summary.bars[5].isLive, true);
  assert.equal(summary.bars[5].bodyDiffFromLatest, 0);
  assert.equal(summary.bars[0].bodyDiffFromLatest, 0.15);
});

test('supports user-selected bar counts (4, 5, 6, 7, 8) and range presets while tracking closed-bar reference', () => {
  const candles = buildCandles([
    { body: 0.00020, wick: 0.00005 }, // bar 1 of 8
    { body: 0.00035, wick: 0.00008 }, // bar 2 of 8
    { body: 0.00042, wick: 0.00010 }, // bar 3 of 8
    { body: 0.00045, wick: 0.00012 }, // bar 4 of 8 (1 of 5)
    { body: 0.00048, wick: 0.00013 }, // bar 5 of 8
    { body: 0.00046, wick: 0.00011 }, // bar 6 of 8
    { body: 0.00050, wick: 0.00014 }, // bar 7 of 8 (last closed)
    { body: 0.00044, wick: 0.00010 }, // bar 8 of 8 (live)
  ]);

  const sum4 = computeCandleDiffWindowSummary(candles, { mode: 'FIXED', fixedBars: 4 });
  assert.equal(sum4.comparedCount, 4);
  assert.equal(sum4.bodyDiffVsLatest, 0.06); // |0.50 - 0.44|
  assert.equal(sum4.wickDiffVsLatest, 0.04); // |0.14 - 0.10|

  const sum8 = computeCandleDiffWindowSummary(candles, { mode: 'FIXED', fixedBars: 8 });
  assert.equal(sum8.comparedCount, 8);
  assert.equal(sum8.bodyDiffVsLatest, 0.24); // |0.20 - 0.44|
  assert.equal(sum8.bodySpreadRatio, 0.3); // 0.50 - 0.20

  const sumRange = computeCandleDiffWindowSummary(
    candles,
    { mode: 'RANGE', minBars: 4, maxBars: 6 },
    5
  );
  assert.equal(sumRange.comparedCount, 5);
  assert.equal(sumRange.displayLabel, '4–6 แท่งล่าสุด');
});

test('sanitizeCandleDiffConfig clamps bounds safely', () => {
  const cfg = sanitizeCandleDiffConfig({
    mode: 'FIXED',
    minBars: 1,
    maxBars: 20,
    fixedBars: 99,
  });
  assert.equal(cfg.minBars, 2);
  assert.equal(cfg.maxBars, 10);
  assert.equal(cfg.fixedBars, 10);
});
