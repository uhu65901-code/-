import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpecialFlowRankSnapshot,
  evaluateAssetForSpecialFlow,
  sanitizeSpecialFlowConfig,
} from './specialFlowRanking.ts';
import { DEFAULT_SPECIAL_FLOW_CONFIG, type Candle, type ScannedAssetState } from './types.ts';

function makeSeries(
  id: string,
  name: string,
  recentBars: Array<{ body: number; wick: number; dir: 'UP' | 'DOWN' }>,
  liveNoiseBody = 0.00005
): ScannedAssetState {
  const candles: Candle[] = [];
  let p = 1.1;
  for (let i = 0; i < 15; i++) {
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
      avgBodyToMedianRatio: 0.6,
      counterCandles: 0,
      swingScore: 95,
      emaValues: [],
      reasons: [],
    },
  };
}

test('accepts clean uniform flows within default 0.40x body diff and 0.30x wick diff and rejects wider spreads', () => {
  const cleanAsset = makeSeries('CLEAN', 'EUR/USD', [
    { body: 0.00040, wick: 0.00010, dir: 'UP' },
    { body: 0.00050, wick: 0.00015, dir: 'UP' },
    { body: 0.00060, wick: 0.00022, dir: 'UP' },
    { body: 0.00045, wick: 0.00012, dir: 'UP' },
    { body: 0.00055, wick: 0.00018, dir: 'UP' },
  ]);

  const resClean = evaluateAssetForSpecialFlow(cleanAsset, DEFAULT_SPECIAL_FLOW_CONFIG);
  assert.equal(resClean.qualified, true);
  assert.equal(resClean.matchedBars, 5);
  assert.equal(resClean.bodyDiffRatio, 0.2);
  assert.equal(resClean.wickDiffRatio, 0.12);

  const wildBodyAsset = makeSeries('WILDBODY', 'GBP/USD', [
    { body: 0.00030, wick: 0.00010, dir: 'UP' },
    { body: 0.00090, wick: 0.00012, dir: 'UP' },
    { body: 0.00040, wick: 0.00011, dir: 'UP' },
    { body: 0.00085, wick: 0.00013, dir: 'UP' },
    { body: 0.00035, wick: 0.00010, dir: 'UP' },
  ]);
  const resWildBody = evaluateAssetForSpecialFlow(wildBodyAsset, DEFAULT_SPECIAL_FLOW_CONFIG);
  assert.equal(resWildBody.qualified, false);

  const wildWickAsset = makeSeries('WILDWICK', 'USD/JPY', [
    { body: 0.00050, wick: 0.00005, dir: 'DOWN' },
    { body: 0.00052, wick: 0.00045, dir: 'DOWN' },
    { body: 0.00048, wick: 0.00008, dir: 'DOWN' },
    { body: 0.00051, wick: 0.00042, dir: 'DOWN' },
    { body: 0.00049, wick: 0.00006, dir: 'DOWN' },
  ]);
  const resWildWick = evaluateAssetForSpecialFlow(wildWickAsset, DEFAULT_SPECIAL_FLOW_CONFIG);
  assert.equal(resWildWick.qualified, false);
});

test('ranks special flow table descending by matchedBars and respects fixed vs range bar counts', () => {
  const clean6 = makeSeries('CLEAN6', 'Apple (OTC)', [
    { body: 0.00028, wick: 0.00012, dir: 'UP' },
    { body: 0.00030, wick: 0.00014, dir: 'UP' },
    { body: 0.00031, wick: 0.00016, dir: 'UP' },
    { body: 0.00029, wick: 0.00015, dir: 'UP' },
    { body: 0.00032, wick: 0.00018, dir: 'UP' },
    { body: 0.00030, wick: 0.00014, dir: 'UP' },
  ]);
  const clean5 = makeSeries('CLEAN5', 'Bitcoin', [
    { body: 0.00055, wick: 0.00012, dir: 'DOWN' },
    { body: 0.00060, wick: 0.00014, dir: 'DOWN' },
    { body: 0.00058, wick: 0.00016, dir: 'DOWN' },
    { body: 0.00062, wick: 0.00015, dir: 'DOWN' },
    { body: 0.00059, wick: 0.00014, dir: 'DOWN' },
  ]);

  const snapRange = buildSpecialFlowRankSnapshot([clean5, clean6], DEFAULT_SPECIAL_FLOW_CONFIG);
  assert.deepEqual(snapRange.orderedIds, ['CLEAN6', 'CLEAN5']);

  const snapFixed6 = buildSpecialFlowRankSnapshot([clean5, clean6], {
    barMode: 'FIXED',
    fixedBars: 6,
    maxBodyDiffRatio: 0.4,
    maxWickDiffRatio: 0.3,
  });
  assert.deepEqual(snapFixed6.orderedIds, ['CLEAN6']);
});

test('sanitizeSpecialFlowConfig clamps diff ratios strictly to 0.00x..2.00x and bars to 2..10', () => {
  const s = sanitizeSpecialFlowConfig({
    barMode: 'FIXED',
    minBars: 1,
    maxBars: 99,
    fixedBars: 15,
    maxBodyDiffRatio: -0.5,
    maxWickDiffRatio: 4.5,
  });
  assert.equal(s.minBars, 2);
  assert.equal(s.maxBars, 10);
  assert.equal(s.fixedBars, 10);
  assert.equal(s.maxBodyDiffRatio, 0);
  assert.equal(s.maxWickDiffRatio, 2);
});
