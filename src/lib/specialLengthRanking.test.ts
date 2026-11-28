import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpecialLengthRankSnapshot,
  evaluateAssetForSpecialLength,
  FIXED_SPECIAL_BODY_LIMIT,
  FIXED_SPECIAL_WICK_LIMIT,
  sanitizeSpecialLengthConfig,
} from './specialLengthRanking.ts';
import type { Candle, ScannedAssetState } from './types.ts';

function makeSeries(
  id: string,
  name: string,
  recentBars: Array<{ body: number; wick: number; dir: 'UP' | 'DOWN' }>,
  liveNoiseBody = 0.00005
): ScannedAssetState {
  const candles: Candle[] = [];
  let p = 1.1;
  const firstRecentDir = recentBars[0]?.dir ?? 'UP';
  for (let i = 0; i < 15; i++) {
    const open = p;
    const isUp =
      i === 14 ? firstRecentDir === 'DOWN' : i % 2 === 0;
    const close = open + (isUp ? 0.001 : -0.001);
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
    const close = open + (b.dir === 'UP' ? b.body : -b.body);
    candles.push({
      time: 1700000000 + (15 + idx) * 60,
      open,
      close,
      high: Math.max(open, close) + b.wick / 2,
      low: Math.min(open, close) - b.wick / 2,
    });
    p = close;
  });

  candles.push({
    time: 1700000000 + (15 + recentBars.length) * 60,
    open: p,
    close: p + liveNoiseBody,
    high: Math.max(p, p + liveNoiseBody) + 0.00002,
    low: Math.min(p, p + liveNoiseBody) - 0.00002,
  });

  return {
    asset: {
      id,
      iqActiveId: 1,
      name,
      symbol: id,
      category: 'BINARY',
      isOtc: true,
      payoutPercent: 85,
      decimals: 5,
    },
    candles,
    lastPrice: candles[candles.length - 1].close,
    secondsRemaining: 59,
    updatedAt: Date.now(),
    analysis: {
      status: 'MATCH',
      direction: recentBars[recentBars.length - 1]?.dir ?? 'UP',
      runLength: recentBars.length,
      matchedIndices: [],
      signalIndex: null,
      signalPrice: null,
      signalTime: null,
      avgWickRatio: 0.12,
      uniformityScore: 90,
      matchScore: 92,
      directionalEfficiency: 0.9,
      avgBodyToMedianRatio: 0.8,
      counterCandles: 0,
      swingScore: 95,
      emaValues: [],
      reasons: [],
    },
  };
}

test('selects latest same-color flowing candles within program-fixed 1.90x body and 0.80x wick across bar counts (3..6)', () => {
  // Valid 5-bar uptrend: body ratios 0.55x..1.85x (<= 1.90x), wick ratios 0.20x..0.75x (<= 0.80x)
  const valid5 = makeSeries('VALID5', 'EUR/USD', [
    { body: 0.00055, wick: 0.00020, dir: 'UP' },
    { body: 0.00185, wick: 0.00075, dir: 'UP' },
    { body: 0.00110, wick: 0.00040, dir: 'UP' },
    { body: 0.00150, wick: 0.00060, dir: 'UP' },
    { body: 0.00090, wick: 0.00030, dir: 'UP' },
  ]);

  // Body ratio 2.05x > 1.90x -> rejected
  const overBody5 = makeSeries('OVERBODY5', 'USD/JPY', [
    { body: 0.00090, wick: 0.00020, dir: 'UP' },
    { body: 0.00205, wick: 0.00020, dir: 'UP' },
    { body: 0.00095, wick: 0.00020, dir: 'UP' },
    { body: 0.00100, wick: 0.00020, dir: 'UP' },
    { body: 0.00090, wick: 0.00020, dir: 'UP' },
  ]);

  // Wick ratio 0.90x > 0.80x -> rejected
  const overWick5 = makeSeries('OVERWICK5', 'GBP/USD', [
    { body: 0.00080, wick: 0.00025, dir: 'DOWN' },
    { body: 0.00085, wick: 0.00090, dir: 'DOWN' },
    { body: 0.00082, wick: 0.00025, dir: 'DOWN' },
    { body: 0.00084, wick: 0.00020, dir: 'DOWN' },
    { body: 0.00081, wick: 0.00022, dir: 'DOWN' },
  ]);

  const cfg5 = sanitizeSpecialLengthConfig({
    barMode: 'FIXED',
    fixedBars: 5,
  });

  const snap = buildSpecialLengthRankSnapshot([overBody5, overWick5, valid5], cfg5);
  assert.deepEqual(snap.orderedIds, ['VALID5']);
  assert.equal(snap.evalById.get('VALID5')?.matchedBars, 5);
  assert.equal(snap.evalById.get('VALID5')?.maxBodyRatio, 1.85);
  assert.equal(snap.evalById.get('VALID5')?.maxWickRatio, 0.75);

  // User switches to fixed 3 bars -> VALID5 still matches 3 latest bars
  const res3 = evaluateAssetForSpecialLength(valid5, {
    barMode: 'FIXED',
    fixedBars: 3,
  });
  assert.equal(res3.qualified, true);
  assert.equal(res3.matchedBars, 3);

  // User switches to fixed 6 bars -> VALID5 only has 5 same-color bars -> rejected
  const res6 = evaluateAssetForSpecialLength(valid5, {
    barMode: 'FIXED',
    fixedBars: 6,
  });
  assert.equal(res6.qualified, false);
});

test('sanitizeSpecialLengthConfig enforces program-fixed 1.90x body and 0.80x wick regardless of caller overrides and clamps bars to 2..10', () => {
  const s = sanitizeSpecialLengthConfig({
    barMode: 'FIXED',
    minBars: 1,
    maxBars: 20,
    fixedBars: 99,
    maxBodyLengthRatio: 0.4,
    maxWickLengthRatio: 1.9,
  });
  assert.equal(s.minBars, 2);
  assert.equal(s.maxBars, 10);
  assert.equal(s.fixedBars, 10);
  assert.equal(s.maxBodyLengthRatio, FIXED_SPECIAL_BODY_LIMIT);
  assert.equal(s.maxWickLengthRatio, FIXED_SPECIAL_WICK_LIMIT);
});
