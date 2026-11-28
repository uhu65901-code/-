import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSidewaysRankSnapshot,
  evaluateAssetForSideways,
  FIXED_SIDEWAYS_MIN_BODY_RATIO,
  sanitizeSidewaysConfig,
} from './sidewaysRanking.ts';
import type { Candle, ScannedAssetState } from './types.ts';

function makeSidewaysSeries(
  id: string,
  name: string,
  recentBars: Array<{ body: number; wick: number; dir: 'UP' | 'DOWN' }>,
  priorCount = 12
): ScannedAssetState {
  const candles: Candle[] = [];
  let p = 1.1;
  for (let i = 0; i < priorCount; i++) {
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
    const close = open + (b.dir === 'UP' ? b.body : -b.body);
    candles.push({
      time: 1700000000 + (priorCount + idx) * 60,
      open,
      close,
      high: Math.max(open, close) + b.wick,
      low: Math.min(open, close) - b.wick,
    });
    p = close;
  });

  // Forming live candle (should be excluded by closed-candle evaluation)
  candles.push({
    time: 1700000000 + (priorCount + recentBars.length) * 60,
    open: p,
    close: p + 0.0001,
    high: p + 0.0002,
    low: p - 0.0001,
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
    secondsRemaining: 50,
    updatedAt: Date.now(),
    analysis: {
      status: 'NONE',
      direction: null,
      runLength: 0,
      matchedIndices: [],
      signalIndex: null,
      signalPrice: null,
      signalTime: null,
      avgWickRatio: 0.35,
      uniformityScore: 50,
      matchScore: 40,
      directionalEfficiency: 0.2,
      avgBodyToMedianRatio: 2.8,
      counterCandles: 4,
      swingScore: 40,
      emaValues: [],
      reasons: [],
    },
  };
}

test('accepts alternating and same-color big bodies >= 2.50x regardless of huge wicks across 8..15 bars', () => {
  // 12 alternating green/red bars with >= 2.60x bodies and huge 2.00x wicks (wicks ignored!)
  const alt12 = makeSidewaysSeries(
    'ALT12',
    'Cocoa (OTC)',
    Array.from({ length: 12 }, (_, idx) => ({
      body: idx % 2 === 0 ? 0.0028 : 0.0026,
      wick: 0.0020,
      dir: idx % 2 === 0 ? ('UP' as const) : ('DOWN' as const),
    })),
    12
  );

  // 8 same-color big bars >= 2.50x (color-agnostic!)
  const same8 = makeSidewaysSeries(
    'SAME8',
    'USDCOP-OTC',
    Array.from({ length: 8 }, () => ({
      body: 0.00255,
      wick: 0.0015,
      dir: 'UP' as const,
    })),
    14
  );

  // 1 bar out of 8 has body 2.20x < 2.50x -> must be rejected
  const shortOne = makeSidewaysSeries(
    'SHORT1',
    'EUR/USD',
    [
      { body: 0.0030, wick: 0.0002, dir: 'UP' },
      { body: 0.0022, wick: 0.0002, dir: 'DOWN' },
      { body: 0.0030, wick: 0.0002, dir: 'UP' },
      { body: 0.0030, wick: 0.0002, dir: 'DOWN' },
      { body: 0.0030, wick: 0.0002, dir: 'UP' },
      { body: 0.0030, wick: 0.0002, dir: 'DOWN' },
      { body: 0.0030, wick: 0.0002, dir: 'UP' },
      { body: 0.0030, wick: 0.0002, dir: 'DOWN' },
    ],
    14
  );

  const snap8 = buildSidewaysRankSnapshot([shortOne, same8, alt12], {
    barMode: 'FIXED',
    fixedBars: 8,
  });
  assert.deepEqual(snap8.orderedIds, ['ALT12', 'SAME8']);
  assert.equal(snap8.evalById.get('ALT12')?.colorAlternations, 7);
  assert.equal(snap8.evalById.get('SAME8')?.colorAlternations, 0);

  // At 12 bars: ALT12 still passes (baseline prior median prevents self-contamination!), SAME8 drops out
  const snap12 = buildSidewaysRankSnapshot([shortOne, same8, alt12], {
    barMode: 'FIXED',
    fixedBars: 12,
  });
  assert.deepEqual(snap12.orderedIds, ['ALT12']);
  assert.equal(snap12.evalById.get('ALT12')?.matchedBars, 12);

  // At 15 bars: ALT12 only has 12 big bars -> 0 matches
  const res15 = evaluateAssetForSideways(alt12, {
    barMode: 'FIXED',
    fixedBars: 15,
  });
  assert.equal(res15.qualified, false);
});

test('sanitizeSidewaysConfig clamps bar counts safely and locks minBodyLengthRatio to 2.50x', () => {
  const s = sanitizeSidewaysConfig({
    barMode: 'FIXED',
    fixedBars: 99,
    minBars: 1,
    maxBars: 50,
    minBodyLengthRatio: 1.0,
  });
  assert.equal(s.fixedBars, 20);
  assert.equal(s.minBars, 4);
  assert.equal(s.maxBars, 20);
  assert.equal(s.minBodyLengthRatio, FIXED_SIDEWAYS_MIN_BODY_RATIO);
});
